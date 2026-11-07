"""Оценка диалога по чек-листу через Gemini.

Модель возвращает только ответы по критериям (с обоснованием и номерами реплик);
итог считает cqa.scoring.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime

from .scoring import NA, normalize_answer

SPEAKER = {"client": "CLIENT", "operator": "OPERATOR", "bot": "BOT", "system": "SYSTEM"}
LANG = {"RU": "русский", "KZ": "казахский", "EN": "английский"}

# Цены Gemini 2.5 Flash (платный тариф, $ за 1M токенов) — для оценки стоимости одной проверки
PRICE_IN, PRICE_OUT = 0.30, 2.50


def parse_ts(ts: str, base: datetime | None = None) -> float:
    """MM:SS (чаты) или ISO 8601 (звонки) → секунды от начала диалога."""
    m = re.fullmatch(r"(\d+):(\d{2})(?::(\d{2}))?", ts.strip())
    if m:
        a, b, c = m.groups()
        return int(a) * 3600 + int(b) * 60 + int(c) if c else int(a) * 60 + int(b)
    t = datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", ts))
    return (t - base).total_seconds() if base else 0.0


def message_offsets(transcript: list[dict]) -> list[float]:
    first = transcript[0]["timestamp"] if transcript else "00:00"
    base = None
    if not re.fullmatch(r"\d+:\d{2}(:\d{2})?", first.strip()):
        base = datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", first))
    return [parse_ts(m["timestamp"], base) for m in transcript]


def fmt_sec(s: float) -> str:
    s = int(max(s, 0))
    return f"{s // 60:02d}:{s % 60:02d}"


def compute_facts(record: dict, threshold: int = 180) -> dict:
    """Факты о времени, которые модели трудно посчитать надёжно."""
    tr = record["transcript"]
    off = message_offsets(tr)
    op_idx = [i for i, m in enumerate(tr) if m["speaker"] == "operator"]
    facts = {"operator_messages": len(op_idx), "first_response_threshold_sec": threshold}
    if not op_idx:
        facts["note"] = "Оператор не написал ни одной реплики."
        return facts
    first = op_idx[0]
    # ожидание оператора начинается с последнего сообщения бота/системы/клиента перед его первой репликой
    start = next((i for i in range(first - 1, -1, -1)
                  if tr[i]["speaker"] == "system" or tr[i]["speaker"] == "bot"), 0)
    wait = off[first] - off[start]
    facts.update({
        "first_operator_message": first + 1,
        "first_response_wait_sec": round(wait),
        "first_response_over_threshold": wait > threshold,
    })
    gaps = []
    for i in op_idx[1:]:
        prev_client = next((j for j in range(i - 1, -1, -1) if tr[j]["speaker"] == "client"), None)
        prev_op = next((j for j in range(i - 1, -1, -1) if tr[j]["speaker"] == "operator"), None)
        if prev_client is not None and (prev_op is None or prev_client > prev_op):
            gaps.append((off[i] - off[prev_client], i + 1))
    if gaps:
        g, at = max(gaps)
        facts.update({"longest_operator_reply_gap_sec": round(g), "longest_gap_at_message": at})
    return facts


def render_transcript(record: dict) -> str:
    off = message_offsets(record["transcript"])
    return "\n".join(f"[{i}] {fmt_sec(off[i - 1])} {SPEAKER.get(m['speaker'], m['speaker'])}: {m['text']}"
                     for i, m in enumerate(record["transcript"], 1))


def render_criteria(checklist: dict) -> str:
    out = []
    for c in checklist["criteria"]:
        if c["type"] == "scale":
            fmt = "одно из значений шкалы: " + ", ".join(str(s["value"]) for s in c["scale"])
        else:
            fmt = '"yes" или "no"'
        if c.get("na_allowed"):
            fmt += ' или "na"'
        lines = [f'- id="{c["id"]}" ({c["code"]}) {c["name"]}. Ответ: {fmt}.',
                 f"  Правило: {c['description']}"]
        if c.get("na_allowed") and c.get("na_condition"):
            lines.append(f"  N/A только если: {c['na_condition']}")
        for s in c.get("scale") or []:
            lines.append(f"  {s['value']} — {s['description']}")
        out.append("\n".join(lines))
    return "\n".join(out)


PROMPT = """Ты — эксперт контроля качества (QA) брокерской компании Freedom Broker. Оцени работу ОПЕРАТОРА в диалоге строго по чек-листу.

ПРАВИЛА
1. Оценивается только OPERATOR. Реплики BOT и SYSTEM — контекст (что клиент уже сообщил, эскалация, закрытие чата). Приветствие бота не засчитывается оператору.
2. «no» — действие было нужно, но оператор его пропустил или выполнил неправильно. «na» — только если выполнено условие N/A из чек-листа; иначе N/A ставить нельзя.
3. Консультация (корректность и полнота решения) и ведение диалога (ясность, порядок, предупреждение об ожидании) оцениваются независимо.
4. Идентификация: если оператор раскрыл данные счёта или выполнил защищённое действие без подтверждения личности в чате — «no». Общий вопрос (тарифы, инструкции по приложению) идентификации не требует — «na».
5. Грубые ошибки: оскорбление клиента; предложение платной услуги в обход компании (перевести деньги оператору лично, личный номер для платной консультации — достаточно самого предложения); раскрытие конфиденциальной информации.
6. Теги и вложения в оценку не входят. Порог первой реакции оператора — {threshold} сек. Используй предрасчитанные факты о времени, не пересчитывай их сам.
7. Диалог может быть на русском, казахском или английском. Язык клиента: {lang}. Пиши explanation на русском, кратко (1–2 предложения), ссылаясь на номера реплик.
8. evidence — номера реплик [N], подтверждающих вывод. Если действие пропущено, evidence может быть пустым, но checked_from/checked_to обязательно укажи участок, где действие ожидалось. Для «na» объясни, какое условие неприменимости выполнено.
9. Для звонков транскрипт получен распознаванием речи и может содержать ошибки — не наказывай за них оператора.
10. quote — точная короткая цитата (до 12 слов) из главной реплики-доказательства, дословно как в тексте; пусто, если реплик нет.
11. confidence — твоя уверенность в ответе от 0 до 1. Ставь ниже 0.7, если правило неоднозначно для этого диалога, данных мало или ошибки распознавания мешают понять смысл.
12. suggestion — если критерий выполнен не полностью: одна фраза на языке клиента, как оператору стоило ответить или что сделать. Иначе пусто.

ЧЕК-ЛИСТ
{criteria}

ФАКТЫ (посчитаны программой)
{facts}

ДИАЛОГ ({channel}, {conv_id})
{transcript}

Верни JSON по схеме: оценка для КАЖДОГО критерия чек-листа и общий summary (1–2 предложения на русском)."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "criteria": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "criterion_id": {"type": "STRING"},
            "answer": {"type": "STRING"},
            "explanation": {"type": "STRING"},
            "evidence": {"type": "ARRAY", "items": {"type": "INTEGER"}},
            "checked_from": {"type": "INTEGER"},
            "checked_to": {"type": "INTEGER"},
            "quote": {"type": "STRING"},
            "confidence": {"type": "NUMBER"},
            "suggestion": {"type": "STRING"},
        }, "required": ["criterion_id", "answer", "explanation", "evidence", "checked_from", "checked_to", "quote", "confidence", "suggestion"],
            "propertyOrdering": ["criterion_id", "explanation", "evidence", "quote", "checked_from", "checked_to", "answer", "confidence", "suggestion"]}},
        "summary": {"type": "STRING"},
    },
    "required": ["criteria", "summary"],
}


def build_prompt(record: dict, checklist: dict, facts: dict) -> str:
    return PROMPT.format(
        threshold=checklist.get("first_response_threshold_sec", 180),
        lang=LANG.get(record.get("language"), record.get("language")),
        criteria=render_criteria(checklist),
        facts=json.dumps(facts, ensure_ascii=False),
        channel=record.get("channel"), conv_id=record["conversation_id"],
        transcript=render_transcript(record),
    )


class LLMError(RuntimeError):
    pass


def call_gemini(prompt: str) -> tuple[dict, dict]:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise LLMError("Не задан GEMINI_API_KEY (файл .env)")
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": SCHEMA},
    }).encode()
    delay = 5
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            return json.loads(text), {**data.get("usageMetadata", {}), "model": model}
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 5:
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise LLMError(f"Gemini HTTP {e.code}: {e.read()[:300].decode(errors='replace')}")
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            if attempt < 2:
                continue
            raise LLMError(f"Некорректный ответ модели: {e}")
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(delay)
                continue
            raise LLMError(f"Нет связи с Gemini: {e}")
    raise LLMError("Gemini недоступен")


def mock_llm(record: dict, checklist: dict) -> tuple[dict, dict]:
    """Офлайн-заглушка для разработки интерфейса без ключа (CQA_LLM=mock)."""
    tr = record["transcript"]
    op = [i for i, m in enumerate(tr, 1) if m["speaker"] == "operator"]
    items = []
    for k, c in enumerate(checklist["criteria"]):
        ans = {"binary": "yes", "flag": "no"}.get(c["type"], str(c["scale"][0]["value"]) if c.get("scale") else "yes")
        ev = op[k % len(op)] if op else None
        partial = c["type"] == "scale" and k % 2  # заглушка: часть шкал не на максимуме, чтобы был виден коучинг
        if partial:
            ans = str(c["scale"][1]["value"])
        items.append({"criterion_id": c["id"], "answer": ans, "explanation": "Тестовая оценка (mock).",
                      "evidence": [ev] if ev else [], "checked_from": op[0] if op else 1, "checked_to": op[-1] if op else 1,
                      "quote": " ".join(tr[ev - 1]["text"].split()[:6]) if ev else "",
                      "confidence": 0.55 if k == 2 else 0.9,
                      "suggestion": "Уточните срок ответа и предложите дальнейшую помощь." if partial else ""})
    return {"criteria": items, "summary": "Тестовая оценка без LLM."}, {"model": "mock"}


def validate(raw: dict, record: dict, checklist: dict) -> list[dict]:
    n = len(record["transcript"])
    got = {it.get("criterion_id"): it for it in raw.get("criteria", [])}
    items = []
    for c in checklist["criteria"]:
        it = got.get(c["id"])
        warning = None
        if it is None:
            answer, warning = (NA if c.get("na_allowed") else "no"), "Модель не вернула оценку по критерию."
            it = {}
        else:
            try:
                answer = normalize_answer(c, it.get("answer"))
            except ValueError as e:
                answer, warning = ("no" if c["type"] != "scale" else 0), f"Исправлен недопустимый ответ: {e}"
        clamp = lambda v: min(max(int(v), 1), n) if isinstance(v, (int, float)) and n else None
        ev = sorted({clamp(v) for v in it.get("evidence") or [] if clamp(v)})
        items.append({
            "criterion_id": c["id"], "answer": answer,
            "explanation": (it.get("explanation") or "").strip(),
            "evidence": ev,
            "checked_range": [clamp(it.get("checked_from")), clamp(it.get("checked_to"))],
            "quote": (it.get("quote") or "").strip(),
            "confidence": min(max(float(it["confidence"]), 0.0), 1.0) if isinstance(it.get("confidence"), (int, float)) else None,
            "suggestion": (it.get("suggestion") or "").strip(),
            "warning": warning,
        })
    return items


def evaluate(record: dict, checklist: dict) -> dict:
    facts = compute_facts(record, int(checklist.get("first_response_threshold_sec", 180)))
    started = time.time()
    if os.environ.get("CQA_LLM") == "mock":
        raw, usage = mock_llm(record, checklist)
    else:
        raw, usage = call_gemini(build_prompt(record, checklist, facts))
    tin, tout = usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return {
        "items": validate(raw, record, checklist),
        "summary": raw.get("summary", ""),
        "facts": facts,
        "model": usage.get("model"),
        "usage": {"input_tokens": tin, "output_tokens": tout,
                  "cost_usd": round(tin / 1e6 * PRICE_IN + tout / 1e6 * PRICE_OUT, 5),
                  "seconds": round(time.time() - started, 1)},
    }
