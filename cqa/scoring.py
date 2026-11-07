"""Детерминированный подсчёт итога по чек-листу.

LLM выдаёт только ответы по критериям; баллы, перераспределение веса при N/A
и округление считает этот модуль, строго по правилам чек-листа.
"""
from __future__ import annotations

NA = "na"


def scale_max(criterion: dict) -> float:
    return max(float(s["value"]) for s in criterion.get("scale") or [{"value": 0}])


def normalize_answer(criterion: dict, answer):
    """Приводит ответ к допустимому для критерия значению или бросает ValueError."""
    if isinstance(answer, str):
        a = answer.strip().lower()
        if a in ("na", "n/a", "н/д"):
            if not criterion.get("na_allowed"):
                raise ValueError(f"N/A не разрешён для критерия {criterion['code']}")
            return NA
        if criterion["type"] in ("binary", "flag"):
            if a in ("yes", "да", "true"):
                return "yes"
            if a in ("no", "нет", "false"):
                return "no"
            raise ValueError(f"Ожидается yes/no для критерия {criterion['code']}: {answer!r}")
        try:
            answer = float(a)
        except ValueError:
            raise ValueError(f"Ожидается число для критерия {criterion['code']}: {answer!r}")
    if isinstance(answer, bool):
        return "yes" if answer else "no"
    if criterion["type"] == "scale" and isinstance(answer, (int, float)):
        allowed = [float(s["value"]) for s in criterion["scale"]]
        # модель иногда ставит промежуточное значение — берём ближайшую ступень шкалы
        snapped = min(allowed, key=lambda v: abs(v - float(answer)))
        return int(snapped) if snapped.is_integer() else snapped
    raise ValueError(f"Недопустимый ответ для критерия {criterion['code']}: {answer!r}")


def criterion_fraction(criterion: dict, answer) -> float | None:
    """Доля полного веса (0..1) или None, если критерий не участвует в итоге."""
    if answer == NA or criterion["type"] == "flag" or not criterion.get("weight"):
        return None
    if criterion["type"] == "binary":
        return 1.0 if answer == "yes" else 0.0
    top = scale_max(criterion)
    return float(answer) / top if top else 0.0


def compute(checklist: dict, answers: dict) -> dict:
    """answers: {criterion_id: answer}. Возвращает баллы по критериям, секциям и итог."""
    rounding = int(checklist.get("rounding", 2))
    applicable = []
    for c in checklist["criteria"]:
        frac = criterion_fraction(c, answers.get(c["id"], NA))
        if frac is not None:
            applicable.append((c, frac))
    total_weight = sum(float(c["weight"]) for c, _ in applicable)

    per_criterion = {}
    for c in checklist["criteria"]:
        a = answers.get(c["id"], NA)
        entry = {"answer": a, "weight": c["weight"], "effective_weight": 0.0, "points": None}
        frac = criterion_fraction(c, a)
        if frac is not None and total_weight:
            eff = float(c["weight"]) * 100.0 / total_weight
            entry["effective_weight"] = round(eff, rounding)
            entry["points"] = round(eff * frac, rounding)
        per_criterion[c["id"]] = entry

    total = None
    if total_weight:
        total = round(sum(float(c["weight"]) * 100.0 / total_weight * f for c, f in applicable), rounding)

    sections = []
    for s in checklist.get("sections", []):
        items = [(c, f) for c, f in applicable if c.get("section") == s["id"]]
        w = sum(float(c["weight"]) for c, _ in items)
        if not w:
            continue
        got = sum(float(c["weight"]) * f for c, f in items)
        sections.append({"id": s["id"], "name": s["name"], "percent": round(got / w * 100.0, rounding),
                         "points": round(got * 100.0 / total_weight, rounding),
                         "max_points": round(w * 100.0 / total_weight, rounding)})

    gross = any(c["type"] == "flag" and answers.get(c["id"]) == "yes" for c in checklist["criteria"])
    return {"total": total, "max": 100 if total_weight else None, "criteria": per_criterion,
            "sections": sections, "gross_violation": gross}
