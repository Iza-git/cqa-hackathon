import json
import unittest
from pathlib import Path

from cqa.scoring import compute, normalize_answer

CHECKLIST = json.loads((Path(__file__).resolve().parent.parent / "cqa" / "default_checklist.json").read_text())
BY_ID = {c["id"]: c for c in CHECKLIST["criteria"]}


def answers(**kw):
    base = {"c01": "yes", "c02": "yes", "c03": "yes", "c04": 20, "c05": "yes", "c06": 10, "c07": "yes", "c08": "no"}
    base.update(kw)
    return base


class ScoringTest(unittest.TestCase):
    def test_perfect_is_100(self):
        self.assertEqual(compute(CHECKLIST, answers())["total"], 100)

    def test_scale_proportional_to_weight(self):
        r = compute(CHECKLIST, answers(c06=7))
        self.assertEqual(r["criteria"]["c06"]["points"], 10.5)
        self.assertEqual(r["total"], 95.5)

    def test_na_redistributes_weight(self):
        # без идентификации (вес 20) остаётся 80; потерянный c07 (5) = 6.25 из 100
        r = compute(CHECKLIST, answers(c03="na", c07="no"))
        self.assertEqual(r["criteria"]["c03"]["points"], None)
        self.assertEqual(r["criteria"]["c07"]["effective_weight"], 6.25)
        self.assertEqual(r["total"], 93.75)

    def test_rounding_two_digits(self):
        r = compute(CHECKLIST, answers(c02="na", c03="na", c07="no"))  # остаётся 65
        self.assertEqual(r["total"], round(60 / 65 * 100, 2))

    def test_no_applicable_weight(self):
        cl = {"criteria": [dict(BY_ID["c03"]), dict(BY_ID["c08"])], "sections": []}
        self.assertIsNone(compute(cl, {"c03": "na", "c08": "no"})["total"])

    def test_gross_flag_separate(self):
        r = compute(CHECKLIST, answers(c08="yes"))
        self.assertTrue(r["gross_violation"])
        self.assertEqual(r["total"], 100)

    def test_normalize(self):
        self.assertEqual(normalize_answer(BY_ID["c04"], 13), 15)
        self.assertEqual(normalize_answer(BY_ID["c01"], "Да"), "yes")
        with self.assertRaises(ValueError):
            normalize_answer(BY_ID["c01"], "na")

    def test_sections(self):
        r = compute(CHECKLIST, answers(c06=0))
        conduct = next(s for s in r["sections"] if s["id"] == "conduct")
        self.assertEqual(conduct["percent"], round(20 / 35 * 100, 2))


if __name__ == "__main__":
    unittest.main()
