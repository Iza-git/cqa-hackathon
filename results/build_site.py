"""Собирает самостоятельный сайт в один HTML: frontend/ + настоящие диалоги DEV и ответы ИИ из cqa.db.

Запуск: python3 results/build_site.py  →  results/cqa_site.html (открывается без сервера)
"""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "frontend"

db = sqlite3.connect(ROOT / "cqa.db")
checklist = json.loads(db.execute("SELECT data FROM v2_checklists WHERE id='chat-quality' AND version=1").fetchone()[0])
latest = {}
for (d,) in db.execute("SELECT data FROM v2_evaluations WHERE group_id='DEV' AND checklist_id='chat-quality' AND checklist_version=1 AND status='done' ORDER BY id"):
    e = json.loads(d)
    latest[e["conversation_id"]] = e

conversations = []
for cid, d in db.execute("SELECT conversation_id, data FROM v2_conversations WHERE group_id='DEV' ORDER BY conversation_id"):
    c = json.loads(d)
    e = latest.get(cid)
    ts = [t["t"] for t in c["transcript"] if t["t"] is not None]
    item = {"conversation_id": cid, "channel": c["channel"], "language": c["language"], "transcript": c["transcript"]}
    if c["channel"] == "voice call" and ts:
        item["audio"] = max(ts) + 5  # длительность для плеера; настоящую запись (ссылку с подписью) не встраиваем
    if e:
        item["model"] = e.get("model")
        # ответ ИИ по критерию: [ответ, объяснение, доказательства, проверенный участок]
        item["script"] = {r["criterion_id"]: [r["ai_answer"], r["reason"], [{"id": x["id"], "quote": x["quote"]} for x in r["evidence"]], r["checked_range"]]
                          for r in e["results"]}
    conversations.append(item)

data = json.dumps({"checklist": checklist, "conversations": conversations}, ensure_ascii=False).replace("</", "<\\/")
assert "sig=" not in data, "в данные попала подписанная ссылка"

html = (FE / "index.html").read_text(encoding="utf-8")
html = html.replace('<link rel="stylesheet" href="app.css">', "<style>\n" + (FE / "app.css").read_text(encoding="utf-8") + "\n</style>")


def inline(m):
    src = m.group(1)
    code = 'window.CQA_API_BASE = "";\nwindow.CQA_MOCK = true;' if src == "config.js" else (FE / src).read_text(encoding="utf-8")
    pre = f"<script>window.CQA_DATA = {data};</script>\n" if src == "mock-api.js" else ""
    return pre + "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>"


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
html = html.replace("<title>CQA: контроль качества</title>", "<title>CQA: результаты оценки</title>")
out = ROOT / "results" / "cqa_site.html"
out.write_text(html, encoding="utf-8")
print(f"{out}  {out.stat().st_size // 1024} КБ, диалогов {len(conversations)}, с оценкой {sum('script' in c for c in conversations)}")
