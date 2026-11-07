"""Хранилище SQLite: диалоги, версии чек-листов, оценки, апелляции."""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .scoring import compute, normalize_answer

ROOT = Path(__file__).resolve().parent.parent
LOW_CONFIDENCE = 0.7  # ниже — оценку стоит проверить человеку
DEFAULT_CHECKLIST = ROOT / "cqa" / "default_checklist.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS dialogs (
  id TEXT PRIMARY KEY, group_id TEXT, channel TEXT, language TEXT, data TEXT, loaded_at TEXT);
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data TEXT, created_at TEXT, active INTEGER DEFAULT 0,
  parent_id INTEGER);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, checklist_id INTEGER, created_at TEXT,
  status TEXT, error TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, evaluation_id INTEGER, criterion_id TEXT, comment TEXT,
  author TEXT, created_at TEXT, status TEXT DEFAULT 'open', decision TEXT, decided_at TEXT);
CREATE INDEX IF NOT EXISTS ev_conv ON evaluations(conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_appeal ON appeals(evaluation_id, criterion_id) WHERE status = 'open';
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.db.executescript(SCHEMA)
        if not self.q("SELECT 1 FROM checklists LIMIT 1"):
            data = json.loads(DEFAULT_CHECKLIST.read_text(encoding="utf-8"))
            cid = self.save_checklist(data)
            self.activate_checklist(cid)

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    # --- диалоги ---
    def upsert_dialogs(self, group_id: str, records: list[dict]) -> int:
        for r in records:
            self.x("INSERT OR REPLACE INTO dialogs VALUES (?,?,?,?,?,?)",
                   (r["conversation_id"], group_id, r.get("channel"), r.get("language"),
                    json.dumps(r, ensure_ascii=False), now()))
        return len(records)

    def dialog(self, cid: str) -> dict | None:
        rows = self.q("SELECT data, group_id FROM dialogs WHERE id=?", (cid,))
        return {**json.loads(rows[0]["data"]), "group_id": rows[0]["group_id"]} if rows else None

    def list_dialogs(self, group_id: str | None = None) -> list[dict]:
        sql = "SELECT id, group_id, channel, language, data FROM dialogs"
        rows = self.q(sql + (" WHERE group_id=?" if group_id else "") + " ORDER BY group_id, id",
                      (group_id,) if group_id else ())
        latest = {}
        for ev in self.q("SELECT id, conversation_id FROM evaluations WHERE status='done' ORDER BY id"):
            latest[ev["conversation_id"]] = ev["id"]
        out = []
        for r in rows:
            d = json.loads(r["data"])
            item = {"conversation_id": r["id"], "group_id": r["group_id"], "channel": r["channel"],
                    "language": r["language"], "messages": len(d["transcript"]), "evaluation": None}
            if r["id"] in latest:
                ev = self.evaluation(latest[r["id"]])
                item["evaluation"] = {"id": ev["id"], "checklist_id": ev["checklist_id"],
                                      "total": ev["final"]["total"], "original_total": ev["original"]["total"],
                                      "gross_violation": ev["final"]["gross_violation"],
                                      "open_appeals": sum(a["status"] == "open" for a in ev["appeals"]),
                                      "low_confidence": sum((it.get("confidence") or 1) < LOW_CONFIDENCE for it in ev["items"])}
            out.append(item)
        return out

    def groups(self) -> list[dict]:
        return self.q("SELECT group_id, COUNT(*) AS n FROM dialogs GROUP BY group_id")

    # --- чек-листы ---
    def save_checklist(self, data: dict, parent_id: int | None = None) -> int:
        return self.x("INSERT INTO checklists (name, data, created_at, parent_id) VALUES (?,?,?,?)",
                      (data.get("name", "Чек-лист"), json.dumps(data, ensure_ascii=False), now(), parent_id))

    def activate_checklist(self, cid: int):
        self.x("UPDATE checklists SET active = (id = ?)", (cid,))

    def checklist(self, cid: int | None = None) -> dict | None:
        rows = self.q("SELECT * FROM checklists WHERE " + ("id=?" if cid else "active=1"), (cid,) if cid else ())
        if not rows:
            return None
        r = rows[0]
        return {"id": r["id"], "active": bool(r["active"]), "created_at": r["created_at"],
                "parent_id": r["parent_id"], **json.loads(r["data"])}

    def list_checklists(self) -> list[dict]:
        return self.q("SELECT id, name, created_at, active, parent_id FROM checklists ORDER BY id DESC")

    # --- оценки ---
    def start_evaluation(self, conversation_id: str, checklist_id: int) -> int:
        return self.x("INSERT INTO evaluations (conversation_id, checklist_id, created_at, status) VALUES (?,?,?,?)",
                      (conversation_id, checklist_id, now(), "running"))

    def finish_evaluation(self, eid: int, data: dict | None, error: str | None = None):
        self.x("UPDATE evaluations SET status=?, error=?, data=? WHERE id=?",
               ("error" if error else "done", error, json.dumps(data, ensure_ascii=False) if data else None, eid))

    def evaluation(self, eid: int) -> dict | None:
        rows = self.q("SELECT * FROM evaluations WHERE id=?", (eid,))
        if not rows:
            return None
        r = rows[0]
        ev = {k: r[k] for k in ("id", "conversation_id", "checklist_id", "created_at", "status", "error")}
        if r["status"] != "done":
            return ev
        data = json.loads(r["data"])
        checklist = self.checklist(r["checklist_id"])
        appeals = self.appeals(evaluation_id=eid)
        original = {it["criterion_id"]: it["answer"] for it in data["items"]}
        final = dict(original)
        for a in appeals:  # решения применяются в порядке подачи
            if a["status"] == "decided" and a["decision"]["action"] == "change":
                final[a["criterion_id"]] = a["decision"]["new_answer"]
        ev.update(data)
        ev.update({"checklist": checklist, "appeals": appeals,
                   "original": compute(checklist, original), "final": compute(checklist, final)})
        return ev

    def evaluations_for(self, conversation_id: str) -> list[dict]:
        return self.q("SELECT id, checklist_id, created_at, status, error FROM evaluations "
                      "WHERE conversation_id=? ORDER BY id DESC", (conversation_id,))

    # --- апелляции ---
    def create_appeal(self, evaluation_id: int, criterion_id: str, comment: str, author: str = "") -> int:
        ev = self.evaluation(evaluation_id)
        if not ev or ev.get("status") != "done":
            raise ValueError("Оценка не найдена")
        if criterion_id not in {c["id"] for c in ev["checklist"]["criteria"]}:
            raise ValueError("Критерий не найден в чек-листе оценки")
        if not comment.strip():
            raise ValueError("Добавьте комментарий к апелляции")
        if any(a["criterion_id"] == criterion_id and a["status"] == "open" for a in ev["appeals"]):
            raise ValueError("По этому критерию уже есть открытая апелляция")
        try:
            return self.x("INSERT INTO appeals (evaluation_id, criterion_id, comment, author, created_at) VALUES (?,?,?,?,?)",
                          (evaluation_id, criterion_id, comment.strip(), author, now()))
        except sqlite3.IntegrityError:  # двойной клик прошёл проверку выше одновременно
            raise ValueError("По этому критерию уже есть открытая апелляция")

    def decide_appeal(self, appeal_id: int, action: str, reason: str, new_answer=None, reviewer: str = ""):
        rows = self.q("SELECT * FROM appeals WHERE id=?", (appeal_id,))
        if not rows:
            raise ValueError("Апелляция не найдена")
        a = rows[0]
        if a["status"] != "open":
            raise ValueError("Апелляция уже рассмотрена")
        if not reason.strip():
            raise ValueError("Укажите причину решения")
        ev = self.evaluation(a["evaluation_id"])
        crit = next(c for c in ev["checklist"]["criteria"] if c["id"] == a["criterion_id"])
        old = ev["final"]["criteria"][crit["id"]]["answer"]
        if action == "change":
            new_answer = normalize_answer(crit, new_answer)
            if new_answer == old:
                raise ValueError("Новая оценка совпадает с текущей — выберите «Подтвердить»")
        elif action == "confirm":
            new_answer = old
        else:
            raise ValueError("action: confirm или change")
        decision = {"action": action, "old_answer": old, "new_answer": new_answer,
                    "reason": reason.strip(), "reviewer": reviewer}
        self.x("UPDATE appeals SET status='decided', decision=?, decided_at=? WHERE id=?",
               (json.dumps(decision, ensure_ascii=False), now(), appeal_id))

    def appeals(self, evaluation_id: int | None = None, status: str | None = None) -> list[dict]:
        sql, args = "SELECT a.*, e.conversation_id FROM appeals a JOIN evaluations e ON e.id=a.evaluation_id", []
        cond = []
        if evaluation_id:
            cond.append("a.evaluation_id=?"); args.append(evaluation_id)
        if status:
            cond.append("a.status=?"); args.append(status)
        rows = self.q(sql + (" WHERE " + " AND ".join(cond) if cond else "") + " ORDER BY a.id", args)
        for r in rows:
            r["decision"] = json.loads(r["decision"]) if r["decision"] else None
        return rows
