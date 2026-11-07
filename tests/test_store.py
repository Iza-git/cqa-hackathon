import tempfile
import unittest
from pathlib import Path

from cqa.store import Store


class AppealTest(unittest.TestCase):
    def test_appeal_recomputes_final_and_keeps_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Store(Path(tmp) / "t.db")
            cl = s.checklist()
            s.upsert_dialogs("T", [{"conversation_id": "d1", "channel": "agent chat", "language": "RU", "transcript": []}])
            eid = s.start_evaluation("d1", cl["id"])
            answers = {"c01": "yes", "c02": "yes", "c03": "yes", "c04": 20, "c05": "yes", "c06": 10, "c07": "no", "c08": "no"}
            s.finish_evaluation(eid, {"items": [{"criterion_id": k, "answer": v} for k, v in answers.items()]})
            self.assertEqual(s.evaluation(eid)["final"]["total"], 95)

            aid = s.create_appeal(eid, "c03", "общий вопрос")
            with self.assertRaises(ValueError):
                s.create_appeal(eid, "c03", "дубль")
            s.decide_appeal(aid, "change", "идентификация не требовалась", "na")

            ev = s.evaluation(eid)
            self.assertEqual(ev["original"]["total"], 95)
            self.assertEqual(ev["final"]["total"], 93.75)  # вес c03 перераспределён, потерян только c07
            with self.assertRaises(ValueError):
                s.decide_appeal(aid, "confirm", "повтор")
            s.db.close()


if __name__ == "__main__":
    unittest.main()
