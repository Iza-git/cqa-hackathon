"""Выгружает DEV-диалоги в читаемый Markdown и создаёт шаблон ручной разметки (CSV)."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
records = json.loads((ROOT / "data" / "dev.json").read_text(encoding="utf-8"))["data"]["records"]
out = ROOT / "research" / "dialogs"
out.mkdir(parents=True, exist_ok=True)

SPEAKER = {"client": "КЛИЕНТ", "operator": "ОПЕРАТОР", "bot": "бот", "system": "система"}
CRITERIA = [
    "01_contact", "02_needs", "03_identification", "04_consultation",
    "05_empathy", "06_dialog", "07_closing", "08_gross",
]

for r in records:
    lines = [f"# {r['conversation_id']}  ({r['channel']}, {r['language']})", ""]
    if r.get("audio_url"):
        lines += [f"Запись: {r['audio_url']}", ""]
    for i, m in enumerate(r["transcript"], 1):
        who = SPEAKER.get(m["speaker"], m["speaker"])
        lines.append(f"**[{i}] {m['timestamp']} {who}:** {m['text']}  ")
    (out / f"{r['conversation_id']}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

with open(ROOT / "research" / "labels_template.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    header = ["conversation_id", "channel", "language"]
    for c in CRITERIA:
        header += [f"{c}_answer", f"{c}_evidence", f"{c}_comment"]
    w.writerow(header + ["notes"])
    for r in records:
        w.writerow([r["conversation_id"], r["channel"], r["language"]] + [""] * (len(header) - 2))

print(f"{len(records)} диалогов -> {out}")
