"""Сравнивает модели Gemini по совпадению с ручной разметкой (research/labels.csv), без сервера.

Запуск: python3 research/bench_models.py gemini-3.6-flash gemini-pro-latest ...
"""
import csv
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402,F401  — подхватывает .env
from cqa.evaluator import LLMError, evaluate  # noqa: E402
from research.compare import CODES, norm  # noqa: E402

checklist = json.loads((ROOT / "cqa" / "default_checklist.json").read_text(encoding="utf-8"))
records = {r["conversation_id"]: r for r in json.loads((ROOT / "data" / "dev.json").read_text(encoding="utf-8"))["data"]["records"]}
labels = {}
with open(ROOT / "research" / "labels.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        got = {CODES[k]: row[f"{k}_answer"] for k in CODES if row.get(f"{k}_answer", "").strip()}
        if got:
            labels[row["conversation_id"]] = got


def run(model):
    os.environ["GEMINI_MODEL"] = model
    hit = total = 0
    cost = secs = 0.0
    errors = []

    def one(cid):
        try:
            return cid, evaluate(records[cid], checklist)
        except LLMError as e:
            return cid, e

    with ThreadPoolExecutor(3) as pool:
        for cid, res in pool.map(one, labels):
            if isinstance(res, Exception):
                errors.append(f"{cid}: {str(res)[:80]}")
                continue
            items = {it["criterion_id"]: it["answer"] for it in res["items"]}
            for c, human in labels[cid].items():
                total += 1
                hit += norm(human) == norm(items.get(c))
            cost += res["usage"]["cost_usd"]
            secs += res["usage"]["seconds"]
    n = len(labels) - len(errors)
    print(f"{model:<24} точность {hit}/{total} = {hit / total * 100 if total else 0:5.1f}%  "
          f"среднее {secs / n if n else 0:5.1f} с  ошибок {len(errors)}", flush=True)
    for e in errors[:3]:
        print("   ", e, flush=True)


if __name__ == "__main__":
    for m in sys.argv[1:]:
        t = time.time()
        run(m)
