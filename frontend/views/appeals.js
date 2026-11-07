// Экран «Апелляции»: очередь и решение проверяющего.
(function (CQA) {
  const { h, api } = CQA;
  let statusFilter = "open";

  CQA.views.appeals = async function () {
    let selectedId = null;
    const left = h("div", { class: "cqa-card" });
    const right = h("div", { class: "cqa-card" });
    let list = [];

    async function load() {
      list = await api.appeals(statusFilter);
      if (!list.some((a) => a.id === selectedId)) selectedId = list[0] ? list[0].id : null;
      draw();
    }

    function draw() {
      CQA.put(left, 
        h("select", { class: "cqa-input", style: "width:100%;margin-bottom:8px", "aria-label": "Статус", onChange: (e) => { statusFilter = e.target.value; load(); } },
          [["open", "Открытые"], ["resolved", "Закрытые"], ["", "Все"]].map(([v, t]) => h("option", { value: v, selected: statusFilter === v }, t))),
        list.length ? list.map((a) => h("button", { class: "cqa-list-item" + (a.id === selectedId ? " cqa-active" : ""), onClick: () => { selectedId = a.id; draw(); } },
          h("b", {}, a.title), h("div", { class: "cqa-small cqa-muted" }, a.conversation_id), a.status === "open" ? h("span", { class: "cqa-tag cqa-tag-warn" }, "Открыта") : h("span", { class: "cqa-tag cqa-tag-ok" }, a.decision === "changed" ? "Изменена" : "Подтверждена")))
          : h("div", { class: "cqa-empty" }, "Апелляций нет"));
      const a = list.find((x) => x.id === selectedId);
      CQA.put(right, (a ? detail(a) : [h("div", { class: "cqa-empty" }, "Откройте карточку диалога и оспорьте критерий в роли оператора. Здесь появится обращение.")]));
    }

    function detail(a) {
      const reviewer = CQA.state.role === "Проверяющий";
      const options = (a.type === "yes_no" ? [["yes", "Да"], ["no", "Нет"]] : a.steps.map((s) => [String(s.value), s.value + (s.label ? ": " + s.label : "")]));
      if (a.na_allowed) options.push(["NA", "N/A"]);
      const reason = h("textarea", { class: "cqa-input", placeholder: "Причина решения (обязательно)", "aria-label": "Причина решения" });
      const select = h("select", { class: "cqa-input", style: "width:100%;display:none", "aria-label": "Новая оценка" }, options.map(([v, t]) => h("option", { value: v, selected: v === String(a.final_answer) }, t)));
      const err = h("div", {});
      let decision = "confirmed";
      const radio = (value, label) => h("label", { class: "cqa-check" }, h("input", { type: "radio", name: "cqa-decision", value, checked: value === decision, onChange: () => { decision = value; select.style.display = value === "changed" ? "" : "none"; } }), label);
      const submit = async () => {
        try {
          const ev = await api.decide(a.id, { decision, new_answer: decision === "changed" ? select.value : null, decision_reason: reason.value, decided_by: CQA.state.role });
          CQA.toast(`Решение сохранено. Итог: ${CQA.num(ev.ai_total)} → ${CQA.num(ev.final_total)}`);
          await load();
        } catch (e) { CQA.put(err, CQA.errorBox(e)); }
      };

      const evIds = new Set(a.evidence.map((e) => e.id));
      return [
        h("div", { class: "cqa-head" },
          h("div", {}, h("h2", { class: "cqa-card-title", style: "margin:0" }, a.title), h("div", { class: "cqa-small cqa-muted" }, `${a.conversation_id} · ${CQA.channel(a.channel)} · ${CQA.language(a.language)}`)),
          h("a", { class: "cqa-btn", style: "text-decoration:none", href: `#/dialog/${encodeURIComponent(a.group_id)}/${encodeURIComponent(a.conversation_id)}?evaluation=${a.evaluation_id}` }, "Открыть диалог")),
        h("div", { class: "cqa-stack" },
          h("div", { class: "cqa-row" }, h("span", { class: "cqa-tag" }, "Оценка ИИ: " + CQA.answer(a.ai_answer)), h("span", { class: "cqa-tag" }, "Сейчас: " + CQA.answer(a.final_answer)), h("span", { class: "cqa-tag" }, `Итог: ${CQA.num(a.ai_total)} → ${CQA.num(a.final_total)}`)),
          h("div", {}, h("b", {}, "Объяснение ИИ"), h("br", {}), a.reason),
          h("div", {}, h("b", {}, "Комментарий оператора"), h("br", {}), a.comment),
          h("div", {}, h("b", {}, "Фрагмент диалога"),
            a.fragment.map((t) => h("div", { class: "cqa-turn" + (evIds.has(t.id) ? " cqa-turn-hl" : "") }, h("div", { class: "cqa-turn-meta" }, h("time", {}, CQA.time(t.t)), CQA.speaker(t.speaker)), h("div", {}, t.text)))),
          a.status === "resolved"
            ? h("div", { class: "cqa-history" }, h("b", {}, a.decision === "changed" ? "Оценка изменена" : "Оценка подтверждена"), h("div", {}, `Исходная: ${CQA.answer(a.ai_answer)}. Финальная: ${CQA.answer(a.final_answer)}.`), h("div", {}, "Причина: " + a.decision_reason), h("div", {}, `Итог: ${CQA.num(a.ai_total)} → ${CQA.num(a.final_total)}`))
            : reviewer
              ? h("div", { class: "cqa-stack" }, h("div", { class: "cqa-row" }, radio("confirmed", "Подтвердить"), radio("changed", "Изменить")), select, reason, err, h("div", {}, h("button", { class: "cqa-btn cqa-primary", onClick: submit }, "Сохранить решение")))
              : h("div", { class: "cqa-alert cqa-alert-warn" }, "Решение принимает проверяющий. Смените роль в меню слева.")),
      ];
    }

    await load();
    return h("div", {},
      h("div", { class: "cqa-head" }, h("div", {}, h("h1", { class: "cqa-title" }, "Апелляции"), h("p", { class: "cqa-sub" }, "Спорные оценки и решения проверяющего"))),
      h("div", { class: "cqa-master" }, left, right));
  };
})(window.CQA);
