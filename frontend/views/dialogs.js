// Экран «Диалоги».
(function (CQA) {
  const { h, api } = CQA;
  const filters = { channel: "", language: "", status: "" };

  CQA.views.dialogs = async function () {
    const lists = await api.checklists();
    if (!lists.some((c) => c.id === CQA.state.checklist) && lists[0]) CQA.state.checklist = lists[0].id;
    const selected = new Set();
    const body = h("div", {});
    const notice = h("div", {});

    const groupInput = h("input", { class: "cqa-input", value: CQA.state.group, "aria-label": "group_id", style: "width:130px" });
    const force = h("input", { type: "checkbox" });
    const progress = h("div", {});
    const overview = h("div", {});
    const showError = (e) => CQA.put(notice, CQA.errorBox(e));

    async function loadTable() {
      const rows = await api.conversations({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, ...filters });
      CQA.put(body, rows.length ? table(rows) : h("div", { class: "cqa-empty" }, "Диалогов нет. Загрузите набор или измените фильтры."));
      const filtered = filters.channel || filters.language || filters.status;
      drawOverview(filtered ? await api.conversations({ group_id: CQA.state.group, checklist_id: CQA.state.checklist }) : rows);
    }

    // Баннер «ждут проверки» и плитки, как в макете.
    function drawOverview(all) {
      const scored = all.filter((r) => r.final_total !== null && r.final_total !== undefined);
      const avg = scored.length ? scored.reduce((a, r) => a + r.final_total, 0) / scored.length : null;
      const waiting = all.filter((r) => r.critical_flag || r.status === "needs_review" || r.status === "error" || r.open_appeals).length;
      const fresh = all.filter((r) => r.status === "new").length;
      const stat = (cls, ico, value, label) => h("div", { class: "cqa-card cqa-stat" }, h("span", { class: "cqa-tile3d " + cls, "aria-hidden": "true" }, ico), h("div", {}, h("b", {}, value), h("span", {}, label)));
      CQA.put(overview, 
        h("div", { class: "cqa-banner" },
          h("div", {},
            h("h2", {}, fresh ? `${fresh} диалогов ещё не оценены` : waiting ? `${waiting} диалога ждут проверки` : "Все диалоги проверены"),
            h("div", {}, fresh ? "Запустите оценку — ИИ проверит каждый диалог по чек-листу" : "Нарушения и спорные оценки показаны первыми"),
            h("button", { class: "cqa-banner-cta", onClick: () => evaluate(fresh ? { all: true } : { all: true, force: true }) }, fresh ? "Оценить всё" : "Оценить заново всё"))),
        h("div", { class: "cqa-stats" },
          stat("cqa-g", "💬", all.length, "Диалогов"),
          stat("cqa-t", "★", CQA.num(avg), "Средний балл"),
          stat("cqa-r", "⚠", all.filter((r) => r.critical_flag).length, "Грубые ошибки"),
          stat("cqa-p", "⚖", all.reduce((a, r) => a + (r.open_appeals || 0), 0), "Апелляции")));
    }

    function table(rows) {
      return h("div", { class: "cqa-table-wrap" }, h("table", { class: "cqa-table" },
        h("thead", {}, h("tr", {}, ["", "ID", "Канал", "Язык", "Длит.", "Реплик", "Статус", "Итог ИИ", "Финальный", "Грубая ошибка", "Апелляции"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map((r) => h("tr", { class: r.critical_flag ? "cqa-row-alert" : null, onClick: () => { location.hash = `#/dialog/${encodeURIComponent(r.group_id)}/${encodeURIComponent(r.conversation_id)}`; } },
          h("td", { onClick: (e) => e.stopPropagation() }, h("input", { type: "checkbox", "aria-label": "Выбрать " + r.conversation_id, onChange: (e) => { if (e.target.checked) selected.add(r.conversation_id); else selected.delete(r.conversation_id); } })),
          h("td", { class: "cqa-id" }, r.conversation_id),
          h("td", {}, CQA.channel(r.channel)), h("td", {}, r.language), h("td", {}, CQA.time(r.duration)), h("td", {}, r.turn_count),
          h("td", {}, CQA.statusTag(r.status)), h("td", {}, CQA.num(r.ai_total)),
          h("td", {}, h("b", {}, CQA.num(r.final_total))),
          h("td", {}, r.critical_flag ? h("span", { class: "cqa-tag cqa-tag-err" }, "⚠ Есть") : h("span", { class: "cqa-muted" }, "Нет")),
          h("td", {}, r.open_appeals ? h("span", { class: "cqa-tag cqa-tag-warn" }, r.open_appeals + " откр.") : h("span", { class: "cqa-muted" }, "—"))
        )))));
    }

    async function evaluate(payload) {
      CQA.put(notice, );
      try {
        const { job_id, total } = await api.evaluate({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, force: force.checked, ...payload });
        const job = await CQA.watchJob(job_id, (j) => {
          const finished = j.done + j.failed;
          CQA.put(progress, h("div", { class: "cqa-row", style: "margin-top:10px" }, h("div", { class: "cqa-progress cqa-grow" }, h("div", { style: `width:${total ? (100 * finished) / total : 100}%` })), h("span", { class: "cqa-small cqa-muted" }, `${finished} из ${total}`)));
        });
        CQA.toast(job.failed ? `Оценка завершена, требуют проверки: ${job.failed}` : "Оценка завершена");
        CQA.put(progress, );
        await loadTable();
      } catch (e) { showError(e); }
    }

    const filterSelect = (key, label, options) => h("select", { class: "cqa-input", "aria-label": label, onChange: (e) => { filters[key] = e.target.value; loadTable().catch(showError); } },
      options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)));

    await loadTable();

    return h("div", {},
      h("div", { class: "cqa-head" }, h("div", {}, h("h1", { class: "cqa-title" }, "Диалоги"), h("p", { class: "cqa-sub" }, "Набор " + CQA.state.group))),
      overview,
      h("div", { class: "cqa-card", style: "margin-bottom:12px" },
        h("div", { class: "cqa-row" },
          groupInput,
          h("button", { class: "cqa-btn", onClick: async () => {
            try {
              const g = groupInput.value.trim();
              const res = await api.importDataset(g);
              CQA.state.group = g;
              CQA.toast(`Загружено диалогов: ${res.imported}`);
              CQA.put(notice, );
              await loadTable();
            } catch (e) { showError(e); }
          } }, "Загрузить набор"),
          h("label", { class: "cqa-btn" }, "Загрузить файл", h("input", { type: "file", accept: ".json,application/json", style: "display:none", onChange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              const res = await api.upload(groupInput.value.trim() || "UPLOAD", JSON.parse(await file.text()));
              CQA.state.group = groupInput.value.trim() || "UPLOAD";
              CQA.toast(`Загружено диалогов: ${res.imported}`);
              await loadTable();
            } catch (err) { showError(err); }
            e.target.value = "";
          } })),
          h("span", { class: "cqa-sep" }),
          h("select", { class: "cqa-input", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; loadTable().catch(showError); } },
            lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, `${c.name} (версия ${c.version})`))),
          h("label", { class: "cqa-check" }, force, "Оценить заново"),
          h("button", { class: "cqa-btn", onClick: () => { if (!selected.size) { CQA.toast("Выберите диалоги в таблице"); return; } evaluate({ conversation_ids: [...selected] }); } }, "Оценить выбранные"),
          h("button", { class: "cqa-btn cqa-primary", onClick: () => evaluate({ all: true }) }, "Оценить всё")
        ),
        progress
      ),
      notice,
      h("div", { class: "cqa-card" },
        h("div", { class: "cqa-row", style: "margin-bottom:8px" },
          filterSelect("channel", "Канал", [["", "Все каналы"], ["agent chat", "Чаты"], ["voice call", "Звонки"]]),
          filterSelect("language", "Язык", [["", "Все языки"], ["RU", "RU"], ["KZ", "KZ"], ["EN", "EN"]]),
          filterSelect("status", "Статус", [["", "Все статусы"], ["done", "Оценён"], ["needs_review", "Нужна проверка"], ["error", "Ошибка"], ["new", "Не оценён"]])),
        body));
  };
})(window.CQA);
