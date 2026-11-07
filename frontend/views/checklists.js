// Экран «Чек-листы»: критерии, веса, шкалы и версии.
(function (CQA) {
  const { h, api } = CQA;

  CQA.views.checklists = async function () {
    const lists = await api.checklists();
    const left = h("div", { class: "cqa-card" });
    const right = h("div", { class: "cqa-stack" });
    let current = null, readOnly = false, versions = [];

    async function open(id, version) {
      versions = await api.versions(id);
      const latest = versions[0].version;
      const data = await api.version(id, version || latest);
      current = JSON.parse(JSON.stringify(data));
      readOnly = current.version !== latest;
      draw();
    }

    function drawLeft() {
      CQA.put(left, 
        h("h2", { class: "cqa-card-title" }, "Чек-листы"),
        lists.map((c) => h("button", { class: "cqa-list-item" + (current && current.id === c.id ? " cqa-active" : ""), onClick: () => open(c.id) }, h("b", {}, c.name), h("div", { class: "cqa-small cqa-muted" }, `Версия ${c.version} · критериев: ${c.criteria.length}`))),
        h("button", { class: "cqa-btn", style: "width:100%;margin-top:8px", onClick: () => {
          current = { id: null, version: 0, name: "Новый чек-лист", criteria: [] };
          readOnly = false; versions = [];
          draw();
        } }, "+ Новый чек-лист"),
        versions.length > 0 && h("div", { style: "margin-top:14px" },
          h("div", { class: "cqa-small cqa-muted", style: "font-weight:600;margin-bottom:4px" }, "История версий"),
          versions.map((v) => h("button", { class: "cqa-list-item" + (current && v.version === current.version ? " cqa-active" : ""), onClick: () => open(v.id, v.version) }, `Версия ${v.version}`, h("div", { class: "cqa-small cqa-muted" }, new Date(v.created_at).toLocaleString("ru-RU"))))));
    }

    const newId = () => {
      let i = 1;
      while (current.criteria.some((c) => c.id === "c" + String(i).padStart(2, "0"))) i++;
      return "c" + String(i).padStart(2, "0");
    };

    function stepsEditor(c) {
      const box = h("div", {});
      const draw2 = () => CQA.put(box, 
        h("div", { class: "cqa-small cqa-muted", style: "font-weight:600;margin-bottom:4px" }, "Ступени шкалы"),
        c.steps.map((s, i) => h("div", { class: "cqa-step" },
          h("input", { class: "cqa-input", type: "number", min: 0, value: s.value, disabled: readOnly, "aria-label": "Балл", onInput: (e) => { s.value = Number(e.target.value); } }),
          h("input", { class: "cqa-input", value: s.label, disabled: readOnly, placeholder: "Описание ступени", "aria-label": "Описание", onInput: (e) => { s.label = e.target.value; } }),
          !readOnly && h("button", { class: "cqa-btn cqa-danger", "aria-label": "Удалить ступень", onClick: () => { c.steps.splice(i, 1); draw2(); } }, "✕"))),
        !readOnly && h("button", { class: "cqa-btn", onClick: () => { c.steps.push({ value: 0, label: "" }); draw2(); } }, "+ Ступень"));
      draw2();
      return box;
    }

    function criterionEditor(c, index, updateSum) {
      const field = (label, input) => h("label", { class: "cqa-field" }, label, input);
      const typeSelect = h("select", { class: "cqa-input", disabled: readOnly || c.is_critical, onChange: (e) => {
        c.type = e.target.value;
        if (c.type === "scale" && !c.steps.length) c.steps = [{ value: 10, label: "" }, { value: 0, label: "" }];
        draw();
      } }, [["yes_no", "Да / Нет"], ["scale", "Шкала"]].map(([v, t]) => h("option", { value: v, selected: c.type === v }, t)));
      return h("div", { class: "cqa-editor-crit" },
        h("div", { class: "cqa-row" }, h("b", { class: "cqa-grow" }, `${index + 1}. ${c.title || "Новый критерий"}`),
          !readOnly && h("button", { class: "cqa-btn cqa-danger", onClick: () => { current.criteria.splice(index, 1); draw(); } }, "Удалить")),
        h("div", { class: "cqa-editor-grid" },
          field("Название", h("input", { class: "cqa-input", value: c.title, disabled: readOnly, onInput: (e) => { c.title = e.target.value; } })),
          field("Секция", h("input", { class: "cqa-input", value: c.section, disabled: readOnly, onInput: (e) => { c.section = e.target.value; } })),
          field("Тип", typeSelect),
          field("Вес", h("input", { class: "cqa-input", type: "number", min: 0, value: c.weight, disabled: readOnly || c.is_critical, onInput: (e) => { c.weight = Number(e.target.value); updateSum(); } }))),
        field("Инструкция для ИИ", h("textarea", { class: "cqa-input", value: c.instruction, disabled: readOnly, onInput: (e) => { c.instruction = e.target.value; } })),
        c.type === "scale" && stepsEditor(c),
        h("div", { class: "cqa-row" },
          h("label", { class: "cqa-check" }, h("input", { type: "checkbox", checked: c.na_allowed, disabled: readOnly || c.is_critical, onChange: (e) => { c.na_allowed = e.target.checked; draw(); } }), "Разрешён N/A"),
          h("label", { class: "cqa-check" }, h("input", { type: "checkbox", checked: c.is_critical, disabled: readOnly, onChange: (e) => {
            c.is_critical = e.target.checked;
            if (c.is_critical) Object.assign(c, { type: "yes_no", weight: 0, na_allowed: false, na_condition: "" });
            draw();
          } }), "Грубая ошибка (без баллов, только флаг)")),
        c.na_allowed && field("Условие N/A", h("input", { class: "cqa-input", value: c.na_condition, disabled: readOnly, onInput: (e) => { c.na_condition = e.target.value; } })));
    }

    function draw() {
      drawLeft();
      if (!current) { CQA.put(right, h("div", { class: "cqa-card cqa-empty" }, "Выберите чек-лист")); return; }
      const sum = h("span", {});
      const updateSum = () => {
        const s = current.criteria.reduce((a, c) => a + Number(c.weight || 0), 0);
        CQA.put(sum, h("span", { class: "cqa-tag " + (s === 100 ? "cqa-tag-ok" : "cqa-tag-warn") }, `Сумма весов: ${s}` + (s === 100 ? " ✓" : ", итог будет приведён к 100")));
      };
      updateSum();
      const msg = h("div", {});
      const save = async () => {
        CQA.put(msg, );
        try {
          const payload = { name: current.name, criteria: current.criteria };
          const saved = current.id ? await api.updateChecklist(current.id, payload) : await api.createChecklist(payload);
          const fresh = await api.checklists();
          lists.splice(0, lists.length, ...fresh);
          CQA.state.checklist = saved.id;
          await open(saved.id);
          right.prepend(h("div", { class: "cqa-alert cqa-alert-ok cqa-row" }, h("span", { class: "cqa-grow" }, `Создана версия ${saved.version}. Старые оценки сохранены на своей версии.` + (saved.warnings && saved.warnings.length ? " " + saved.warnings.join(" ") : "")), h("a", { class: "cqa-btn cqa-primary", href: "#/dialogs", style: "text-decoration:none" }, "Применить к диалогам")));
        } catch (e) { CQA.put(msg, CQA.errorBox(e)); }
      };
      CQA.put(right, 
        readOnly && h("div", { class: "cqa-alert cqa-alert-warn" }, `Версия ${current.version} только для чтения. Изменять можно последнюю версию.`),
        h("div", { class: "cqa-card cqa-row" },
          h("label", { class: "cqa-field cqa-grow" }, "Название чек-листа", h("input", { class: "cqa-input", value: current.name, disabled: readOnly, onInput: (e) => { current.name = e.target.value; } })),
          sum,
          !readOnly && h("button", { class: "cqa-btn", onClick: () => {
            current.criteria.push({ id: newId(), section: "", title: "", instruction: "", type: "yes_no", weight: 0, steps: [], na_allowed: false, na_condition: "", is_critical: false });
            draw();
          } }, "+ Критерий"),
          !readOnly && h("button", { class: "cqa-btn cqa-primary", onClick: save }, "Сохранить")),
        msg,
        current.criteria.map((c, i) => criterionEditor(c, i, updateSum)));
    }

    if (lists[0]) await open((lists.find((c) => c.id === CQA.state.checklist) || lists[0]).id);
    else draw();

    return h("div", {},
      h("div", { class: "cqa-head" }, h("div", {}, h("h1", { class: "cqa-title" }, "Чек-листы"), h("p", { class: "cqa-sub" }, "Каждое сохранение создаёт новую версию"))),
      h("div", { class: "cqa-master" }, left, right));
  };
})(window.CQA);
