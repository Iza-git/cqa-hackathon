// Экран «Анализ разговора»: плеер, расшифровка и оценка.
(function (CQA) {
  const { h, api } = CQA;

  function ring(total) {
    const r = 48, len = 2 * Math.PI * r, part = total === null ? 0 : Math.max(0, Math.min(100, total)) / 100;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "112"); svg.setAttribute("height", "112"); svg.setAttribute("aria-hidden", "true");
    const circle = (color, dash) => {
      const c = document.createElementNS(NS, "circle");
      Object.entries({ cx: 56, cy: 56, r, fill: "none", stroke: color, "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": dash }).forEach(([k, v]) => c.setAttribute(k, v));
      return c;
    };
    svg.append(circle("rgba(255,255,255,.3)", `${len} 0`));
    if (part > 0) svg.append(circle("#fff", `${len * part} ${len}`));
    return h("div", { class: "cqa-ring" }, svg, h("div", { class: "cqa-ring-text" },
      total === null ? h("span", { class: "cqa-small", style: "text-align:center" }, "Не оценива-", h("br", {}), "ется") : [h("span", { class: "cqa-ring-num" }, CQA.num(total)), h("span", { class: "cqa-small" }, "из 100")]));
  }

  function markFor(r) {
    if (r.is_critical) return r.final_answer === "yes" ? ["⚠", "cqa-mark-bad"] : ["✓", "cqa-mark-ok"];
    if (r.final_answer === "NA") return ["–", ""];
    if (r.points >= r.effective_weight) return ["✓", "cqa-mark-ok"];
    return r.points > 0 ? ["~", "cqa-mark-part"] : ["✕", "cqa-mark-bad"];
  }

  function buildPlayer(conv, audioRef) {
    const audio = h("audio", { src: api.audioUrl(conv.audio_path), preload: "metadata" });
    audioRef.el = audio;
    const lastT = conv.transcript.reduce((m, t) => Math.max(m, t.t || 0), 0);
    let duration = Math.max(conv.duration || 0, lastT, 1);
    const pct = (s) => (100 * s) / duration;
    const heads = [], frags = [];
    const lanes = [];

    function buildLane(speaker, cls) {
      const lane = h("div", { class: "cqa-lane " + cls, title: "Перейти к моменту записи", onClick: (e) => {
        const box = lane.getBoundingClientRect();
        audio.currentTime = ((e.clientX - box.left) / box.width) * duration;
      } });
      lanes.push({ lane, speaker });
      return lane;
    }
    function drawSegments() {
      lanes.forEach(({ lane, speaker }) => {
        lane.querySelectorAll(".cqa-seg").forEach((s) => s.remove());
        conv.transcript.forEach((t, i) => {
          if (t.speaker !== speaker || t.t === null) return;
          const next = conv.transcript.slice(i + 1).find((x) => x.t !== null);
          const end = next ? next.t : duration;
          lane.prepend(h("div", { class: "cqa-seg", style: `left:${pct(t.t)}%;width:${pct(end - t.t)}%` }));
        });
      });
    }
    const makeOverlay = () => {
      const f = h("div", { class: "cqa-frag", style: "display:none" });
      const l = h("div", { class: "cqa-head-line", style: "left:0" });
      frags.push(f); heads.push(l);
      return [f, l];
    };
    const clientLane = buildLane("client", "");
    const opLane = buildLane("operator", "cqa-lane-op");
    clientLane.append(...makeOverlay());
    opLane.append(...makeOverlay());
    drawSegments();

    const timeLabel = h("span", { class: "cqa-small" }, `00:00 / ${CQA.time(duration)}`);
    const range = h("input", { type: "range", min: 0, max: 1000, value: 0, "aria-label": "Позиция записи", onInput: (e) => { audio.currentTime = (e.target.value / 1000) * duration; } });
    const play = h("button", { class: "cqa-play", "aria-label": "Воспроизвести или поставить на паузу", onClick: () => (audio.paused ? audio.play() : audio.pause()) }, "▶");
    const errorBox = h("div", {});

    audio.addEventListener("play", () => { play.textContent = "❚❚"; });
    audio.addEventListener("pause", () => { play.textContent = "▶"; });
    audio.addEventListener("loadedmetadata", () => {
      if (isFinite(audio.duration) && audio.duration > 0) { duration = audio.duration; drawSegments(); }
    });
    audio.addEventListener("error", () => {
      CQA.put(errorBox, h("div", { class: "cqa-alert cqa-alert-warn", style: "margin:8px 0 0" }, "Запись не загрузилась. Расшифровка и оценка работают. ", h("a", { href: audio.src, target: "_blank", rel: "noopener" }, "Открыть запись отдельно")));
    });
    audio.addEventListener("timeupdate", () => {
      const now = audio.currentTime;
      heads.forEach((l) => { l.style.left = pct(now) + "%"; });
      range.value = (now / duration) * 1000;
      timeLabel.textContent = `${CQA.time(now)} / ${CQA.time(duration)}`;
      if (audioRef.onTime) audioRef.onTime(now);
    });
    audioRef.showFragment = (from, to) => {
      frags.forEach((f) => { f.style.display = ""; f.style.left = pct(from) + "%"; f.style.width = pct(Math.max(to - from, 0.5)) + "%"; });
    };
    audioRef.seek = (t) => { audio.currentTime = t; };

    return h("section", { class: "cqa-card cqa-player", "aria-label": "Запись разговора" }, audio,
      h("div", { class: "cqa-track" }, "Клиент", clientLane),
      h("div", { class: "cqa-track" }, "Оператор", opLane),
      h("div", { class: "cqa-controls" }, play, timeLabel, range),
      h("div", { class: "cqa-small cqa-muted", style: "margin-top:4px" }, "Дорожки показывают время реплик по расшифровке"),
      errorBox);
  }

  CQA.views.card = async function ([group, id], params) {
    const conv = await api.conversation(group, id);
    const evalId = Number(params.get("evaluation")) || (conv.evaluations[0] && conv.evaluations[0].id);
    const ev = evalId ? await api.evaluation(evalId) : null;
    const audioRef = {};
    const reload = () => CQA.rerender();
    if (conv.audio_path) CQA.cleanup = () => { if (audioRef.el) audioRef.el.pause(); };

    // Расшифровка
    const turnEls = {};
    const transcript = h("div", { class: "cqa-scroll", tabindex: "0", "aria-label": "Расшифровка" }, conv.transcript.map((t) => {
      const shown = conv.channel === "voice call" ? CQA.time(t.t) : t.timestamp;
      return (turnEls[t.id] = h("div", { class: "cqa-turn cqa-turn-" + t.speaker + (t.speaker === "bot" || t.speaker === "system" ? " cqa-turn-context" : ""), id: "cqa-turn-" + t.id },
        h("div", { class: "cqa-turn-meta" }, h("time", {}, shown), CQA.speaker(t.speaker)), h("div", {}, t.text)));
    }));
    const clearMarks = () => Object.values(turnEls).forEach((el) => el.classList.remove("cqa-turn-hl", "cqa-turn-range"));
    const indexOf = (uid) => conv.transcript.findIndex((t) => t.id === uid);

    function goToTurn(uid) {
      const i = indexOf(uid);
      if (i < 0) return;
      clearMarks();
      turnEls[uid].classList.add("cqa-turn-hl");
      turnEls[uid].scrollIntoView({ block: "center", behavior: "smooth" });
      const t = conv.transcript[i];
      if (audioRef.seek && t.t !== null) {
        audioRef.seek(t.t);
        const next = conv.transcript.slice(i + 1).find((x) => x.t !== null);
        audioRef.showFragment(t.t, next ? next.t : t.t + 5);
      }
    }
    function showRange(range) {
      const a = indexOf(range.from), b = indexOf(range.to);
      if (a < 0 || b < 0) return;
      clearMarks();
      conv.transcript.slice(a, b + 1).forEach((t) => turnEls[t.id].classList.add("cqa-turn-range"));
      turnEls[range.from].scrollIntoView({ block: "center", behavior: "smooth" });
      const from = conv.transcript[a].t, to = conv.transcript[b].t;
      if (audioRef.seek && from !== null && to !== null) { audioRef.seek(from); audioRef.showFragment(from, to); }
    }
    audioRef.onTime = (now) => {
      let current = null;
      conv.transcript.forEach((t) => { if (t.t !== null && t.t <= now) current = t.id; });
      Object.entries(turnEls).forEach(([uid, el]) => el.classList.toggle("cqa-turn-playing", uid === current && !audioRef.el.paused));
    };

    // Оценка
    function criterion(r, open) {
      const [mark, markCls] = markFor(r);
      const appeals = ev.appeals.filter((a) => a.criterion_id === r.criterion_id);
      const hasOpen = appeals.some((a) => a.status === "open");
      const isOperator = CQA.state.role === "Оператор";
      const form = h("div", { class: "cqa-stack", style: "display:none" });
      const comment = h("textarea", { class: "cqa-input", placeholder: "Почему вы не согласны с оценкой?", "aria-label": "Комментарий" });
      const formErr = h("div", {});
      form.append(comment, formErr, h("div", { class: "cqa-row" },
        h("button", { class: "cqa-btn cqa-primary", onClick: async () => {
          try {
            await api.appeal({ evaluation_id: ev.id, criterion_id: r.criterion_id, comment: comment.value, created_by: CQA.state.role });
            CQA.toast("Апелляция отправлена проверяющему");
            reload();
          } catch (e) { CQA.put(formErr, CQA.errorBox(e)); }
        } }, "Отправить"),
        h("button", { class: "cqa-btn", onClick: () => { form.style.display = "none"; } }, "Отмена")));

      const first = r.evidence[0];
      const full = r.final_answer === "NA" || (r.is_critical ? r.final_answer === "no" : r.points >= r.effective_weight);
      const body = h("div", { class: "cqa-crit-body", style: open ? "" : "display:none" },
        h("div", { class: "cqa-row" },
          h("span", { class: "cqa-tag" }, "Ответ: " + CQA.answer(r.final_answer)),
          !r.is_critical && h("span", { class: "cqa-tag" }, `Вес: ${CQA.num(r.base_weight)}` + (r.effective_weight && r.effective_weight !== r.base_weight ? ` → ${CQA.num(r.effective_weight)}` : "")),
          r.final_answer !== r.ai_answer && h("span", { class: "cqa-tag cqa-tag-warn" }, `ИИ: ${CQA.answer(r.ai_answer)} → проверяющий: ${CQA.answer(r.final_answer)}`)),
        h("div", {}, h("b", {}, r.final_answer === "NA" ? "Почему N/A" : full ? "Обоснование" : "Почему снижена оценка"), h("br", {}), r.reason),
        r.evidence.map((e) => h("div", { class: "cqa-quote" },
          h("div", {}, "«" + e.quote + "»"),
          h("div", { class: "cqa-small cqa-muted" }, "Реплика " + e.id + " ", !e.verified && h("span", { class: "cqa-tag cqa-tag-warn" }, "⚠ Доказательство не подтверждено")))),
        r.checked_range && h("div", { class: "cqa-small cqa-muted" }, `Проверенный участок: ${r.checked_range.from}–${r.checked_range.to}`),
        h("div", { class: "cqa-row" },
          first && h("button", { class: "cqa-btn cqa-primary", onClick: () => goToTurn(first.id) }, "Перейти к фрагменту"),
          !first && r.checked_range && h("button", { class: "cqa-btn cqa-primary", onClick: () => showRange(r.checked_range) }, "Показать проверенный участок"),
          isOperator && !hasOpen && h("button", { class: "cqa-btn cqa-btn-dispute", onClick: () => { form.style.display = ""; comment.focus(); } }, "Оспорить оценку"),
          hasOpen && h("span", { class: "cqa-tag cqa-tag-warn" }, "Апелляция на рассмотрении")),
        form,
        appeals.map((a) => h("div", { class: "cqa-history" },
          h("b", {}, a.status === "open" ? "Апелляция открыта" : a.decision === "changed" ? "Оценка изменена" : "Оценка подтверждена"),
          h("div", {}, "Комментарий: " + a.comment),
          a.status === "resolved" && h("div", {}, `Исходная оценка: ${CQA.answer(r.ai_answer)}. Финальная: ${CQA.answer(r.final_answer)}.`),
          a.decision_reason && h("div", {}, "Причина решения: " + a.decision_reason))));

      const head = h("button", { class: "cqa-crit-head", "aria-expanded": open ? "true" : "false", onClick: () => {
        const nowOpen = body.style.display === "none";
        body.style.display = nowOpen ? "" : "none";
        head.setAttribute("aria-expanded", nowOpen ? "true" : "false");
      } },
        h("span", { class: "cqa-mark " + markCls, "aria-hidden": "true" }, mark),
        h("span", {}, r.title),
        h("span", { class: "cqa-points" }, r.is_critical ? (r.final_answer === "yes" ? "Выявлено" : "Нет") : r.final_answer === "NA" ? "N/A" : `${CQA.num(r.points)} / ${CQA.num(r.effective_weight)}`));
      return h("div", { class: "cqa-crit" }, head, body);
    }

    function scorePanel() {
      if (!ev) return h("div", { class: "cqa-empty" }, "Диалог ещё не оценён.", h("br", {}), h("br", {}), evaluateButton("Оценить"));
      if (ev.status === "queued" || ev.status === "running") return h("div", { class: "cqa-empty" }, "Идёт оценка. Обновите страницу через несколько секунд.");
      if (!ev.results.length) return h("div", {}, h("div", { class: "cqa-alert cqa-alert-warn" }, CQA.statusTag(ev.status), " ", ev.error || "Оценка не получена."), evaluateButton("Повторить оценку"));
      const firstLost = ev.results.find((r) => !r.is_critical && r.final_answer !== "NA" && r.points < r.effective_weight);
      const changed = ev.final_total !== ev.ai_total;
      return h("div", {},
        ev.final_critical_flag && h("div", { class: "cqa-alert cqa-alert-err", role: "alert" }, "⚠ Грубая ошибка. Диалог нужно проверить в первую очередь."),
        h("div", { class: "cqa-summary" }, ring(ev.final_total),
          h("div", { class: "cqa-grow", style: "min-width:190px" },
            changed && h("div", { class: "cqa-small", style: "margin-bottom:6px" }, `ИИ: ${CQA.num(ev.ai_total)} → финальный: `, h("b", {}, CQA.num(ev.final_total))),
            ev.sections.filter((s) => s.score !== null).map((s) => h("div", { class: "cqa-section-row cqa-small" }, h("span", { class: "cqa-muted" }, s.section), h("b", {}, CQA.num(s.score)))))),
        ev.results.map((r) => criterion(r, firstLost ? r === firstLost : false)),
        h("div", { class: "cqa-small cqa-muted", style: "margin-top:8px" }, `Чек-лист: версия ${ev.checklist_version}. Модель: ${ev.model}.`));
    }

    function evaluateButton(label) {
      return h("button", { class: "cqa-btn cqa-primary", onClick: async () => {
        try {
          const { job_id } = await api.evaluate({ group_id: group, conversation_ids: [id], checklist_id: CQA.state.checklist, force: true });
          await CQA.watchJob(job_id, () => {});
          location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(id)}`;
          reload();
        } catch (e) { CQA.toast("Не удалось оценить: " + e.message); }
      } }, label);
    }

    const evalSelect = conv.evaluations.length > 1 && h("select", { class: "cqa-input", "aria-label": "Оценка", onChange: (e) => { location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(id)}?evaluation=${e.target.value}`; } },
      conv.evaluations.map((x) => h("option", { value: x.id, selected: ev && x.id === ev.id }, `${x.checklist_id} v${x.checklist_version}: ${CQA.num(x.final_total)}`)));

    return h("div", { class: conv.audio_path ? "cqa-has-player" : "" },
      h("div", { class: "cqa-head" },
        h("div", {},
          h("h1", { class: "cqa-title" }, "Анализ разговора"),
          h("p", { class: "cqa-sub" }, [conv.conversation_id, CQA.channel(conv.channel), CQA.language(conv.language), CQA.time(conv.duration)].join(" · "))),
        h("div", { class: "cqa-row" }, evalSelect, h("a", { class: "cqa-btn", href: "#/dialogs", style: "text-decoration:none" }, "← К списку"))),
      conv.audio_path && buildPlayer(conv, audioRef),
      h("div", { class: "cqa-split" },
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Расшифровка"), transcript),
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Оценка качества"), h("div", { class: "cqa-scroll" }, scorePanel()))));
  };
})(window.CQA);
