# Graph Report - cqa-hackathon  (2026-11-07)

## Corpus Check
- 14 files · ~12,946 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .csv 1)

## Summary
- 165 nodes · 350 edges · 11 communities (8 shown, 3 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- server.py
- route
- evaluator.py
- cqa.js
- compute
- План команды — CQA Hackathon (Freedom Broker)
- Handler
- CQA — Conversation Quality Analytics
- Роль 2 — Ресерч: промпт и качество оценки

## God Nodes (most connected - your core abstractions)
1. `route()` - 25 edges
2. `Store` - 20 edges
3. `compute()` - 13 edges
4. `run_evaluation()` - 11 edges
5. `viewDialog()` - 11 edges
6. `evaluate()` - 9 edges
7. `Handler` - 9 edges
8. `ScoringTest` - 9 edges
9. `api()` - 9 edges
10. `renderQA()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `run_evaluation()` --uses--> `LLMError`  [INFERRED]
  server.py → cqa/evaluator.py
- `run_evaluation()` --calls--> `evaluate()`  [EXTRACTED]
  server.py → cqa/evaluator.py
- `validate()` --calls--> `normalize_answer()`  [EXTRACTED]
  cqa/evaluator.py → cqa/scoring.py

## Import Cycles
- None detected.

## Communities (11 total, 3 thin omitted)

### Community 0 - "server.py"
Cohesion: 0.10
Nodes (8): get(), main(), norm(), ApiError, batch_worker(), clean_checklist(), export_csv(), fetch_group()

### Community 1 - "route"
Cohesion: 0.23
Nodes (6): now(), Store, analytics(), one(), route(), run_evaluation()

### Community 2 - "evaluator.py"
Cohesion: 0.14
Nodes (13): build_prompt(), call_gemini(), compute_facts(), evaluate(), fmt_sec(), LLMError, message_offsets(), mock_llm() (+5 more)

### Community 3 - "cqa.js"
Cohesion: 0.22
Nodes (21): allowedAnswers(), answerLabel(), api(), detailBlock(), lossOf(), msgOffsets(), refreshMeta(), renderQA() (+13 more)

### Community 4 - "compute"
Cohesion: 0.18
Nodes (6): compute(), criterion_fraction(), normalize_answer(), scale_max(), answers(), ScoringTest

### Community 5 - "План команды — CQA Hackathon (Freedom Broker)"
Cohesion: 0.18
Nodes (10): 1 · Бэкенд, 2 · Ресерч, 3 · Фронтенд, 4 · Продукт и защита, Архитектура (решено), Задачи по ролям, План команды — CQA Hackathon (Freedom Broker), Риски (+2 more)

### Community 7 - "CQA — Conversation Quality Analytics"
Cohesion: 0.25
Nodes (7): API, CQA — Conversation Quality Analytics, Архитектура, Запуск (3 шага), Модель и стоимость, Тесты, Что умеет

### Community 8 - "Роль 2 — Ресерч: промпт и качество оценки"
Cohesion: 0.25
Nodes (7): Роль 2 — Ресерч: промпт и качество оценки, Чек-лист готовности, Шаг 1. Ручная разметка — часы 2–6, Шаг 2. Спорные случаи — параллельно с шагом 1, Шаг 3. Сравнение с моделью — часы 6–14, Шаг 4. Цифры для защиты — часы 14–17, Шаг 5. Контрольный набор — час 23

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `compute()` connect `compute` to `server.py`, `route`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `route()` (e.g. with `.activate_checklist()` and `.appeals()`) actually correct?**
  _`route()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Should `server.py` be split into smaller, more focused modules?**
  _Cohesion score 0.1028225806451613 - nodes in this community are weakly interconnected._
- **Why does `route()` connect `route` to `server.py`, `evaluator.py`, `Handler`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `run_evaluation()` (e.g. with `LLMError` and `.checklist()`) actually correct?**
  _`run_evaluation()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Should `evaluator.py` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._
- **Why does `Store` connect `route` to `server.py`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._