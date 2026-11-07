"""API по контракту сайта команды (frontend/mock-api.js, design/MASTER_PROMPT.txt).

Хранит данные в своих таблицах SQLite, оценку делает cqa.evaluator (настоящий ИИ или CQA_LLM=mock).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import unicodedata
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from pathlib import Path

from .evaluator import LLMError, evaluate, message_offsets

ROOT = Path(__file__).resolve().parent.parent
ROLES = {"client", "operator", "bot", "system"}


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def r2(x) -> float | None:
    """Округление только на выходе: половина вверх, 2 знака."""
    if x is None:
        return None
    d = Decimal(x.numerator) / Decimal(x.denominator) if isinstance(x, Fraction) else Decimal(str(x))
    return float(d.quantize(Decimal("0.01"), ROUND_HALF_UP))


# ---------- расчёт итога (чистая функция, по ТЗ) ----------

def ratio(c: dict, a) -> Fraction:
    if c["type"] == "yes_no":
        return Fraction(1 if a == "yes" else 0)
    return Fraction(str(a)) / Fraction(str(max(s["value"] for s in c["steps"])))


def compute(criteria: list[dict], answers: dict) -> dict:
    app = [c for c in criteria if not c.get("is_critical") and Fraction(str(c["weight"])) > 0 and answers.get(c["id"]) not in ("NA", None)]
    tw = sum(Fraction(str(c["weight"])) for c in app)
    per = {}
    for c in criteria:
        if c in app:
            eff = Fraction(str(c["weight"])) * 100 / tw
            per[c["id"]] = {"effective_weight": r2(eff), "points": r2(eff * ratio(c, answers[c["id"]]))}
        else:
            per[c["id"]] = {"effective_weight": 0.0, "points": 0.0}
    sections = []
    for s in dict.fromkeys(c.get("section", "") for c in criteria):
        lst = [c for c in app if c.get("section", "") == s]
        w = sum(Fraction(str(c["weight"])) for c in lst)
        sections.append({"section": s, "score": r2(100 * sum(Fraction(str(c["weight"])) * ratio(c, answers[c["id"]]) for c in lst) / w) if w else None})
    total = r2(100 * sum(Fraction(str(c["weight"])) * ratio(c, answers[c["id"]]) for c in app) / tw) if app else None
    flag = any(c.get("is_critical") and answers.get(c["id"]) == "yes" for c in criteria)
    return {"total": total, "critical_flag": flag, "per": per, "sections": sections}


# ---------- чек-лист ----------

def validate_checklist(c: dict) -> list[str]:
    if not (c.get("name") or "").strip():
        raise ApiError("Укажите название чек-листа", 422)
    crit = c.get("criteria") or []
    if not crit:
        raise ApiError("Нужен хотя бы один критерий", 422)
    ids = set()
    for i, k in enumerate(crit, 1):
        n = f"Критерий {i}: "
        if not (k.get("title") or "").strip():
            raise ApiError(n + "укажите название", 422)
        if not (k.get("instruction") or "").strip():
            raise ApiError(n + "укажите инструкцию", 422)
        if not k.get("id") or k["id"] in ids:
            raise ApiError(n + "повторяется или пуст id", 422)
        ids.add(k["id"])
        if k.get("type") not in ("yes_no", "scale"):
            raise ApiError(n + "тип должен быть yes_no или scale", 422)
        try:
            if float(k.get("weight", 0)) < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise ApiError(n + "вес должен быть неотрицательным", 422)
        if k.get("na_allowed") and not (k.get("na_condition") or "").strip():
            raise ApiError(n + "укажите условие N/A", 422)
        if k.get("is_critical") and (k["type"] != "yes_no" or float(k.get("weight", 0)) != 0 or k.get("na_allowed")):
            raise ApiError(n + "грубая ошибка: тип Да/Нет, вес 0, без N/A", 422)
        if k["type"] == "scale":
            v = [float(s.get("value", -1)) for s in k.get("steps") or []]
            if len(v) < 2 or len(set(v)) != len(v) or min(v) < 0 or max(v) <= 0:
                raise ApiError(n + "шкала: нужны минимум 2 разные неотрицательные ступени", 422)
    total = sum(float(k.get("weight", 0)) for k in crit)
    return [] if total == 100 else [f"Сумма весов равна {total:g}, итог будет приведён к 100"]


def to_evaluator(cl: dict) -> dict:
    """Чек-лист сайта → формат cqa.evaluator."""
    out = []
    for i, k in enumerate(cl["criteria"], 1):
        t = "flag" if k.get("is_critical") else "binary" if k["type"] == "yes_no" else "scale"
        item = {"id": k["id"], "code": f"{i:02d}", "section": k.get("section", ""), "name": k["title"], "type": t,
                "weight": 0 if t == "flag" else k["weight"], "na_allowed": bool(k.get("na_allowed")),
                "description": k["instruction"], "na_condition": k.get("na_condition", "")}
        if t == "scale":
            item["scale"] = [{"value": s["value"], "description": s.get("label", "")} for s in k["steps"]]
        out.append(item)
    return {"criteria": out, "first_response_threshold_sec": 180}


def seed_checklist() -> dict:
    """Стартовый чек-лист сайта из нашего cqa/default_checklist.json."""
    src = json.loads((ROOT / "cqa" / "default_checklist.json").read_text(encoding="utf-8"))
    sections = {s["id"]: s["name"] for s in src["sections"]}
    crit = []
    for c in src["criteria"]:
        k = {"id": c["id"], "section": sections.get(c["section"], ""), "title": c["name"], "instruction": c["description"],
             "type": "scale" if c["type"] == "scale" else "yes_no", "weight": c["weight"], "steps": [],
             "na_allowed": c["na_allowed"], "na_condition": c.get("na_condition", ""), "is_critical": c["type"] == "flag"}
        if c["type"] == "scale":
            k["steps"] = [{"value": s["value"], "label": s["description"]} for s in c["scale"]]
        crit.append(k)
    return {"id": "chat-quality", "name": "Качество чатов", "criteria": crit}


# ---------- импорт ----------

def normalize(rec: dict) -> dict:
    if not rec.get("conversation_id") or not isinstance(rec.get("transcript"), list):
        raise ApiError("В записи нет conversation_id или transcript", 422)
    tr = rec["transcript"]
    for t in tr:
        if t.get("speaker") not in ROLES:
            raise ApiError("Неизвестная роль: " + str(t.get("speaker")), 422)
    try:
        offs = message_offsets(tr)
    except (ValueError, TypeError):
        offs = [None] * len(tr)
    turns = [{"id": f"u{i}", "timestamp": t.get("timestamp"), "t": None if offs[i - 1] is None else round(offs[i - 1], 1),
              "speaker": t["speaker"], "text": t.get("text", "")} for i, t in enumerate(tr, 1)]
    return {"conversation_id": rec["conversation_id"], "channel": rec.get("channel") or "agent chat",
            "language": rec.get("language") or "RU", "transcript": turns, "audio_url": rec.get("audio_url")}


def records_from(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("data"), dict) and "records" in data["data"]:
        return data["data"]["records"]
    if isinstance(data, dict) and data.get("conversation_id"):
        return [data]
    raise ApiError("Файл должен содержать запись, массив записей или ответ API", 422)


# ---------- хранилище ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS v2_conversations (group_id TEXT, conversation_id TEXT, data TEXT, imported_at TEXT, PRIMARY KEY(group_id, conversation_id));
CREATE TABLE IF NOT EXISTS v2_checklists (id TEXT, version INTEGER, data TEXT, created_at TEXT, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS v2_evaluations (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT, conversation_id TEXT, checklist_id TEXT, checklist_version INTEGER, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS v2_appeals (id INTEGER PRIMARY KEY AUTOINCREMENT, evaluation_id INTEGER, criterion_id TEXT, status TEXT, data TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS v2_one_open ON v2_appeals(evaluation_id, criterion_id) WHERE status = 'open';
"""


class V2:
    def __init__(self, db: sqlite3.Connection, lock: threading.Lock, fetch_group):
        self.db, self.lock, self.fetch_group = db, lock, fetch_group
        self.jobs: dict[int, dict] = {}
        self.next_job = 1
        self.eval_sem = threading.Semaphore(int(os.environ.get("CQA_PARALLEL", "2")))
        with lock:
            db.executescript(SCHEMA)
            db.commit()
        if not self.q("SELECT 1 FROM v2_checklists LIMIT 1"):
            s = seed_checklist()
            self.x("INSERT INTO v2_checklists VALUES (?,?,?,?)", (s["id"], 1, json.dumps({**s, "version": 1, "created_at": now()}, ensure_ascii=False), now()))

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    # --- чтение ---
    def conv(self, g, cid):
        rows = self.q("SELECT data FROM v2_conversations WHERE group_id=? AND conversation_id=?", (g, cid))
        if not rows:
            raise ApiError("Диалог не найден", 404)
        return {**json.loads(rows[0]["data"]), "group_id": g}

    def checklist(self, cid, version=None):
        rows = self.q("SELECT data FROM v2_checklists WHERE id=? " + ("AND version=?" if version else "ORDER BY version DESC LIMIT 1"),
                      (cid, int(version)) if version else (cid,))
        if not rows:
            raise ApiError("Чек-лист не найден", 404)
        return json.loads(rows[0]["data"])

    def ev(self, eid):
        rows = self.q("SELECT data FROM v2_evaluations WHERE id=?", (eid,))
        if not rows:
            raise ApiError("Оценка не найдена", 404)
        return json.loads(rows[0]["data"])

    def save_ev(self, ev):
        self.x("UPDATE v2_evaluations SET status=?, data=? WHERE id=?", (ev["status"], json.dumps(ev, ensure_ascii=False), ev["id"]))

    def appeals_of(self, eid):
        return [json.loads(r["data"]) for r in self.q("SELECT data FROM v2_appeals WHERE evaluation_id=? ORDER BY id", (eid,))]

    def latest_ev(self, g, cid, checklist_id=None):
        rows = self.q("SELECT data FROM v2_evaluations WHERE group_id=? AND conversation_id=?" + (" AND checklist_id=?" if checklist_id else "")
                      + " ORDER BY id DESC LIMIT 1", (g, cid, checklist_id) if checklist_id else (g, cid))
        return json.loads(rows[0]["data"]) if rows else None

    @staticmethod
    def duration(c):
        ts = [t["t"] for t in c["transcript"] if t["t"] is not None]
        return max(ts) if ts else None

    # --- оценка ---
    def apply_final(self, ev):
        if not ev["results"]:
            ev.update(sections=[], final_total=None, final_critical_flag=False)
            return
        cl = self.checklist(ev["checklist_id"], ev["checklist_version"])
        calc = compute(cl["criteria"], {r["criterion_id"]: r["final_answer"] for r in ev["results"]})
        ev.update(final_total=calc["total"], final_critical_flag=calc["critical_flag"], sections=calc["sections"])
        for r in ev["results"]:
            k = next(c for c in cl["criteria"] if c["id"] == r["criterion_id"])
            r.update(title=k["title"], section=k.get("section", ""), type=k["type"], is_critical=bool(k.get("is_critical")),
                     base_weight=k["weight"], **calc["per"][r["criterion_id"]])

    def results_from(self, items, conv, cl) -> list[dict]:
        tr = conv["transcript"]
        norm = lambda s: re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s or "").lower()).strip(" «»\"'“”.…")
        out = []
        for it in items:
            k = next(c for c in cl["criteria"] if c["id"] == it["criterion_id"])
            a = it["answer"]
            a = "NA" if a == "na" else a
            ev = []
            for j, n in enumerate(it.get("evidence") or []):
                if 1 <= n <= len(tr):
                    quote = it.get("quote") if j == 0 and it.get("quote") else tr[n - 1]["text"][:120]
                    ev.append({"id": f"u{n}", "quote": quote, "verified": norm(quote) in norm(tr[n - 1]["text"])})
            rng = it.get("checked_range") or [None, None]
            checked = {"from": f"u{rng[0]}", "to": f"u{rng[1]}"} if rng[0] and rng[1] and rng[0] <= rng[1] else None
            if k.get("is_critical") and a == "no" and not ev and not checked:
                ops = [i for i, t in enumerate(tr, 1) if t["speaker"] == "operator"]
                checked = {"from": f"u{ops[0]}", "to": f"u{ops[-1]}"} if ops else None
            out.append({"criterion_id": k["id"], "ai_answer": a, "final_answer": a, "reason": it.get("explanation") or "—",
                        "evidence": ev, "checked_range": checked, "confidence": it.get("confidence"), "suggestion": it.get("suggestion", "")})
        return out

    def run(self, eid):
        ev = self.ev(eid)
        ev["status"] = "running"
        self.save_ev(ev)
        conv = self.conv(ev["group_id"], ev["conversation_id"])
        cl = self.checklist(ev["checklist_id"], ev["checklist_version"])
        try:
            with self.eval_sem:
                res = evaluate(conv, to_evaluator(cl))
            ev["results"] = self.results_from(res["items"], conv, cl)
            calc = compute(cl["criteria"], {r["criterion_id"]: r["ai_answer"] for r in ev["results"]})
            warn = [i["warning"] for i in res["items"] if i.get("warning")]
            ev.update(status="needs_review" if warn else "done", error="; ".join(warn) or None, model=res.get("model"),
                      usage=res.get("usage"), ai_total=calc["total"], ai_critical_flag=calc["critical_flag"])
            self.apply_final(ev)
        except LLMError as e:
            ev.update(status="error", error=str(e), results=[], ai_total=None, ai_critical_flag=False)
            self.apply_final(ev)
        self.save_ev(ev)
        return ev["status"]

    def new_ev(self, conv, cl, job_id=None):
        ev = {"job_id": job_id, "group_id": conv["group_id"], "conversation_id": conv["conversation_id"], "checklist_id": cl["id"],
              "checklist_version": cl["version"], "model": os.environ.get("GEMINI_MODEL", "mock") if os.environ.get("CQA_LLM") != "mock" else "mock",
              "prompt_version": "v1", "status": "queued", "error": None, "ai_total": None, "final_total": None,
              "ai_critical_flag": False, "final_critical_flag": False, "sections": [], "results": [], "created_at": now()}
        eid = self.x("INSERT INTO v2_evaluations (group_id, conversation_id, checklist_id, checklist_version, status, data) VALUES (?,?,?,?,?,?)",
                     (conv["group_id"], conv["conversation_id"], cl["id"], cl["version"], "queued", "{}"))
        ev["id"] = eid
        self.save_ev(ev)
        return ev

    def job_worker(self, job, eids):
        pace = 60.0 / float(os.environ.get("GEMINI_RPM", "8"))
        threads = []

        def one(eid):
            st = self.run(eid)
            job["done" if st == "done" else "failed"] += 1

        for i, eid in enumerate(eids):
            if i:
                time.sleep(pace)
            th = threading.Thread(target=one, args=(eid,), daemon=True)
            th.start()
            threads.append(th)
        for th in threads:
            th.join()
        job["status"] = "done"

    # --- маршруты ---
    def route(self, method, path, q, b):
        m = None

        def match(pattern):
            nonlocal m
            m = re.fullmatch(pattern, path)
            return m

        if method == "POST" and path == "/datasets/import":
            g = (b.get("group_id") or "").strip()
            if not re.fullmatch(r"[\w-]{1,64}", g):
                raise ApiError("Укажите group_id")
            n = self.import_records(g, self.fetch_group(g))
            return {"imported": n, "total": n}
        if method == "POST" and path == "/conversations/upload":
            return {"imported": self.import_records(q.get("group_id") or "UPLOAD", records_from(b))}
        if method == "GET" and path == "/conversations":
            return self.list_rows(q)
        if method == "GET" and match(r"/conversations/([^/]+)/([^/]+)"):
            c = self.conv(m[1], m[2])
            evs = self.q("SELECT data FROM v2_evaluations WHERE group_id=? AND conversation_id=? ORDER BY id DESC", (m[1], m[2]))
            c.pop("audio_url", None)
            raw = self.q("SELECT data FROM v2_conversations WHERE group_id=? AND conversation_id=?", (m[1], m[2]))
            has_audio = bool(json.loads(raw[0]["data"]).get("audio_url"))
            return {**c, "duration": self.duration(c), "audio_path": f"/api/audio/{m[1]}/{m[2]}" if has_audio else None,
                    "evaluations": [{k: e[k] for k in ("id", "checklist_id", "checklist_version", "status", "final_total", "created_at")}
                                    for e in (json.loads(r["data"]) for r in evs)]}
        if method == "GET" and path == "/checklists":
            ids = [r["id"] for r in self.q("SELECT DISTINCT id FROM v2_checklists ORDER BY id")]
            return [self.checklist(i) for i in ids]
        if method == "GET" and match(r"/checklists/([^/]+)/versions"):
            return [{"id": r["id"], "version": r["version"], "name": json.loads(r["data"])["name"], "created_at": r["created_at"]}
                    for r in self.q("SELECT * FROM v2_checklists WHERE id=? ORDER BY version DESC", (m[1],))]
        if method == "GET" and match(r"/checklists/([^/]+)/versions/(\d+)"):
            return self.checklist(m[1], m[2])
        if method == "POST" and path == "/checklists":
            warnings = validate_checklist(b)
            cid = "checklist-" + str(int(time.time() * 1000))
            return self.save_checklist(cid, 1, b, warnings)
        if method == "PUT" and match(r"/checklists/([^/]+)"):
            prev = self.checklist(m[1])
            warnings = validate_checklist(b)
            return self.save_checklist(prev["id"], prev["version"] + 1, b, warnings)
        if method == "POST" and path == "/evaluations":
            return self.start_job(b)
        if method == "GET" and match(r"/jobs/(\d+)"):
            j = self.jobs.get(int(m[1]))
            if not j:
                raise ApiError("Задание не найдено", 404)
            return {k: j[k] for k in ("id", "status", "total", "done", "failed")}
        if method == "GET" and match(r"/evaluations/(\d+)"):
            ev = self.ev(int(m[1]))
            return {**ev, "appeals": self.appeals_of(ev["id"])}
        if method == "POST" and path == "/appeals":
            return self.create_appeal(b)
        if method == "GET" and path == "/appeals":
            st = q.get("status")
            rows = self.q("SELECT data FROM v2_appeals" + (" WHERE status=?" if st else "") + " ORDER BY id DESC", (st,) if st else ())
            return [self.appeal_view(json.loads(r["data"])) for r in rows]
        if method == "POST" and match(r"/appeals/(\d+)/decision"):
            return self.decide(int(m[1]), b)
        if method == "GET" and path == "/analytics":
            return self.analytics(q)
        raise ApiError("Не найдено", 404)

    def import_records(self, g, records) -> int:
        n = 0
        for rec in records:
            c = normalize(rec)
            self.x("INSERT OR REPLACE INTO v2_conversations VALUES (?,?,?,?)", (g, c["conversation_id"], json.dumps(c, ensure_ascii=False), now()))
            n += 1
        return n

    def list_rows(self, q):
        g = q.get("group_id")
        rows = self.q("SELECT group_id, data FROM v2_conversations" + (" WHERE group_id=?" if g else ""), (g,) if g else ())
        out = []
        for r in rows:
            c = {**json.loads(r["data"]), "group_id": r["group_id"]}
            e = self.latest_ev(c["group_id"], c["conversation_id"], q.get("checklist_id"))
            row = {"group_id": c["group_id"], "conversation_id": c["conversation_id"], "channel": c["channel"], "language": c["language"],
                   "turn_count": len(c["transcript"]), "duration": self.duration(c), "status": e["status"] if e else "new",
                   "evaluation_id": e["id"] if e else None, "ai_total": e["ai_total"] if e else None,
                   "final_total": e["final_total"] if e else None, "critical_flag": bool(e and e["final_critical_flag"]),
                   "open_appeals": len(self.q("SELECT 1 FROM v2_appeals WHERE evaluation_id=? AND status='open'", (e["id"],))) if e else 0}
            if all(not q.get(k) or row[k] == q.get(k) for k in ("channel", "language", "status")):
                out.append(row)
        out.sort(key=lambda r: (not r["critical_flag"], r["status"] != "needs_review",
                                101 if r["final_total"] is None else r["final_total"], r["conversation_id"]))
        return out

    def save_checklist(self, cid, version, b, warnings):
        row = {"id": cid, "version": version, "name": b["name"].strip(), "criteria": b["criteria"], "created_at": now()}
        self.x("INSERT INTO v2_checklists VALUES (?,?,?,?)", (cid, version, json.dumps(row, ensure_ascii=False), row["created_at"]))
        return {**row, "warnings": warnings}

    def start_job(self, b):
        g = b.get("group_id")
        if b.get("all"):
            ids = [r["conversation_id"] for r in self.q("SELECT conversation_id FROM v2_conversations WHERE group_id=?", (g,))]
        else:
            ids = list(b.get("conversation_ids") or [])
        if not ids:
            raise ApiError("Нет диалогов для оценки")
        cl = self.checklist(b.get("checklist_id") or "chat-quality", b.get("version"))
        job = {"id": self.next_job, "total": len(ids), "done": 0, "failed": 0, "status": "running"}
        self.next_job += 1
        self.jobs[job["id"]] = job
        todo = []
        for cid in ids:
            conv = self.conv(g, cid)
            cached = not b.get("force") and self.q(
                "SELECT 1 FROM v2_evaluations WHERE group_id=? AND conversation_id=? AND checklist_id=? AND checklist_version=? AND status='done'",
                (g, cid, cl["id"], cl["version"]))
            if cached:
                job["done"] += 1
            else:
                todo.append(self.new_ev(conv, cl, job["id"])["id"])
        if not todo:
            job["status"] = "done"
        else:
            threading.Thread(target=self.job_worker, args=(job, todo), daemon=True).start()
        return {"job_id": job["id"], "total": job["total"]}

    def create_appeal(self, b):
        ev = self.ev(int(b.get("evaluation_id") or 0))
        if ev["status"] not in ("done", "needs_review") or not any(r["criterion_id"] == b.get("criterion_id") for r in ev["results"]):
            raise ApiError("Критерий не найден в оценке")
        if not (b.get("comment") or "").strip():
            raise ApiError("Добавьте комментарий", 422)
        a = {"evaluation_id": ev["id"], "criterion_id": b["criterion_id"], "comment": b["comment"].strip(), "status": "open",
             "created_by": b.get("created_by"), "created_at": now(), "decision": None, "new_answer": None,
             "decision_reason": None, "decided_by": None, "decided_at": None}
        try:
            aid = self.x("INSERT INTO v2_appeals (evaluation_id, criterion_id, status, data) VALUES (?,?,?,?)", (ev["id"], a["criterion_id"], "open", "{}"))
        except sqlite3.IntegrityError:
            raise ApiError("По этому критерию уже есть открытая апелляция", 409)
        a["id"] = aid
        self.x("UPDATE v2_appeals SET data=? WHERE id=?", (json.dumps(a, ensure_ascii=False), aid))
        return a

    def appeal_view(self, a):
        ev = self.ev(a["evaluation_id"])
        c = self.conv(ev["group_id"], ev["conversation_id"])
        r = next(x for x in ev["results"] if x["criterion_id"] == a["criterion_id"])
        k = next(x for x in self.checklist(ev["checklist_id"], ev["checklist_version"])["criteria"] if x["id"] == a["criterion_id"])
        ids = [e["id"] for e in r["evidence"]] or ([r["checked_range"]["from"], r["checked_range"]["to"]] if r["checked_range"] else [])
        pos = [i for i, t in enumerate(c["transcript"]) if t["id"] in ids]
        lo, hi = max(0, (min(pos) if pos else 0) - 2), (max(pos) if pos else 2) + 3
        return {**a, "group_id": ev["group_id"], "conversation_id": ev["conversation_id"], "language": c["language"], "channel": c["channel"],
                "title": k["title"], "type": k["type"], "steps": k.get("steps", []), "na_allowed": k.get("na_allowed", False),
                "ai_answer": r["ai_answer"], "final_answer": r["final_answer"], "reason": r["reason"], "evidence": r["evidence"],
                "checked_range": r["checked_range"], "ai_total": ev["ai_total"], "final_total": ev["final_total"],
                "fragment": c["transcript"][lo:hi]}

    def decide(self, aid, b):
        rows = self.q("SELECT data FROM v2_appeals WHERE id=?", (aid,))
        if not rows:
            raise ApiError("Апелляция не найдена", 404)
        a = json.loads(rows[0]["data"])
        if a["status"] != "open":
            raise ApiError("Апелляция уже закрыта", 409)
        if not (b.get("decision_reason") or "").strip():
            raise ApiError("Укажите причину решения", 422)
        ev = self.ev(a["evaluation_id"])
        r = next(x for x in ev["results"] if x["criterion_id"] == a["criterion_id"])
        if b.get("decision") == "changed":
            k = next(x for x in self.checklist(ev["checklist_id"], ev["checklist_version"])["criteria"] if x["id"] == a["criterion_id"])
            v = b.get("new_answer")
            if k["type"] == "scale" and v != "NA":
                try:
                    v = float(v)
                    v = int(v) if v.is_integer() else v
                except (TypeError, ValueError):
                    raise ApiError("Недопустимая новая оценка", 422)
            ok = (v == "NA" and k.get("na_allowed")) or (v in ("yes", "no") if k["type"] == "yes_no" else any(float(s["value"]) == v for s in k["steps"]))
            if not ok:
                raise ApiError("Недопустимая новая оценка", 422)
            r["final_answer"] = a["new_answer"] = v
        elif b.get("decision") != "confirmed":
            raise ApiError("Выберите решение", 422)
        a.update(status="resolved", decision=b["decision"], decision_reason=b["decision_reason"].strip(), decided_by=b.get("decided_by"), decided_at=now())
        self.apply_final(ev)
        with self.lock:  # решение и пересчёт — одна транзакция
            self.db.execute("UPDATE v2_appeals SET status='resolved', data=? WHERE id=?", (json.dumps(a, ensure_ascii=False), aid))
            self.db.execute("UPDATE v2_evaluations SET data=? WHERE id=?", (json.dumps(ev, ensure_ascii=False), ev["id"]))
            self.db.commit()
        return {**ev, "appeals": self.appeals_of(ev["id"])}

    def analytics(self, q):
        g = q.get("group_id")
        convs = [{**json.loads(r["data"]), "group_id": r["group_id"]} for r in self.q("SELECT group_id, data FROM v2_conversations" + (" WHERE group_id=?" if g else ""), (g,) if g else ())]
        evs = [e for e in (self.latest_ev(c["group_id"], c["conversation_id"], q.get("checklist_id")) for c in convs) if e]
        done = [e for e in evs if e["status"] == "done"]
        avg = lambda xs: r2(sum(Fraction(str(x)) for x in xs) / len(xs)) if xs else None
        stat = {}
        for e in done:
            for r in e["results"]:
                if r.get("is_critical"):
                    continue
                k = stat.setdefault(r["criterion_id"], {"criterion_id": r["criterion_id"], "title": r.get("title"), "values": [], "na_count": 0})
                if r["final_answer"] == "NA":
                    k["na_count"] += 1
                else:
                    k["values"].append(r["points"] / r["effective_weight"] if r.get("effective_weight") else 0)
        lang = {c["conversation_id"] + c["group_id"]: c for c in convs}

        def group_by(key):
            out = []
            for v in dict.fromkeys(c[key] for c in convs):
                lst = [e["final_total"] for e in done if lang[e["conversation_id"] + e["group_id"]][key] == v and e["final_total"] is not None]
                out.append({key: v, "count": len(lst), "average_total": avg(lst)})
            return out

        ids = {e["id"] for e in evs}
        aps = [json.loads(r["data"]) for r in self.q("SELECT data FROM v2_appeals")]
        aps = [a for a in aps if a["evaluation_id"] in ids]
        weak = [{"criterion_id": k["criterion_id"], "title": k["title"], "average_ratio": avg(k["values"]), "na_count": k["na_count"]}
                for k in stat.values() if k["values"]]
        return {"evaluated": len(done), "average_total": avg([e["final_total"] for e in done if e["final_total"] is not None]),
                "critical_count": sum(1 for e in done if e["final_critical_flag"]),
                "needs_review": sum(1 for e in evs if e["status"] == "needs_review"),
                "weak_criteria": sorted(weak, key=lambda k: k["average_ratio"]),
                "by_language": group_by("language"), "by_channel": group_by("channel"),
                "appeals": {"total": len(aps), "open": sum(a["status"] == "open" for a in aps),
                            "confirmed": sum(a["decision"] == "confirmed" for a in aps), "changed": sum(a["decision"] == "changed" for a in aps)}}

    def audio_url(self, g, cid) -> str:
        rows = self.q("SELECT data FROM v2_conversations WHERE group_id=? AND conversation_id=?", (g, cid))
        url = rows and json.loads(rows[0]["data"]).get("audio_url")
        if not url:
            raise ApiError("Записи нет", 404)
        return url

    # --- перенос готовых оценок из старого API, чтобы не тратить лимит модели ---
    def migrate_from(self, store):
        if self.q("SELECT 1 FROM v2_evaluations LIMIT 1"):
            return 0
        cl = self.checklist("chat-quality", 1)
        ids = {c["id"] for c in cl["criteria"]}
        n = 0
        for d in store.list_dialogs("DEV"):
            if not d["evaluation"]:
                continue
            old = store.evaluation(d["evaluation"]["id"])
            if {it["criterion_id"] for it in old["items"]} != ids:
                continue
            try:
                conv = self.conv("DEV", d["conversation_id"])
            except ApiError:
                continue
            ev = self.new_ev(conv, cl)
            ev["results"] = self.results_from(old["items"], conv, cl)
            calc = compute(cl["criteria"], {r["criterion_id"]: r["ai_answer"] for r in ev["results"]})
            ev.update(status="done", model=old.get("model"), usage=old.get("usage"), created_at=old["created_at"],
                      ai_total=calc["total"], ai_critical_flag=calc["critical_flag"])
            self.apply_final(ev)
            self.save_ev(ev)
            n += 1
        return n
