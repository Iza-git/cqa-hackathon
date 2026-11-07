"""Обязательные тесты расчёта из ТЗ (design/MASTER_PROMPT.txt) и путь апелляции."""
import sqlite3
import threading
import unittest

from cqa.api_v2 import V2, compute, seed_checklist

CL = seed_checklist()["criteria"]
BASE = {"c01": "yes", "c02": "yes", "c03": "yes", "c04": 15, "c05": "yes", "c06": 7, "c07": "no", "c08": "no"}


class ComputeTest(unittest.TestCase):
    def test_spec_table(self):
        self.assertEqual(compute(CL, BASE)["total"], 85.50)
        self.assertEqual(compute(CL, {**BASE, "c07": "NA"})["total"], 90.00)
        r = compute(CL, {"c01": "yes", "c02": "NA", "c03": "NA", "c04": 10, "c05": "no", "c06": 10, "c07": "NA", "c08": "no"})
        self.assertEqual(r["total"], 58.33)
        r = compute(CL, {**BASE, "c08": "yes"})
        self.assertEqual((r["total"], r["critical_flag"]), (85.50, True))
        self.assertIsNone(compute([c for c in CL if c["na_allowed"]], {c["id"]: "NA" for c in CL})["total"])


class AppealFlowTest(unittest.TestCase):
    def test_appeal_changes_final_keeps_ai(self):
        db = sqlite3.connect(":memory:", check_same_thread=False)
        db.row_factory = sqlite3.Row
        v2 = V2(db, threading.Lock(), lambda g: [])
        v2.import_records("T", [{"conversation_id": "d1", "channel": "agent chat", "language": "RU",
                                 "transcript": [{"timestamp": "00:01", "speaker": "operator", "text": "Здравствуйте"}]}])
        conv, cl = v2.conv("T", "d1"), v2.checklist("chat-quality")
        ev = v2.new_ev(conv, cl)
        ev["results"] = [{"criterion_id": k, "ai_answer": a, "final_answer": a, "reason": "r", "evidence": [], "checked_range": None} for k, a in BASE.items()]
        ev.update(status="done", ai_total=85.5)
        v2.apply_final(ev)
        v2.save_ev(ev)
        a = v2.route("POST", "/appeals", {}, {"evaluation_id": ev["id"], "criterion_id": "c07", "comment": "попрощался"})
        with self.assertRaises(Exception):
            v2.route("POST", "/appeals", {}, {"evaluation_id": ev["id"], "criterion_id": "c07", "comment": "дубль"})
        out = v2.route("POST", f"/appeals/{a['id']}/decision", {}, {"decision": "changed", "new_answer": "yes", "decision_reason": "есть прощание"})
        self.assertEqual((out["ai_total"], out["final_total"]), (85.5, 90.5))


if __name__ == "__main__":
    unittest.main()
