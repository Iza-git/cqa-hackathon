"""Сравнивает ручную разметку (research/labels.csv) с оценками модели из запущенного сервера.

Запуск: python3 research/compare.py [--api http://localhost:8000]
"""
import argparse
import csv
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

CODES = {"01_contact": "c01", "02_needs": "c02", "03_identification": "c03", "04_consultation": "c04",
         "05_empathy": "c05", "06_dialog": "c06", "07_closing": "c07", "08_gross": "c08"}
NORM = {"да": "yes", "yes": "yes", "нет": "no", "no": "no", "n/a": "na", "na": "na"}


def get(api, path):
    with urllib.request.urlopen(api + path, timeout=30) as r:
        return json.loads(r.read())


def norm(v):
    v = str(v).strip().lower()
    return NORM.get(v, v.rstrip("0").rstrip(".") if "." in v else v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--labels", default=str(Path(__file__).with_name("labels.csv")))
    args = ap.parse_args()

    latest = {d["conversation_id"]: d["evaluation"] for d in get(args.api, "/api/dialogs")}
    hit, total = defaultdict(int), defaultdict(int)
    diffs = []
    with open(args.labels, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cid = row["conversation_id"]
            labeled = {k: row[f"{k}_answer"].strip() for k in CODES if row.get(f"{k}_answer", "").strip()}
            if not labeled:
                continue
            if not latest.get(cid):
                print(f"{cid}: нет оценки модели — оцените диалог в интерфейсе")
                continue
            ev = get(args.api, f"/api/evaluations/{latest[cid]['id']}")
            items = {it["criterion_id"]: it for it in ev["items"]}
            for k, human in labeled.items():
                model = items.get(CODES[k], {}).get("answer")
                ok = norm(human) == norm(model)
                total[k] += 1
                hit[k] += ok
                if not ok:
                    diffs.append((cid, row["language"], k, human, model, items.get(CODES[k], {}).get("explanation", "")))

    if not total:
        print("Нет размеченных строк в", args.labels)
        return
    print("\nСовпадение по критериям")
    for k in CODES:
        if total[k]:
            print(f"  {k:<20} {hit[k]:>3}/{total[k]:<3} {hit[k] / total[k] * 100:5.1f}%")
    all_hit, all_tot = sum(hit.values()), sum(total.values())
    print(f"  {'ВСЕГО':<20} {all_hit:>3}/{all_tot:<3} {all_hit / all_tot * 100:5.1f}%")

    print(f"\nРасхождения ({len(diffs)})")
    for cid, lang, k, human, model, expl in diffs:
        print(f"  {cid} [{lang}] {k}: человек={human} модель={model}\n      модель: {expl[:200]}")


if __name__ == "__main__":
    main()
