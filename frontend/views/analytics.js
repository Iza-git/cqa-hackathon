// Экран «Аналитика»: где повторяются проблемы.
(function (CQA) {
  const { h, api } = CQA;

  CQA.views.analytics = async function () {
    const lists = await api.checklists();
    const data = await api.analytics({ group_id: CQA.state.group, checklist_id: CQA.state.checklist });
    const tile = (label, value) => h("div", { class: "cqa-card" }, h("div", { class: "cqa-tile-num" }, value), h("div", { class: "cqa-muted" }, label));
    const bar = (label, value, text) => h("div", { class: "cqa-bar-row" }, h("span", {}, label), h("div", { class: "cqa-bar" }, h("div", { style: `width:${Math.max(0, Math.min(100, value))}%` })), h("b", { style: "text-align:right" }, text));
    const a = data.appeals;

    return h("div", {},
      h("div", { class: "cqa-head" },
        h("div", {}, h("h1", { class: "cqa-title" }, "Аналитика"), h("p", { class: "cqa-sub" }, `Набор ${CQA.state.group}. Учтены финальные оценки.`)),
        h("select", { class: "cqa-input", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; CQA.rerender(); } }, lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, c.name)))),
      h("div", { class: "cqa-tiles" },
        tile("Оценено диалогов", data.evaluated), tile("Средний балл", CQA.num(data.average_total)),
        tile("С грубой ошибкой", data.critical_count), tile("Нужна проверка", data.needs_review)),
      h("div", { class: "cqa-two" },
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Самые слабые критерии"),
          data.weak_criteria.length ? data.weak_criteria.map((k) => bar(k.title, k.average_ratio * 100, Math.round(k.average_ratio * 100) + "%")) : h("div", { class: "cqa-empty" }, "Нет данных")),
        h("div", { class: "cqa-stack" },
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "По языкам"), data.by_language.map((x) => bar(`${x.language} (${x.count})`, x.average_total || 0, CQA.num(x.average_total)))),
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "По каналам"), data.by_channel.map((x) => bar(`${CQA.channel(x.channel)} (${x.count})`, x.average_total || 0, CQA.num(x.average_total)))),
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Апелляции"), h("div", { class: "cqa-row" },
            h("span", { class: "cqa-tag" }, "Всего: " + a.total), h("span", { class: "cqa-tag cqa-tag-warn" }, "Открыто: " + a.open),
            h("span", { class: "cqa-tag cqa-tag-ok" }, "Подтверждено: " + a.confirmed), h("span", { class: "cqa-tag" }, "Изменено: " + a.changed))))));
  };
})(window.CQA);
