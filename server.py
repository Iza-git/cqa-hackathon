"""CQA — сервер прототипа. Только стандартная библиотека Python 3.10+.

Запуск: python3 server.py  →  http://localhost:8000
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", line)
        if m and not line.lstrip().startswith("#"):
            os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


load_env(ROOT / ".env")

from cqa.evaluator import LLMError, evaluate  # noqa: E402
from cqa.api_v2 import V2, ApiError as V2Error  # noqa: E402
from cqa.store import Store  # noqa: E402

store = Store(ROOT / os.environ.get("CQA_DB", "cqa.db"))
jobs: dict[str, dict] = {}
v2 = V2(store.db, store.lock, lambda g: fetch_group(g))
eval_lock = threading.Semaphore(int(os.environ.get("CQA_PARALLEL", "2")))


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


# ---------- данные организаторов ----------

def fetch_group(group_id: str) -> list[dict]:
    base = os.environ.get("CQA_API_URL")
    if not base:
        local = ROOT / "data" / f"{group_id.lower()}.json"
        if local.exists():
            return json.loads(local.read_text(encoding="utf-8"))["data"]["records"]
        raise ApiError("Не задан CQA_API_URL в .env (ссылка GET из задания)")
    parts = urllib.parse.urlsplit(base)
    query = dict(urllib.parse.parse_qsl(parts.query))
    query["group_id"] = group_id
    url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
    with urllib.request.urlopen(url, timeout=120) as r:
        payload = json.loads(r.read())
    if not payload.get("isSuccess"):
        raise ApiError(f"API организаторов: {payload.get('error') or 'ошибка'}", 502)
    return payload["data"]["records"]


# ---------- чек-лист ----------

TYPES = {"binary", "scale", "flag"}


def clean_checklist(data: dict) -> dict:
    if not isinstance(data, dict) or not data.get("criteria"):
        raise ApiError("В чек-листе нет критериев")
    sections = data.get("sections") or []
    section_ids = {s["id"] for s in sections}
    seen, criteria = set(), []
    for i, c in enumerate(data["criteria"], 1):
        name = (c.get("name") or "").strip()
        if not name:
            raise ApiError(f"Критерий №{i}: укажите название")
        cid = c.get("id") or f"c{uuid.uuid4().hex[:6]}"
        if cid in seen:
            raise ApiError(f"Повторяется id критерия {cid}")
        seen.add(cid)
        t = c.get("type")
        if t not in TYPES:
            raise ApiError(f"«{name}»: тип должен быть binary, scale или flag")
        try:
            weight = float(c.get("weight") or 0)
        except (TypeError, ValueError):
            raise ApiError(f"«{name}»: вес должен быть числом")
        if weight < 0 or (t != "flag" and weight == 0):
            raise ApiError(f"«{name}»: вес должен быть больше нуля")
        item = {"id": cid, "code": c.get("code") or f"{i:02d}", "section": c.get("section"), "name": name,
                "type": t, "weight": 0 if t == "flag" else (int(weight) if weight.is_integer() else weight),
                "na_allowed": bool(c.get("na_allowed")) and t != "flag",
                "description": (c.get("description") or "").strip(),
                "na_condition": (c.get("na_condition") or "").strip()}
        if item["section"] and item["section"] not in section_ids:
            raise ApiError(f"«{name}»: неизвестная секция {item['section']}")
        if item["na_allowed"] and not item["na_condition"]:
            raise ApiError(f"«{name}»: опишите условие N/A")
        if t == "scale":
            scale = []
            for s in c.get("scale") or []:
                try:
                    v = float(s["value"])
                except (KeyError, TypeError, ValueError):
                    raise ApiError(f"«{name}»: ступени шкалы должны быть числами")
                scale.append({"value": int(v) if v.is_integer() else v, "description": (s.get("description") or "").strip()})
            if len(scale) < 2 or len({s["value"] for s in scale}) != len(scale):
                raise ApiError(f"«{name}»: нужна шкала минимум из двух разных ступеней")
            item["scale"] = sorted(scale, key=lambda s: -s["value"])
        criteria.append(item)
    if not any(c["type"] != "flag" for c in criteria):
        raise ApiError("Нужен хотя бы один критерий с весом")
    return {"name": (data.get("name") or "Чек-лист").strip(), "rounding": int(data.get("rounding", 2)),
            "first_response_threshold_sec": int(data.get("first_response_threshold_sec", 180)),
            "notes": data.get("notes", ""), "sections": sections, "criteria": criteria}


# ---------- оценка ----------

def run_evaluation(conversation_id: str, checklist_id: int | None) -> int:
    record = store.dialog(conversation_id)
    if not record:
        raise ApiError("Диалог не найден", 404)
    checklist = store.checklist(checklist_id)
    if not checklist:
        raise ApiError("Чек-лист не найден", 404)
    eid = store.start_evaluation(conversation_id, checklist["id"])
    try:
        with eval_lock:
            result = evaluate(record, checklist)
        store.finish_evaluation(eid, result)
    except LLMError as e:
        store.finish_evaluation(eid, None, str(e))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        store.finish_evaluation(eid, None, f"{type(e).__name__}: {e}")
    return eid


def batch_worker(job_id: str, ids: list[str], checklist_id: int | None):
    job = jobs[job_id]
    pace = 60.0 / float(os.environ.get("GEMINI_RPM", "8"))

    def one(cid):
        eid = run_evaluation(cid, checklist_id)
        ev = store.evaluation(eid)
        job["done"] += 1
        if ev["status"] == "error":
            job["errors"].append({"conversation_id": cid, "error": ev["error"]})

    # одна общая пауза между стартами держит темп GEMINI_RPM; параллельность ограничивает eval_lock
    threads = []
    for i, cid in enumerate(ids):
        if job["cancel"]:
            break
        if i:
            time.sleep(pace)
        th = threading.Thread(target=one, args=(cid,), daemon=True)
        th.start()
        threads.append(th)
    for th in threads:
        th.join()
    job["status"] = "cancelled" if job["cancel"] else "done"
    job["finished_at"] = time.time()


# ---------- HTTP ----------

def route(method: str, path: str, query: dict, body: dict):
    p = path.rstrip("/")
    if method == "GET" and p == "/api/config":
        return {"llm": "mock" if os.environ.get("CQA_LLM") == "mock" else "gemini",
                "model": os.environ.get("GEMINI_MODEL", "gemini-3.6-flash"),
                "has_key": bool(os.environ.get("GEMINI_API_KEY")),
                "has_api_url": bool(os.environ.get("CQA_API_URL"))}
    if method == "GET" and p == "/api/groups":
        return store.groups()
    if method == "POST" and p == "/api/groups/load":
        group = (body.get("group_id") or "").strip()
        if not re.fullmatch(r"[\w-]{1,64}", group):
            raise ApiError("Укажите group_id")
        return {"group_id": group, "loaded": store.upsert_dialogs(group, fetch_group(group))}

    if method == "GET" and p == "/api/dialogs":
        return store.list_dialogs(query.get("group_id"))
    if m := re.fullmatch(r"/api/dialogs/([\w-]+)", p):
        d = store.dialog(m.group(1))
        if not d:
            raise ApiError("Диалог не найден", 404)
        return {**d, "evaluations": store.evaluations_for(m.group(1))}

    if method == "GET" and p == "/api/checklists":
        return store.list_checklists()
    if method == "GET" and p == "/api/checklists/active":
        return store.checklist()
    if method == "POST" and p == "/api/checklists":
        data = clean_checklist(body.get("checklist") or {})
        cid = store.save_checklist(data, body.get("parent_id"))
        if body.get("activate", True):
            store.activate_checklist(cid)
        return store.checklist(cid)
    if m := re.fullmatch(r"/api/checklists/(\d+)", p):
        c = store.checklist(int(m.group(1)))
        if not c:
            raise ApiError("Чек-лист не найден", 404)
        return c
    if method == "POST" and (m := re.fullmatch(r"/api/checklists/(\d+)/activate", p)):
        store.activate_checklist(int(m.group(1)))
        return store.checklist(int(m.group(1)))

    if method == "POST" and p == "/api/evaluations":
        eid = run_evaluation(body.get("conversation_id", ""), body.get("checklist_id"))
        return store.evaluation(eid)
    if method == "GET" and (m := re.fullmatch(r"/api/evaluations/(\d+)", p)):
        ev = store.evaluation(int(m.group(1)))
        if not ev:
            raise ApiError("Оценка не найдена", 404)
        return ev

    if method == "POST" and p == "/api/batch":
        checklist_id = body.get("checklist_id") or store.checklist()["id"]
        dialogs = store.list_dialogs(body.get("group_id"))
        ids = body.get("conversation_ids") or [
            d["conversation_id"] for d in dialogs
            if not body.get("only_missing") or not d["evaluation"] or d["evaluation"]["checklist_id"] != checklist_id]
        job_id = uuid.uuid4().hex[:8]
        jobs[job_id] = {"id": job_id, "total": len(ids), "done": 0, "errors": [], "status": "running",
                        "cancel": False, "started_at": time.time(), "checklist_id": checklist_id}
        threading.Thread(target=batch_worker, args=(job_id, ids, checklist_id), daemon=True).start()
        return jobs[job_id]
    if m := re.fullmatch(r"/api/jobs/(\w+)(/cancel)?", p):
        job = jobs.get(m.group(1))
        if not job:
            raise ApiError("Задача не найдена", 404)
        if m.group(2) and method == "POST":
            job["cancel"] = True
        return job

    if method == "GET" and p == "/api/analytics":
        return analytics(query.get("group_id"))

    if method == "GET" and p == "/api/appeals":
        return store.appeals(status=query.get("status"))
    if method == "POST" and p == "/api/appeals":
        try:
            aid = store.create_appeal(int(body.get("evaluation_id", 0)), body.get("criterion_id", ""),
                                      body.get("comment", ""), body.get("author", ""))
        except ValueError as e:
            raise ApiError(str(e))
        return {"id": aid}
    if method == "POST" and (m := re.fullmatch(r"/api/appeals/(\d+)/decide", p)):
        try:
            store.decide_appeal(int(m.group(1)), body.get("action", ""), body.get("reason", ""),
                                body.get("new_answer"), body.get("reviewer", ""))
        except ValueError as e:
            raise ApiError(str(e))
        return {"ok": True}
    raise ApiError("Не найдено", 404)


def analytics(group_id: str | None) -> dict:
    """Сводка по последним оценкам диалогов (по активному чек-листу)."""
    checklist = store.checklist()
    crit = [c for c in checklist["criteria"]]
    per = {c["id"]: {"id": c["id"], "code": c["code"], "name": c["name"], "type": c["type"],
                     "sum": 0.0, "n": 0, "na": 0, "yes": 0} for c in crit}
    langs, chans, totals, gross = {}, {}, [], 0
    dialogs = store.list_dialogs(group_id)
    for d in dialogs:
        if not d["evaluation"]:
            continue
        ev = store.evaluation(d["evaluation"]["id"])
        fin = ev["final"]
        if fin["total"] is not None:
            totals.append(fin["total"])
            for bucket, key in ((langs, d["language"]), (chans, d["channel"])):
                bucket.setdefault(key, []).append(fin["total"])
        gross += fin["gross_violation"]
        for cid, entry in fin["criteria"].items():
            if cid not in per:
                continue
            s = per[cid]
            if entry["answer"] == "na":
                s["na"] += 1
            elif s["type"] == "flag":
                s["n"] += 1
                s["yes"] += entry["answer"] == "yes"
            elif entry["points"] is not None and entry["effective_weight"]:
                s["n"] += 1
                s["sum"] += entry["points"] / entry["effective_weight"]
    for s in per.values():
        s["percent"] = round(s.pop("sum") / s["n"] * 100, 1) if s["n"] and s["type"] != "flag" else None
    hist = [0] * 10
    for t in totals:
        hist[min(int(t // 10), 9)] += 1
    avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None
    appeals = store.appeals()
    return {
        "dialogs": len(dialogs), "evaluated": len(totals), "average": avg(totals), "gross": gross,
        "histogram": hist, "criteria": list(per.values()),
        "by_language": [{"key": k, "n": len(v), "average": avg(v)} for k, v in sorted(langs.items())],
        "by_channel": [{"key": k, "n": len(v), "average": avg(v)} for k, v in sorted(chans.items())],
        "appeals": {"total": len(appeals), "open": sum(a["status"] == "open" for a in appeals),
                    "changed": sum(bool(a["decision"]) and a["decision"]["action"] == "change" for a in appeals)},
        "checklist_id": checklist["id"],
    }


def export_csv(query: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    checklist = store.checklist(int(query["checklist_id"])) if query.get("checklist_id") else store.checklist()
    crit = checklist["criteria"]
    w.writerow(["conversation_id", "group_id", "channel", "language", "evaluation_id", "checklist_id",
                "total_final", "total_original", "gross_violation"]
               + [f"{c['code']} {c['name']}" for c in crit] + [f"{c['code']} обоснование" for c in crit])
    for d in store.list_dialogs(query.get("group_id")):
        # последняя оценка именно этой версией чек-листа, даже если позже диалог переоценили другой
        row = store.q("SELECT id FROM evaluations WHERE conversation_id=? AND checklist_id=? AND status='done' "
                      "ORDER BY id DESC LIMIT 1", (d["conversation_id"], checklist["id"]))
        if not row:
            continue
        ev = store.evaluation(row[0]["id"])
        items = {it["criterion_id"]: it for it in ev["items"]}
        w.writerow([d["conversation_id"], d["group_id"], d["channel"], d["language"], ev["id"], ev["checklist_id"],
                    ev["final"]["total"], ev["original"]["total"], "Да" if ev["final"]["gross_violation"] else "Нет"]
                   + [ev["final"]["criteria"][c["id"]]["answer"] for c in crit]
                   + [items.get(c["id"], {}).get("explanation", "") for c in crit])
    return "﻿" + buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    # Сайт команды (frontend/) на «/», прежний интерфейс (web/) на «/old/».
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "frontend"), **kw)

    def translate_path(self, path):
        if path.startswith("/old/") or path == "/old":
            return str(ROOT / "web") + (urllib.parse.urlsplit(path).path[4:] or "/")
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def handle_api(self, method):
        parts = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(parts.query))
        try:
            if parts.path == "/api/export.csv":
                raw = export_csv(query).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="cqa_results.csv"')
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            body = {}
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            self.send_json(200, route(method, parts.path, query, body))
        except ApiError as e:
            self.send_json(e.code, {"error": str(e)})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Некорректный JSON"})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.send_json(500, {"error": f"{type(e).__name__}: {e}"})

    def handle_v2(self, method):
        """API по контракту сайта: /v2/api/... (frontend/config.js: CQA_API_BASE = "/v2")."""
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path[len("/v2/api"):]
        try:
            if method == "GET" and path.startswith("/audio/"):
                # ссылка организаторов ведёт на страницу плеера, а не на файл — отправляем туда
                _, _, g, cid = path.split("/", 3)
                self.send_response(302)
                self.send_header("Location", v2.audio_url(urllib.parse.unquote(g), urllib.parse.unquote(cid)))
                self.end_headers()
                return
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            self.send_json(200, v2.route(method, path, dict(urllib.parse.parse_qsl(parts.query)), body))
        except (V2Error, ApiError) as e:
            self.send_json(e.code, {"detail": str(e)})
        except json.JSONDecodeError:
            self.send_json(400, {"detail": "Некорректный JSON"})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.send_json(500, {"detail": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        if self.path.startswith("/v2/api/"):
            return self.handle_v2("GET")
        if self.path.startswith("/api/"):
            return self.handle_api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/v2/api/"):
            return self.handle_v2("POST")
        if self.path.startswith("/api/"):
            return self.handle_api("POST")
        self.send_json(404, {"error": "Не найдено"})

    def do_PUT(self):
        if self.path.startswith("/v2/api/"):
            return self.handle_v2("PUT")
        self.send_json(404, {"error": "Не найдено"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    if not store.groups():
        local = ROOT / "data" / "dev.json"
        try:
            records = (json.loads(local.read_text(encoding="utf-8"))["data"]["records"]
                       if local.exists() else fetch_group("DEV"))
            print("Загружен DEV:", store.upsert_dialogs("DEV", records), "диалогов", flush=True)
        except Exception as e:  # noqa: BLE001
            print("Не удалось загрузить DEV:", e, flush=True)
    if not v2.q("SELECT 1 FROM v2_conversations LIMIT 1"):
        local = ROOT / "data" / "dev.json"
        try:
            recs = json.loads(local.read_text(encoding="utf-8"))["data"]["records"] if local.exists() else fetch_group("DEV")
            print("Сайт: загружен DEV:", v2.import_records("DEV", recs), "диалогов", flush=True)
            print("Сайт: перенесено готовых оценок:", v2.migrate_from(store), flush=True)
        except Exception as e:  # noqa: BLE001
            print("Сайт: не удалось загрузить DEV:", e, flush=True)
    print(f"CQA: http://localhost:{port}  (прежний интерфейс: /old/)", flush=True)
    ThreadingHTTPServer((os.environ.get("HOST", "127.0.0.1"), port), Handler).serve_forever()
