/* CQA — рабочее место контроля качества. Чистый JS без зависимостей.
   Монтируется в #cqa-app; data-api задаёт адрес сервиса (для встраивания в Dynamics 365). */
(function () {
  "use strict";

  const root = document.getElementById("cqa-app");
  const API = (root.dataset.api || "").replace(/\/$/, "");
  const state = { config: {}, checklists: [], active: null, job: null, filters: { q: "", lang: "", ch: "", group: "", status: "" } };

  const ROLE = { client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система" };
  const LANG = { RU: "Русский", KZ: "Қазақша", EN: "English" };
  const ANS = { yes: "Да", no: "Нет", na: "N/A" };
  const I = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zm14 0-3 7a3 3 0 0 0 6 0l-3-7z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    ok: '<path d="m5 12 5 5L20 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', minus: '<path d="M6 12h12"/>',
    back: '<path d="M15 18l-6-6 6-6"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    play: '<path d="M7 4.5v15l13-7.5z"/>', pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    dl: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>', next: '<path d="m9 6 6 6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  };
  const ic = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${I[n]}</svg>`;

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => [...el.querySelectorAll(sel)];
  const num = (v) => (v == null ? "—" : String(Math.round(v * 100) / 100).replace(".", ","));
  const tone = (v) => (v == null ? "" : v >= 85 ? "hi" : v >= 65 ? "mid" : "lo");
  const toneColor = (v) => (v == null ? "var(--line-2)" : v >= 85 ? "var(--green)" : v >= 65 ? "var(--warn)" : "var(--bad)");
  const fmtSec = (s) => { s = Math.max(0, Math.round(s || 0)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

  async function api(path, opts = {}) {
    const res = await fetch(API + "/api" + path, {
      method: opts.body ? "POST" : opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({ error: "Некорректный ответ сервера" }));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 200); }, err ? 6000 : 3200);
  }

  const scaleTop = (c) => Math.max(...c.scale.map((s) => s.value));
  function answerLabel(c, a) {
    if (a === "na") return "N/A";
    if (c && c.type === "scale") return `${a} / ${scaleTop(c)}`;
    return ANS[a] || String(a);
  }
  function answerKind(c, a) {
    if (a === "na") return "na";
    if (c.type === "flag") return a === "yes" ? "no" : "yes";
    if (c.type === "binary") return a === "yes" ? "yes" : "no";
    return +a >= scaleTop(c) ? "yes" : +a > 0 ? "part" : "no";
  }
  const answerChip = (c, a) => `<span class="chip ${{ part: "warn" }[answerKind(c, a)] || answerKind(c, a)}">${esc(answerLabel(c, a))}</span>`;
  const answerIcon = (c, a) => { const k = answerKind(c, a); return `<span class="ic ${k}">${k === "na" ? "N/A" : ic(k === "yes" ? "ok" : k === "part" ? "minus" : "x")}</span>`; };
  function allowedAnswers(c) {
    const xs = c.type === "scale" ? c.scale.map((s) => ({ v: s.value, l: `${s.value} — ${s.description}` })) : [{ v: "yes", l: "Да" }, { v: "no", l: "Нет" }];
    if (c.na_allowed) xs.push({ v: "na", l: "N/A — " + (c.na_condition || "неприменимо") });
    return xs;
  }
  function msgOffsets(tr) {
    if (!tr.length) return [];
    if (/^\d+:\d{2}(:\d{2})?$/.test(tr[0].timestamp)) return tr.map((m) => { const p = m.timestamp.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; });
    const t0 = Date.parse(tr[0].timestamp);
    return tr.map((m) => Math.max(0, (Date.parse(m.timestamp) - t0) / 1000));
  }

  // ---------- каркас ----------
  function shell() {
    root.innerHTML = `
      <aside class="cqa-side">
        <div class="cqa-logo">
          <svg viewBox="0 0 30 34" aria-hidden="true"><defs><linearGradient id="cqa-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dffb4"/><stop offset="1" stop-color="#16b85a"/></linearGradient></defs>
            <path d="M15 1 28 5.5V17c0 8-6 13.5-13 16C8 30.5 2 25 2 17V5.5z" fill="url(#cqa-g)"/>
            <path d="M10 9h11v3.6h-7.2v2.6H20v3.5h-6.2V26H10z" fill="#04140c"/></svg>
          <div><div class="wm">FREEDOM</div><span class="tag">CQA · КАЧЕСТВО</span></div>
        </div>
        <nav class="cqa-nav">
          <span class="nav-l">Работа</span>
          <a href="#/dialogs" data-nav="dialogs">${ic("chat")}<span class="t">Диалоги</span></a>
          <a href="#/appeals" data-nav="appeals">${ic("scale")}<span class="t">Апелляции</span><span class="cnt" id="cqa-appeal-cnt" hidden></span></a>
          <a href="#/analytics" data-nav="analytics">${ic("chart")}<span class="t">Аналитика</span></a>
          <span class="nav-l">Настройка</span>
          <a href="#/checklist" data-nav="checklist">${ic("check")}<span class="t">Чек-лист</span></a>
        </nav>
        <div class="cqa-side-foot" id="cqa-status"></div>
      </aside>
      <main class="cqa-main" id="cqa-view"></main>`;
  }

  async function refreshMeta() {
    try {
      const [cfg, active, appeals, cls] = await Promise.all([api("/config"), api("/checklists/active"), api("/appeals?status=open"), api("/checklists")]);
      state.config = cfg; state.active = active; state.checklists = cls;
      const cnt = $("#cqa-appeal-cnt");
      cnt.hidden = !appeals.length; cnt.textContent = appeals.length;
      const ok = cfg.llm === "mock" || cfg.has_key;
      $("#cqa-status").innerHTML = `<span class="cqa-dot ${ok ? "" : "off"}"></span>${cfg.llm === "mock" ? "Тестовый режим (mock)" : ok ? `<b>${esc(cfg.model)}</b>` : "Нет ключа Gemini"}<br>Чек-лист <b>v${active.id}</b> · ${active.criteria.length} критериев<br><kbd>?</kbd> горячие клавиши`;
    } catch (e) { $("#cqa-status").innerHTML = `<span class="cqa-dot off"></span>Сервис недоступен`; }
  }

  let cleanup = null;
  function router() {
    if (cleanup) { cleanup(); cleanup = null; }
    const [path, qs] = (location.hash || "#/dialogs").slice(2).split("?");
    const [view, id] = path.split("/");
    $$(".cqa-nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view === "dialog" ? "dialogs" : view || "dialogs")));
    const v = $("#cqa-view");
    v.innerHTML = `<div class="empty"><span class="spin"></span></div>`;
    const views = { dialogs: viewDialogs, dialog: (el) => viewDialog(el, decodeURIComponent(id || ""), new URLSearchParams(qs)), appeals: viewAppeals, checklist: viewChecklist, analytics: viewAnalytics };
    (views[view] || viewDialogs)(v).catch((e) => { v.innerHTML = `<div class="panel empty">Ошибка: ${esc(e.message)}</div>`; });
    window.scrollTo(0, 0);
  }

  // ---------- общие блоки страницы ----------
  const pageHead = (title, sub, actions = "") => `
    <header class="page-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="page-actions">${actions}</div></header>`;

  function statusOf(d) {
    const e = d.evaluation;
    if (!e) return { k: "todo", cls: "", label: "Не оценён" };
    if (e.gross_violation) return { k: "gross", cls: "no", label: "Грубая ошибка" };
    if (e.open_appeals) return { k: "appeal", cls: "warn", label: "Апелляция" };
    if (e.low_confidence) return { k: "review", cls: "info", label: "Проверить" };
    return { k: "ok", cls: "yes", label: "Готово" };
  }

  // ---------- диалоги ----------
  async function viewDialogs(v) {
    const f = state.filters;
    const [dialogs, groups] = await Promise.all([api("/dialogs" + (f.group ? "?group_id=" + encodeURIComponent(f.group) : "")), api("/groups")]);
    const evald = dialogs.filter((d) => d.evaluation);
    const avg = evald.length ? evald.reduce((s, d) => s + (d.evaluation.total || 0), 0) / evald.length : null;
    const count = (k) => dialogs.filter((d) => statusOf(d).k === k).length;
    const stat = (k, label, value, hint, cls = "") => `
      <button class="stat ${k && f.status === k ? "on" : ""} ${cls}" data-st="${k}"><span class="l">${label}</span><span class="v">${value}</span><span class="h">${hint}</span></button>`;

    v.innerHTML = pageHead("Диалоги", `${dialogs.length} чатов и звонков · набор ${groups.map((g) => esc(g.group_id)).join(", ") || "не загружен"}`, `
        <details class="pop"><summary class="btn">${ic("dl")} Данные</summary>
          <div class="pop-body">
            <label class="f">Загрузить набор по group_id<span class="row"><input id="load-group" placeholder="например, DEV"><button class="btn" id="load-btn">Загрузить</button></span></label>
            <label class="f">Показывать набор<select id="f-group"><option value="">Все наборы</option>${groups.map((g) => `<option ${g.group_id === f.group ? "selected" : ""}>${esc(g.group_id)} · ${g.n}</option>`).join("")}</select></label>
            <a class="btn" href="${API}/api/export.csv${f.group ? "?group_id=" + encodeURIComponent(f.group) : ""}">${ic("dl")} Скачать результаты CSV</a>
          </div></details>
        <button class="btn pri" id="batch-btn">${ic("bolt")} Оценить все неоценённые</button>`) + `
      ${evald.length ? "" : `<div class="guide">${ic("bolt")}<div><b>С чего начать.</b> Нажмите «Оценить все неоценённые» — модель проверит каждый диалог по чек-листу.
        Затем откройте диалог, чтобы увидеть баллы, доказательства и оспорить оценку.</div></div>`}
      <div class="stats">
        ${stat("todo", "Не оценены", count("todo"), "ждут оценки")}
        ${stat("", "Средний балл", `<span class="c-${tone(avg)}">${num(avg)}</span>`, `${evald.length} оценено · все диалоги`)}
        ${stat("review", "Проверить", count("review"), "модель не уверена", "info")}
        ${stat("gross", "Грубые ошибки", count("gross"), "отдельно от балла", count("gross") ? "bad" : "")}
      </div>
      <div id="job-box"></div>
      <div class="toolbar">
        <label class="search">${ic("search")}<input id="f-q" placeholder="Поиск по ID диалога" value="${esc(f.q)}"><kbd>/</kbd></label>
        <div class="seg" id="f-lang">${["", "RU", "KZ", "EN"].map((l) => `<button data-v="${l}" class="${l === f.lang ? "on" : ""}">${l || "Все языки"}</button>`).join("")}</div>
        <div class="seg" id="f-ch">${[["", "Все каналы"], ["agent chat", "Чаты"], ["voice call", "Звонки"]].map(([k, l]) => `<button data-v="${k}" class="${k === f.ch ? "on" : ""}">${l}</button>`).join("")}</div>
        ${f.status ? `<button class="btn sm ghost" id="f-reset">${ic("x")} Сбросить фильтр «${esc({ todo: "Не оценены", review: "Проверить", gross: "Грубые ошибки", appeal: "Апелляция" }[f.status])}»</button>` : ""}
      </div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Диалог</th><th>Канал</th><th>Итоговый балл</th><th>Статус</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;

    const draw = () => {
      const rows = dialogs.filter((d) => (!f.q || d.conversation_id.includes(f.q)) && (!f.lang || d.language === f.lang) && (!f.ch || d.channel === f.ch) && (!f.status || statusOf(d).k === f.status));
      state.order = rows.map((d) => d.conversation_id);
      $("#rows").innerHTML = rows.map((d) => {
        const e = d.evaluation, s = statusOf(d), changed = e && e.total !== e.original_total;
        return `<tr class="click" data-id="${esc(d.conversation_id)}">
          <td><b class="mono">${esc(d.conversation_id)}</b><span class="muted small"> · ${d.messages} реплик</span></td>
          <td><span class="ch">${ic(d.channel === "voice call" ? "phone" : "chat")}${d.channel === "voice call" ? "Звонок" : "Чат"}<span class="lang">${esc(d.language)}</span></span></td>
          <td>${e ? `<div class="mini-bar"><div class="track"><div class="fill b-${tone(e.total)}" style="width:${e.total || 0}%"></div></div><span class="score c-${tone(e.total)}">${changed ? `<s class="old">${num(e.original_total)}</s>` : ""}${num(e.total)}</span></div>` : `<span class="muted">—</span>`}</td>
          <td><span class="chip ${s.cls}">${s.label}</span></td>
          <td class="go">${ic("next")}</td></tr>`;
      }).join("") || `<tr><td colspan="5" class="empty">Ничего не найдено — измените фильтры</td></tr>`;
    };
    draw();
    $("#rows").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#/dialog/" + encodeURIComponent(tr.dataset.id); };
    $("#f-q").oninput = (e) => { f.q = e.target.value.trim(); draw(); };
    for (const [id, key] of [["f-lang", "lang"], ["f-ch", "ch"]]) {
      $("#" + id).onclick = (e) => { const b = e.target.closest("button"); if (!b) return; f[key] = b.dataset.v; $$("#" + id + " button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    }
    $$(".stat[data-st]").forEach((b) => (b.onclick = () => { f.status = f.status === b.dataset.st ? "" : b.dataset.st; router(); }));
    const reset = $("#f-reset"); if (reset) reset.onclick = () => { f.status = ""; router(); };
    $("#f-group").onchange = (e) => { f.group = e.target.value.split(" · ")[0]; router(); };
    $("#load-btn").onclick = async () => {
      const g = $("#load-group").value.trim();
      if (!g) return toast("Укажите group_id", true);
      const b = $("#load-btn"); b.disabled = true; b.innerHTML = `<span class="spin"></span>`;
      try { const r = await api("/groups/load", { body: { group_id: g } }); toast(`Загружено ${r.loaded} диалогов (${r.group_id})`); f.group = r.group_id; router(); }
      catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Загрузить"; }
    };
    $("#batch-btn").onclick = async () => {
      try { state.job = await api("/batch", { body: { group_id: f.group || undefined, only_missing: true } }); if (!state.job.total) toast("Все диалоги уже оценены активным чек-листом"); watchJob(); }
      catch (e) { toast(e.message, true); }
    };
    if (state.job) watchJob();
  }

  let jobTimer = null;
  function watchJob() {
    clearTimeout(jobTimer);
    const box = $("#job-box"), j = state.job;
    if (box && j) {
      const pct = j.total ? Math.round(j.done / j.total * 100) : 100;
      box.innerHTML = `<div class="job">
        ${j.status === "running" ? `<span class="spin"></span>` : ic("ok")}<b>${j.status === "running" ? "Идёт оценка" : "Оценка завершена"}</b>
        <div class="progress"><div style="width:${pct}%"></div></div><span class="score">${j.done} из ${j.total}</span>
        ${j.errors.length ? `<span class="chip no" title="${esc(j.errors.map((e) => e.conversation_id + ": " + e.error).join("\n"))}">ошибок: ${j.errors.length}</span>` : ""}
        <span class="grow"></span>${j.status === "running" ? `<button class="btn sm" id="job-cancel">Остановить</button>` : `<button class="btn sm ghost" id="job-hide">Скрыть</button>`}</div>`;
      const c = $("#job-cancel"); if (c) c.onclick = () => api(`/jobs/${j.id}/cancel`, { method: "POST", body: {} });
      const h = $("#job-hide"); if (h) h.onclick = () => { state.job = null; box.innerHTML = ""; };
    }
    if (!j || j.status !== "running") return;
    jobTimer = setTimeout(async () => {
      try {
        state.job = await api("/jobs/" + j.id);
        if (state.job.status !== "running") { toast(`Оценка завершена: ${state.job.done} диалогов`); refreshMeta(); if (/^#\/dialogs|^$/.test(location.hash)) return router(); }
      } catch (e) { state.job = null; }
      watchJob();
    }, 2000);
  }

  // ---------- карточка диалога ----------
  async function viewDialog(v, id, qs) {
    if (!state.checklists.length) state.checklists = await api("/checklists");
    const d = await api("/dialogs/" + encodeURIComponent(id));
    const done = d.evaluations.filter((e) => e.status === "done");
    const evId = +qs.get("ev") || (done[0] && done[0].id);
    const ev = evId ? await api("/evaluations/" + evId) : null;
    const isCall = d.channel === "voice call";
    const off = msgOffsets(d.transcript);
    const dur = Math.max(10, (off[off.length - 1] || 0) + 6);
    const ui = { t: 0, playing: false, speed: isCall ? 1 : 4, crit: qs.get("c") || null, raf: 0, last: 0, follow: true };
    const pos = state.order ? state.order.indexOf(d.conversation_id) : -1;

    v.innerHTML = `
      <nav class="crumbs"><a href="#/dialogs">${ic("back")} Все диалоги</a>
        ${pos >= 0 ? `<span class="grow"></span><span class="muted small">${pos + 1} из ${state.order.length}</span>
          <a class="btn sm ghost" href="#/dialog/${encodeURIComponent(state.order[pos - 1] || "")}" ${pos ? "" : "hidden"} title="Предыдущий (p)">${ic("back")}</a>
          <a class="btn sm ghost" href="#/dialog/${encodeURIComponent(state.order[pos + 1] || "")}" ${pos < state.order.length - 1 ? "" : "hidden"} title="Следующий (n)">${ic("next")}</a>` : ""}</nav>
      ${pageHead(`${isCall ? "Звонок" : "Чат"} <span class="mono">${esc(d.conversation_id)}</span>`,
        `${esc(LANG[d.language] || d.language)} · ${fmtSec(dur - 6)} · ${d.transcript.length} реплик`,
        `${ev ? `<span class="score-pill b-${tone(ev.final.total)}">${num(ev.final.total)}<small>/100</small></span>` : ""}
         <button class="btn ${ev ? "" : "pri"}" id="ev-run">${ic("bolt")} ${ev ? "Оценить заново" : "Оценить диалог"}</button>`)}
      <div class="settings-line">
        <label>Чек-лист <select id="ev-cl">${state.checklists.map((c) => `<option value="${c.id}" ${c.active ? "selected" : ""}>v${c.id} · ${esc(c.name)}${c.active ? " (активный)" : ""}</option>`).join("")}</select></label>
        ${done.length > 1 ? `<label>Показана оценка <select id="ev-hist">${done.map((e) => `<option value="${e.id}" ${ev && e.id === ev.id ? "selected" : ""}>#${e.id} · v${e.checklist_id} · ${e.created_at.slice(5, 16).replace("T", " ")}</option>`).join("")}</select></label>` : ""}
        ${isCall && d.audio_url ? `<a href="${esc(d.audio_url)}" target="_blank" rel="noopener">${ic("ext")} Оригинальная запись звонка</a>` : ""}
      </div>

      <section class="card timeline">
        <div class="lanes" id="lanes"></div>
        <div class="player">
          <button class="play" id="play" title="Воспроизвести ход разговора (Пробел)">${ic("play", "")}</button>
          <span class="time" id="time">00:00 / ${fmtSec(dur)}</span>
          <div class="scrub" id="scrub"><div class="t"></div><div class="p" id="sp"></div><div class="k" id="sk"></div></div>
          <button class="speed" id="speed" title="Скорость воспроизведения">${ui.speed}×</button>
        </div>
      </section>

      <div class="work">
        <section class="card">
          <div class="card-h"><h2>Расшифровка</h2><span class="muted small">бот и система — серым, это контекст</span></div>
          <div class="transcript" id="tr">${d.transcript.map((m, i) => `
            <div class="msg ${esc(m.speaker)}" id="m-${i + 1}" data-i="${i}">
              <div class="meta"><span class="who">${ROLE[m.speaker] || esc(m.speaker)}</span><span class="ts">${fmtSec(off[i])}</span><span class="n">#${i + 1}</span></div>
              <div class="txt">${esc(m.text)}</div>
            </div>`).join("")}</div>
        </section>
        <section id="qa"></section>
      </div>`;

    // --- лента разговора: полосы реплик по ролям ---
    const lanesDef = [["client", "Клиент"], ["operator", "Оператор"]];
    if (d.transcript.some((m) => m.speaker === "bot")) lanesDef.push(["bot", "Бот"]);
    const hash = (a, b) => { let x = (a * 2654435761 + b * 40503) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x % 1000) / 1000; };
    const W = 1000, H = 36;
    $("#lanes").innerHTML = lanesDef.map(([sp, label]) => {
      let bars = "";
      d.transcript.forEach((m, i) => {
        if (m.speaker !== sp) return;
        const start = off[i], next = i + 1 < off.length ? off[i + 1] : start + 4;
        const len = Math.max(1.5, Math.min(next - start, 1.2 + m.text.length / 14));
        const x0 = start / dur * W, x1 = Math.min(W, (start + len) / dur * W);
        for (let x = x0, j = 0; x < x1; x += 4.2, j++) {
          const env = Math.sin(Math.PI * Math.min(1, (x - x0) / Math.max(4, x1 - x0))) * .75 + .25;
          const hh = Math.max(3, (0.25 + hash(i, j) * 0.75) * env * (H - 6));
          bars += `<rect x="${x.toFixed(1)}" y="${((H - hh) / 2).toFixed(1)}" width="2.4" height="${hh.toFixed(1)}" rx="1.2"/>`;
        }
      });
      return `<div class="lane-l">${label}</div><div class="lane ${sp}" data-lane>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="base" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>${bars}</svg>
        <div class="wave-sel" hidden></div></div>`;
    }).join("");

    const msgAt = (t) => { let k = 0; for (let i = 0; i < off.length; i++) if (off[i] <= t + .01) k = i; return k; };
    function setSel(a, b) {
      $$(".wave-sel").forEach((el) => {
        if (a == null) return (el.hidden = true);
        const s = off[a], e = b + 1 < off.length ? off[b + 1] : dur;
        el.hidden = false;
        el.style.left = (s / dur * 100) + "%";
        el.style.width = Math.max(0.8, (e - s) / dur * 100) + "%";
      });
    }
    const scrollMsg = (el) => { const box = $("#tr"); box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2; };
    function setTime(t, scroll) {
      ui.t = Math.max(0, Math.min(dur, t));
      const pct = ui.t / dur * 100;
      $("#sp").style.width = pct + "%"; $("#sk").style.left = pct + "%";
      $("#time").textContent = `${fmtSec(ui.t)} / ${fmtSec(dur)}`;
      const cur = $("#m-" + (msgAt(ui.t) + 1)), prev = $(".msg.now");
      if (prev !== cur) { prev?.classList.remove("now"); cur?.classList.add("now"); if (scroll && ui.follow && cur) scrollMsg(cur); }
    }
    function highlight(a, b, focus, quote) {
      $$(".msg.hl, .msg.inrange").forEach((m) => m.classList.remove("hl", "inrange"));
      $$(".msg .txt mark").forEach((mk) => { const i = +mk.closest(".msg").dataset.i; mk.parentElement.textContent = d.transcript[i].text; });
      if (a == null) return setSel(null);
      for (let i = a; i <= (b ?? a); i++) $("#m-" + (i + 1))?.classList.add("inrange");
      const f = focus ?? a, el = $("#m-" + (f + 1));
      if (el) {
        el.classList.add("hl"); scrollMsg(el);
        // подсвечиваем дословную цитату модели внутри реплики
        const text = d.transcript[f].text, qn = (quote || "").replace(/[.…]+$/, ""), at = qn ? text.toLowerCase().indexOf(qn.toLowerCase()) : -1;
        if (at >= 0) $(".txt", el).innerHTML = esc(text.slice(0, at)) + "<mark>" + esc(text.slice(at, at + qn.length)) + "</mark>" + esc(text.slice(at + qn.length));
      }
      setSel(a, b ?? a);
      setTime(off[f], false);
    }
    const tick = (now) => {
      if (!ui.playing) return;
      const dt = ui.last ? (now - ui.last) / 1000 : 0; ui.last = now;
      setTime(ui.t + dt * ui.speed, true);
      if (ui.t >= dur) return toggle(false);
      ui.raf = requestAnimationFrame(tick);
    };
    function toggle(on) {
      ui.playing = on ?? !ui.playing; ui.last = 0;
      $("#play").innerHTML = ic(ui.playing ? "pause" : "play", "");
      $("#play").classList.toggle("on", ui.playing);
      if (ui.playing) { if (ui.t >= dur) setTime(0); ui.follow = true; ui.raf = requestAnimationFrame(tick); } else cancelAnimationFrame(ui.raf);
    }
    cleanup = () => { ui.playing = false; cancelAnimationFrame(ui.raf); };
    $("#play").onclick = () => toggle();
    const speeds = [1, 2, 4, 8, 16];
    $("#speed").onclick = (e) => { ui.speed = speeds[(speeds.indexOf(ui.speed) + 1) % speeds.length]; e.target.textContent = ui.speed + "×"; };
    const seekFrom = (el, e) => { const r = el.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * dur; setTime(t, true); const k = msgAt(t); highlight(k, k); };
    $("#scrub").onclick = (e) => seekFrom($("#scrub"), e);
    $$("[data-lane]").forEach((l) => (l.onclick = (e) => seekFrom(l, e)));
    $("#tr").onclick = (e) => { const m = e.target.closest(".msg"); if (m) highlight(+m.dataset.i, +m.dataset.i); };
    $("#tr").onwheel = () => { ui.follow = false; };
    setTime(0);

    const runEval = async () => {
      const btn = $("#ev-run"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Модель оценивает…`;
      try {
        const r = await api("/evaluations", { body: { conversation_id: d.conversation_id, checklist_id: +$("#ev-cl").value } });
        if (r.status === "error") throw new Error(r.error);
        toast(`Оценка готова: ${num(r.final.total)} из 100`);
        location.hash = `#/dialog/${encodeURIComponent(d.conversation_id)}?ev=${r.id}`;
      } catch (e) { toast(e.message, true); btn.disabled = false; btn.innerHTML = `${ic("bolt")} Оценить диалог`; }
    };
    $("#ev-run").onclick = runEval;
    const hist = $("#ev-hist");
    if (hist) hist.onchange = () => { location.hash = `#/dialog/${encodeURIComponent(d.conversation_id)}?ev=${hist.value}`; };

    const h = { highlight, runEval };
    renderQA(d, ev, ui, h);
    const m = +qs.get("m"); if (m) highlight(m - 1, m - 1);

    state.keys = (k) => {
      if (k === " ") return toggle(), true;
      if (k === "e") return runEval(), true;
      if (k === "Escape") return (location.hash = "#/dialogs"), true;
      const step = { n: 1, p: -1 }[k];
      if (step && pos >= 0) { const nx = state.order[pos + step]; if (nx) location.hash = "#/dialog/" + encodeURIComponent(nx); return true; }
      return h.key ? h.key(k) : false;
    };
  }

  function lossOf(c, fin) {
    if (c.type === "flag" || fin.points == null) return 0;
    return Math.round((fin.effective_weight - fin.points) * 100) / 100;
  }
  const shortExpl = (s) => { s = (s || "").trim(); const m = s.match(/^.{20,140}?[.!?](\s|$)/); return m ? m[0].trim() : s.length > 140 ? s.slice(0, 137) + "…" : s || "без пояснения"; };

  function renderQA(d, ev, ui, h) {
    const qa = $("#qa");
    if (!ev) {
      qa.innerHTML = `<div class="card empty-card">${ic("target")}<h2>Диалог ещё не оценён</h2>
        <p class="muted">Модель проверит работу оператора по ${state.active?.criteria.length || ""} критериям чек-листа, покажет баллы и реплики-доказательства.</p>
        <button class="btn pri" id="ev-run2">${ic("bolt")} Оценить диалог</button><p class="muted small">или нажмите <kbd>e</kbd></p></div>`;
      $("#ev-run2").onclick = h.runEval;
      return;
    }
    const cl = ev.checklist, fin = ev.final, orig = ev.original;
    const items = Object.fromEntries(ev.items.map((it) => [it.criterion_id, it]));
    const scored = cl.criteria.filter((c) => c.type !== "flag");
    const losses = scored.map((c) => ({ c, loss: lossOf(c, fin.criteria[c.id]) })).filter((x) => x.loss > 0).sort((a, b) => b.loss - a.loss);
    if (ui.crit && !cl.criteria.some((c) => c.id === ui.crit)) ui.crit = null;
    const R = 50, C = 2 * Math.PI * R;
    const changed = fin.total !== orig.total;
    const f = ev.facts || {};
    const review = ev.items.filter((it) => (it.confidence ?? 1) < 0.7).length;

    qa.innerHTML = `
      <div class="card summary">
        <div class="ring">
          <svg viewBox="0 0 120 120"><circle class="bgc" cx="60" cy="60" r="${R}" fill="none" stroke-width="10"/>
            <circle class="fg" cx="60" cy="60" r="${R}" fill="none" stroke="${toneColor(fin.total)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
          <div class="c"><div class="v c-${tone(fin.total)}">${num(fin.total)}</div><div class="m">из 100</div></div>
        </div>
        <div class="sum-body">
          ${changed ? `<div class="small muted">Было ${num(orig.total)} — изменено по апелляции</div>` : ""}
          <div class="sections">${fin.sections.map((s) => `
            <div class="sec"><span>${esc(s.name)}</span><div class="track"><div class="fill b-${tone(s.percent)}" style="width:${s.percent}%"></div></div><b>${num(s.points)}<small>/${num(s.max_points)}</small></b></div>`).join("")}</div>
        </div>
      </div>
      ${fin.gross_violation ? `<div class="banner bad">${ic("flag")}<div><b>Грубая ошибка оператора</b><br><span>Отмечается отдельно от балла — см. критерий «${esc(cl.criteria.find((c) => c.type === "flag")?.name || "")}»</span></div></div>` : ""}
      ${review ? `<div class="banner info">${ic("search")}<div><b>Нужна проверка человеком: ${review}</b><br><span>Модель не уверена в отмеченных «?» критериях</span></div></div>` : ""}
      ${losses.length ? `<div class="card why"><h3>Почему снижена оценка</h3>
        ${losses.slice(0, 3).map(({ c, loss }) => `<button class="why-row" data-open="${c.id}"><b>−${num(loss)}</b><span><em>${esc(c.name)}.</em> ${esc(shortExpl(items[c.id]?.explanation))}</span>${ic("next")}</button>`).join("")}</div>`
        : `<div class="card why"><h3>Оценка не снижена</h3><p class="muted">Все применимые критерии выполнены полностью.</p></div>`}

      <div class="card crits">
        <div class="card-h"><h2>Критерии</h2><span class="muted small">нажмите, чтобы раскрыть · <kbd>j</kbd> <kbd>k</kbd></span></div>
        ${cl.criteria.map((c) => critRow(c, items[c.id] || {}, fin.criteria[c.id], orig.criteria[c.id], ev.appeals.filter((a) => a.criterion_id === c.id), c.id === ui.crit)).join("")}
      </div>

      <div class="foot-meta">
        ${f.first_response_wait_sec != null ? `<span class="${f.first_response_over_threshold ? "c-lo" : ""}">Первая реакция ${fmtSec(f.first_response_wait_sec)} (норма до ${fmtSec(f.first_response_threshold_sec)})</span>` : ""}
        ${f.longest_operator_reply_gap_sec != null ? `<span>Макс. пауза ${fmtSec(f.longest_operator_reply_gap_sec)}</span>` : ""}
        <span>Оценка #${ev.id} · чек-лист v${ev.checklist_id}</span>
        <span>${esc(ev.model || "")}${ev.usage ? ` · $${ev.usage.cost_usd} · ${ev.usage.seconds} с` : ""}</span>
      </div>`;

    requestAnimationFrame(() => { const fg = $(".ring .fg"); if (fg) fg.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(100, fin.total ?? 0)) / 100); });

    const ids = cl.criteria.map((c) => c.id);
    const jump = (cid) => {
      const it = items[cid] || {};
      const r = it.checked_range && it.checked_range[0] ? it.checked_range : null;
      const ev0 = (it.evidence || [])[0];
      if (ev0) h.highlight((r ? r[0] : ev0) - 1, (r ? r[1] : ev0) - 1, ev0 - 1, it.quote);
      else if (r) h.highlight(r[0] - 1, r[1] - 1);
    };
    const open = (cid, scroll) => {
      ui.crit = ui.crit === cid && !scroll ? null : cid;
      $$(".crit").forEach((el) => el.classList.toggle("open", el.dataset.c === ui.crit));
      if (ui.crit) { jump(ui.crit); if (scroll) $(`.crit[data-c="${cid}"]`).scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    };
    const appeal = (cid) => {
      open(cid, true); ui.crit = cid; $$(".crit").forEach((el) => el.classList.toggle("open", el.dataset.c === cid));
      const form = $(`.crit[data-c="${cid}"] .ap-form`);
      if (!form) return toast("По этому критерию апелляция уже на рассмотрении");
      form.hidden = false; $("textarea", form).focus();
    };
    if (ui.crit) open(ui.crit, true);

    h.key = (k) => {
      const step = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[k];
      if (step) { const i = ui.crit ? ids.indexOf(ui.crit) : -1; open(ids[(i + step + ids.length) % ids.length], true); return true; }
      if ((k === "f" || k === "Enter") && ui.crit) return jump(ui.crit), true;
      if (k === "a" && ui.crit) return appeal(ui.crit), true;
      return false;
    };

    qa.onclick = async (e) => {
      const t = e.target;
      const why = t.closest("[data-open]"); if (why) return open(why.dataset.open, true);
      const head = t.closest(".crit-head"); if (head) return open(head.closest(".crit").dataset.c);
      const j = t.closest("[data-jump]"); if (j) return jump(j.closest(".crit").dataset.c);
      const ap = t.closest("[data-appeal]"); if (ap) return appeal(ap.closest(".crit").dataset.c);
      const cancel = t.closest("[data-cancel]"); if (cancel) { cancel.closest(".ap-form").hidden = true; return; }
      const send = t.closest("[data-send]");
      if (send) {
        const form = send.closest(".ap-form"), cid = send.closest(".crit").dataset.c;
        send.disabled = true;
        try {
          await api("/appeals", { body: { evaluation_id: ev.id, criterion_id: cid, comment: $("textarea", form).value, author: $("input", form).value } });
          toast("Апелляция отправлена проверяющему");
          refreshMeta();
          renderQA(d, await api("/evaluations/" + ev.id), ui, h);
        } catch (err) { toast(err.message, true); send.disabled = false; }
      }
    };
  }

  function critRow(c, it, fin, orig, appeals, isOpen) {
    const changed = orig && fin && orig.answer !== fin.answer;
    const low = (it.confidence ?? 1) < 0.7;
    const openAppeal = appeals.some((a) => a.status === "open");
    const pts = c.type === "flag" ? (fin.answer === "yes" ? `<span class="c-lo">выявлены</span>` : `<span class="muted">нет</span>`)
      : fin.answer === "na" ? `<span class="muted">N/A</span>` : `${num(fin.points)}<small>/${num(fin.effective_weight)}</small>`;
    const range = it.checked_range && it.checked_range[0] ? it.checked_range : null;
    return `<div class="crit ${isOpen ? "open" : ""} ${changed ? "changed" : ""}" data-c="${c.id}">
      <button class="crit-head">${answerIcon(c, fin.answer)}
        <span class="nm">${esc(c.name)}${low ? ` <span class="low" title="Модель не уверена — проверьте">?</span>` : ""}${openAppeal ? ` <span class="chip warn">апелляция</span>` : ""}</span>
        <span class="pt">${changed ? `<s class="old">${esc(answerLabel(c, orig.answer))}</s>` : ""}${pts}</span>${ic("down", "i chev")}</button>
      <div class="crit-body">
        <p class="expl">${esc(it.explanation || "Модель не дала пояснения.")}</p>
        ${it.quote ? `<blockquote class="quote" data-jump>«${esc(it.quote)}»${(it.evidence || [])[0] ? `<span>реплика #${it.evidence[0]}</span>` : ""}</blockquote>` : ""}
        ${fin.answer === "na" ? `<div class="note"><b>Почему N/A:</b> ${esc(c.na_condition || "критерий неприменим")}. Вес ${c.weight} распределён между остальными критериями.</div>` : ""}
        ${it.suggestion ? `<div class="coach"><b>${ic("bolt")} Как стоило ответить</b><div>${esc(it.suggestion)}</div></div>` : ""}
        <div class="crit-actions">
          ${(it.evidence || []).length || range ? `<button class="btn sm" data-jump>${ic("target")} Показать в диалоге${range && !(it.evidence || []).length ? ` (реплики ${range[0]}–${range[1]})` : ""}</button>` : ""}
          ${openAppeal ? "" : `<button class="btn sm" data-appeal>${ic("scale")} Оспорить</button>`}
          <span class="grow"></span>
          ${it.confidence != null ? `<span class="conf ${low ? "low" : ""}" title="Уверенность модели">${low ? "нужна проверка · " : ""}уверенность ${Math.round(it.confidence * 100)}%</span>` : ""}
        </div>
        <details class="rule"><summary>Правило критерия${c.type !== "flag" ? ` · вес ${c.weight}` : ""}</summary><p>${esc(c.description)}${c.na_allowed ? `<br><b>N/A:</b> ${esc(c.na_condition)}` : ""}</p></details>
        ${it.warning ? `<div class="note warn">⚠ ${esc(it.warning)}</div>` : ""}
        ${appeals.map((a) => `<div class="note appeal"><b>Апелляция #${a.id}</b>${a.author ? ` · ${esc(a.author)}` : ""}: ${esc(a.comment)}
          ${a.decision ? `<br><b>Решение:</b> ${a.decision.action === "change" ? `${esc(answerLabel(c, a.decision.old_answer))} → ${esc(answerLabel(c, a.decision.new_answer))}` : "оценка подтверждена"} — ${esc(a.decision.reason)}` : `<br><span class="muted">Ждёт решения проверяющего</span>`}</div>`).join("")}
        ${openAppeal ? "" : `<div class="ap-form" hidden>
          <textarea placeholder="Почему оценка неверна? Сошлитесь на номера реплик, например «#12 — оператор попрощался»."></textarea>
          <div class="row"><input placeholder="Ваше имя (необязательно)" class="grow"><button class="btn sm ghost" data-cancel>Отмена</button><button class="btn sm pri" data-send>Отправить апелляцию</button></div></div>`}
      </div>
    </div>`;
  }

  // ---------- апелляции ----------
  async function viewAppeals(v) {
    const all = await api("/appeals");
    const open = all.filter((a) => a.status === "open"), decided = all.filter((a) => a.status !== "open").reverse();
    v.innerHTML = `<div class="head"><div class="grow"><h1>Апелляции</h1><p class="sub">Проверяющий изучает доказательства, подтверждает или меняет оценку — итог пересчитывается автоматически</p></div></div>
      <h2 style="margin-bottom:12px">На рассмотрении <span class="chip warn">${open.length}</span></h2><div id="ap-open">${open.length ? "" : `<div class="panel empty">Открытых апелляций нет</div>`}</div>
      <h2 style="margin:26px 0 12px">Рассмотренные <span class="chip">${decided.length}</span></h2><div id="ap-done"></div>`;
    const evC = {}, dC = {};
    const getEv = async (id) => (evC[id] = evC[id] || await api("/evaluations/" + id));
    const getD = async (id) => (dC[id] = dC[id] || await api("/dialogs/" + encodeURIComponent(id)));

    for (const a of open) {
      const ev = await getEv(a.evaluation_id), d = await getD(a.conversation_id);
      const c = ev.checklist.criteria.find((x) => x.id === a.criterion_id);
      const it = ev.items.find((x) => x.criterion_id === a.criterion_id) || {};
      const cur = ev.final.criteria[c.id].answer;
      const nums = new Set(it.evidence || []);
      const [ra, rb] = it.checked_range && it.checked_range[0] ? it.checked_range : [0, 0];
      const off = msgOffsets(d.transcript);
      const show = d.transcript.map((m, i) => ({ m, n: i + 1 })).filter(({ n }) => nums.has(n) || (n >= ra && n <= rb) || [...nums].some((k) => Math.abs(k - n) <= 1));
      const box = document.createElement("div");
      box.className = "panel"; box.style.marginBottom = "14px";
      box.innerHTML = `
        <div class="panel-h"><b>#${a.id}</b><a href="#/dialog/${encodeURIComponent(a.conversation_id)}?ev=${ev.id}&c=${c.id}">${esc(a.conversation_id)}</a>
          <span class="muted">· ${esc(c.code)} ${esc(c.name)}</span><span class="grow"></span>
          <span class="small muted">Итог сейчас</span><b class="score c-${tone(ev.final.total)}">${num(ev.final.total)}</b></div>
        <div class="work" style="margin-top:12px">
          <div>
            <div class="note"><b>Спорная оценка:</b> ${answerChip(c, cur)} ${esc(it.explanation || "")}</div>
            <div class="note appeal"><b>Комментарий${a.author ? " · " + esc(a.author) : ""}:</b> ${esc(a.comment)}</div>
            <div class="note"><b>Правило:</b> ${esc(c.description)}${c.na_allowed ? `<br><b>N/A:</b> ${esc(c.na_condition)}` : ""}</div>
          </div>
          <div class="transcript" style="min-height:0;max-height:300px;border:1px solid var(--line);border-radius:12px;margin:0">
            ${show.map(({ m, n }) => `<div class="msg ${esc(m.speaker)} ${nums.has(n) ? "hl" : n >= ra && n <= rb ? "inrange" : ""}"><div class="meta"><span class="ts">${fmtSec(off[n - 1])}</span><span class="who">${ROLE[m.speaker] || esc(m.speaker)}</span><span class="n">#${n}</span></div><div class="txt">${esc(m.text)}</div></div>`).join("") || `<div class="empty small">Реплики не указаны — откройте карточку</div>`}
          </div>
        </div>
        <div class="row" style="margin-top:14px;align-items:flex-end">
          <label class="f">Решение<select data-k="action"><option value="confirm">Подтвердить оценку</option><option value="change">Изменить оценку</option></select></label>
          <label class="f" data-k="newbox" hidden>Новая оценка<select data-k="new">${allowedAnswers(c).filter((x) => String(x.v) !== String(cur)).map((x) => `<option value="${esc(x.v)}">${esc(x.l)}</option>`).join("")}</select></label>
          <label class="f grow">Причина решения<input data-k="reason" placeholder="Например: в реплике 12 оператор попрощался"></label>
          <label class="f">Проверяющий<input data-k="reviewer" placeholder="Имя" style="width:140px"></label>
          <button class="btn pri" data-k="ok">Сохранить решение</button>
        </div>`;
      $("#ap-open").appendChild(box);
      const q = (k) => box.querySelector(`[data-k="${k}"]`);
      q("action").onchange = () => { q("newbox").hidden = q("action").value !== "change"; };
      q("ok").onclick = async () => {
        try {
          const nv = q("new").value;
          await api(`/appeals/${a.id}/decide`, { body: { action: q("action").value, new_answer: c.type === "scale" && nv !== "na" ? +nv : nv, reason: q("reason").value, reviewer: q("reviewer").value } });
          const upd = await api("/evaluations/" + a.evaluation_id);
          toast(`Решение сохранено. Итог: ${num(ev.final.total)} → ${num(upd.final.total)}`);
          refreshMeta(); router();
        } catch (e) { toast(e.message, true); }
      };
    }
    $("#ap-done").innerHTML = decided.length ? `<table class="list"><thead><tr><th>#</th><th>Диалог</th><th>Критерий</th><th>Комментарий</th><th>Решение</th><th>Причина</th><th>Итог</th></tr></thead><tbody>
      ${(await Promise.all(decided.map(async (a) => {
        const ev = await getEv(a.evaluation_id); const c = ev.checklist.criteria.find((x) => x.id === a.criterion_id) || { code: "", name: a.criterion_id, type: "binary" };
        return `<tr><td>${a.id}</td><td><a href="#/dialog/${encodeURIComponent(a.conversation_id)}?ev=${ev.id}&c=${c.id}">${esc(a.conversation_id)}</a></td><td>${esc(c.code)} ${esc(c.name)}</td><td>${esc(a.comment)}</td>
          <td>${a.decision.action === "change" ? `${answerChip(c, a.decision.old_answer)} → ${answerChip(c, a.decision.new_answer)}` : `подтверждено ${answerChip(c, a.decision.old_answer)}`}</td>
          <td>${esc(a.decision.reason)}${a.decision.reviewer ? ` <span class="muted">— ${esc(a.decision.reviewer)}</span>` : ""}</td>
          <td class="score">${ev.original.total !== ev.final.total ? `<s class="old">${num(ev.original.total)}</s>` : ""}<span class="c-${tone(ev.final.total)}">${num(ev.final.total)}</span></td></tr>`;
      }))).join("")}</tbody></table>` : `<div class="panel empty">Пока нет</div>`;
  }

  // ---------- аналитика ----------
  async function viewAnalytics(v) {
    const a = await api("/analytics" + (state.filters.group ? "?group_id=" + encodeURIComponent(state.filters.group) : ""));
    const maxH = Math.max(1, ...a.histogram);
    const scored = a.criteria.filter((c) => c.type !== "flag");
    const flag = a.criteria.find((c) => c.type === "flag");
    const group = (rows) => rows.map((r) => `<div class="hbar" style="grid-template-columns:90px minmax(0,1fr) 60px 40px"><b>${esc(LANG[r.key] || (r.key === "voice call" ? "Звонки" : r.key === "agent chat" ? "Чаты" : r.key))}</b>
      <div class="track"><div class="fill b-${tone(r.average)}" style="width:${r.average || 0}%"></div></div><span class="score c-${tone(r.average)}">${num(r.average)}</span><span class="small muted">${r.n}</span></div>`).join("");
    v.innerHTML = `
      <div class="head"><div class="grow"><h1>Аналитика</h1><p class="sub">Последние оценки диалогов${state.filters.group ? " набора " + esc(state.filters.group) : ""} · чек-лист v${a.checklist_id} · с учётом решений по апелляциям</p></div></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Оценено</div><div class="v">${a.evaluated}<span class="muted" style="font-size:18px"> / ${a.dialogs}</span></div><div class="h">диалогов</div></div>
        <div class="kpi"><div class="l">Средний балл</div><div class="v c-${tone(a.average)}">${num(a.average)}</div><div class="h">из 100</div></div>
        <div class="kpi"><div class="l">Грубые ошибки</div><div class="v ${a.gross ? "c-lo" : ""}">${a.gross}</div><div class="h">${a.evaluated ? num(a.gross / a.evaluated * 100) + "% диалогов" : "—"}</div></div>
        <div class="kpi"><div class="l">Апелляции</div><div class="v">${a.appeals.total}</div><div class="h">открыто ${a.appeals.open} · оценка изменена ${a.appeals.changed}</div></div>
      </div>
      <div class="grid2">
        <section class="panel"><div class="panel-h"><h2 class="grow">Выполнение критериев</h2><span class="small muted">% от максимума · N/A</span></div>
          ${scored.map((c) => `<div class="hbar"><span class="score muted">${esc(c.code)}</span><span>${esc(c.name)}</span>
            <div class="track"><div class="fill b-${tone(c.percent)}" style="width:${c.percent || 0}%"></div></div>
            <span class="score c-${tone(c.percent)}">${c.percent == null ? "—" : num(c.percent) + "%"}</span></div>
            ${c.na ? `<div class="small muted" style="margin:-4px 0 4px 40px">N/A в ${c.na} диалогах</div>` : ""}`).join("")}
          ${flag ? `<div class="hbar"><span class="score muted">${esc(flag.code)}</span><span>${esc(flag.name)}</span><span></span><span class="score ${flag.yes ? "c-lo" : ""}">${flag.yes}</span></div>` : ""}
        </section>
        <div style="display:grid;gap:16px">
          <section class="panel"><div class="panel-h"><h2 class="grow">Распределение баллов</h2></div>
            <div class="hist">${a.histogram.map((n, i) => `<div><span>${n || ""}</span><span class="col" style="height:${n / maxH * 100}%;background:${toneColor(i * 10 + 5)}"></span><span>${i * 10}</span></div>`).join("")}</div></section>
          <section class="panel"><div class="panel-h"><h2>По языкам</h2></div>${group(a.by_language) || `<div class="empty">Нет данных</div>`}</section>
          <section class="panel"><div class="panel-h"><h2>По каналам</h2></div>${group(a.by_channel) || `<div class="empty">Нет данных</div>`}</section>
        </div>
      </div>`;
  }

  // ---------- чек-лист ----------
  let draft = null;
  const PALETTE = ["#1fd36b", "#7dffb4", "#12a3a3", "#ffc24b", "#8f7bff", "#ff5c5c", "#4fc3f7", "#c6ff6b", "#ff8fd1", "#9aa7b4"];
  async function viewChecklist(v) {
    state.checklists = await api("/checklists");
    if (!draft) draft = JSON.parse(JSON.stringify(await api("/checklists/active")));
    const types = { binary: "Да / Нет", scale: "Шкала", flag: "Флаг (без баллов)" };
    const weighted = draft.criteria.filter((c) => c.type !== "flag");
    const totalW = weighted.reduce((s, c) => s + (+c.weight || 0), 0);
    const isActive = state.checklists.find((c) => c.id === draft.id)?.active;
    v.innerHTML = `
      <div class="head"><div class="grow"><h1>Чек-листы</h1><p class="sub">Сохранение создаёт новую версию — прежние оценки остаются привязаны к своей</p></div>
        <select id="cl-ver">${state.checklists.map((c) => `<option value="${c.id}" ${c.id === draft.id ? "selected" : ""}>v${c.id} · ${esc(c.name)}${c.active ? " ✓ активный" : ""}</option>`).join("")}</select>
        ${draft.id && !isActive ? `<button class="btn" id="cl-activate">Сделать активным</button>` : ""}</div>
      <div class="panel" style="margin-bottom:14px">
        <div class="row" style="align-items:flex-end">
          <label class="f grow">Название<input id="cl-name" value="${esc(draft.name)}"></label>
          <label class="f">Порог первой реакции, сек<input id="cl-thr" type="number" value="${draft.first_response_threshold_sec ?? 180}" style="width:120px"></label>
          <label class="f">Округление<input id="cl-round" type="number" value="${draft.rounding ?? 2}" style="width:90px"></label>
        </div>
        <div class="small muted" style="margin-top:12px">Распределение веса: сумма <b>${totalW}</b> нормируется к 100; при N/A вес делится между применимыми критериями</div>
        <div class="wsum">${weighted.map((c, i) => `<div title="${esc(c.name)}: ${c.weight}" style="flex:${+c.weight || 0};background:${PALETTE[i % PALETTE.length]}"></div>`).join("")}</div>
        <div class="row small" style="margin-top:6px;gap:12px">${weighted.map((c, i) => `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${PALETTE[i % PALETTE.length]}"></span> ${esc(c.code)} ${totalW ? num(c.weight / totalW * 100) : 0}%</span>`).join("")}</div>
      </div>
      <div class="ed" id="cl-ed">${draft.criteria.map((c, i) => `
        <div class="ed-c" data-i="${i}">
          <div class="ed-grid">
            <label class="f">Код<input data-f="code" value="${esc(c.code)}"></label>
            <label class="f">Критерий<input data-f="name" value="${esc(c.name)}"></label>
            <label class="f">Секция<select data-f="section"><option value="">—</option>${(draft.sections || []).map((s) => `<option value="${esc(s.id)}" ${s.id === c.section ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
            <label class="f">Тип ответа<select data-f="type">${Object.entries(types).map(([k, l]) => `<option value="${k}" ${k === c.type ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label class="f">Вес<input data-f="weight" type="number" min="0" value="${c.type === "flag" ? 0 : esc(c.weight)}" ${c.type === "flag" ? "disabled" : ""}></label>
          </div>
          <label class="f">Формулировка — что считается выполнением<textarea data-f="description" rows="2">${esc(c.description)}</textarea></label>
          <div class="row">
            <label class="row small" style="gap:6px;font-weight:700"><input type="checkbox" data-f="na_allowed" ${c.na_allowed ? "checked" : ""} ${c.type === "flag" ? "disabled" : ""}> N/A разрешён</label>
            <input data-f="na_condition" class="grow" placeholder="Условие, при котором ставится N/A" value="${esc(c.na_condition || "")}" ${c.na_allowed ? "" : "hidden"}>
          </div>
          ${c.type === "scale" ? `<div><div class="small muted" style="margin-bottom:6px;font-weight:700">Шкала — верхняя ступень даёт полный вес</div>
            ${(c.scale || []).map((s, j) => `<div class="scale-row" style="margin-bottom:6px"><input type="number" data-s="${j}" data-sf="value" value="${esc(s.value)}"><input data-s="${j}" data-sf="description" value="${esc(s.description)}" placeholder="Описание ступени"><button class="btn sm danger" data-del-s="${j}">✕</button></div>`).join("")}
            <button class="btn sm" data-add-s>+ ступень</button></div>` : ""}
          <div class="row"><span class="grow"></span>
            <button class="btn sm" data-mv="-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm" data-mv="1" ${i === draft.criteria.length - 1 ? "disabled" : ""}>↓</button>
            <button class="btn sm danger" data-del>Удалить</button></div>
        </div>`).join("")}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="cl-add">+ Добавить критерий</button><span class="grow"></span>
        <button class="btn ghost" id="cl-reset">Отменить изменения</button>
        <button class="btn pri" id="cl-save">Сохранить новую версию и сделать активной</button>
      </div>
      <div class="panel row" style="margin-top:14px">
        <span class="grow"><b>Применить активный чек-лист</b><br><span class="small muted">Оценит диалоги, которые ещё не оценены активной версией</span></span>
        <select id="cl-apply-group"></select>
        <button class="btn pri" id="cl-apply">${ic("bolt")} Переоценить</button>
      </div>`;

    api("/groups").then((gs) => { $("#cl-apply-group").innerHTML = `<option value="">Все наборы</option>` + gs.map((g) => `<option>${esc(g.group_id)}</option>`).join(""); });
    $("#cl-name").oninput = (e) => { draft.name = e.target.value; };
    $("#cl-thr").oninput = (e) => { draft.first_response_threshold_sec = +e.target.value; };
    $("#cl-round").oninput = (e) => { draft.rounding = +e.target.value; };
    const ed = $("#cl-ed");
    ed.oninput = ed.onchange = (e) => {
      const card = e.target.closest("[data-i]"); if (!card) return;
      const c = draft.criteria[+card.dataset.i], t = e.target;
      if (t.dataset.f) {
        c[t.dataset.f] = t.type === "checkbox" ? t.checked : t.type === "number" ? +t.value : t.value;
        if (e.type !== "change") return;
        if (t.dataset.f === "type") {
          if (c.type === "scale" && !(c.scale || []).length) c.scale = [{ value: 10, description: "Полностью" }, { value: 5, description: "Частично" }, { value: 0, description: "Не выполнено" }];
          if (c.type === "flag") { c.weight = 0; c.na_allowed = false; } else if (!c.weight) c.weight = 10;
        }
        if (["type", "na_allowed", "weight"].includes(t.dataset.f)) viewChecklist(v);
      } else if (t.dataset.s != null) c.scale[+t.dataset.s][t.dataset.sf] = t.dataset.sf === "value" ? +t.value : t.value;
    };
    ed.onclick = (e) => {
      const card = e.target.closest("[data-i]"); if (!card) return;
      const i = +card.dataset.i, c = draft.criteria[i], b = e.target.closest("button"); if (!b) return;
      if (b.dataset.del != null) { if (!confirm(`Удалить критерий «${c.name}»?`)) return; draft.criteria.splice(i, 1); }
      else if (b.dataset.mv) { const j = i + +b.dataset.mv; [draft.criteria[i], draft.criteria[j]] = [draft.criteria[j], draft.criteria[i]]; }
      else if (b.dataset.addS != null) c.scale.push({ value: 0, description: "" });
      else if (b.dataset.delS != null) c.scale.splice(+b.dataset.delS, 1);
      else return;
      viewChecklist(v);
    };
    $("#cl-add").onclick = () => {
      draft.criteria.push({ code: String(draft.criteria.length + 1).padStart(2, "0"), name: "Новый критерий", section: draft.sections?.[0]?.id || "", type: "binary", weight: 10, na_allowed: false, description: "", na_condition: "" });
      viewChecklist(v).then(() => { const cards = $$(".ed-c"), last = cards[cards.length - 1]; last.scrollIntoView({ behavior: "smooth" }); $("[data-f=name]", last).select(); });
    };
    $("#cl-reset").onclick = () => { draft = null; viewChecklist(v); };
    $("#cl-ver").onchange = async (e) => { draft = await api("/checklists/" + e.target.value); viewChecklist(v); };
    const act = $("#cl-activate");
    if (act) act.onclick = async () => { await api(`/checklists/${draft.id}/activate`, { method: "POST", body: {} }); toast(`Чек-лист v${draft.id} активен`); refreshMeta(); viewChecklist(v); };
    $("#cl-save").onclick = async () => {
      try {
        const saved = await api("/checklists", { body: { checklist: draft, parent_id: draft.id, activate: true } });
        draft = saved; toast(`Сохранено: чек-лист v${saved.id} активен`);
        await refreshMeta(); viewChecklist(v);
      } catch (e) { toast(e.message, true); }
    };
    $("#cl-apply").onclick = async () => {
      try {
        const g = $("#cl-apply-group").value;
        state.job = await api("/batch", { body: { group_id: g || undefined, only_missing: true } });
        state.filters.group = g;
        toast(`Переоценка запущена: ${state.job.total} диалогов`);
        location.hash = "#/dialogs";
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------- старт ----------
  shell();
  refreshMeta();
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/checklist")) draft = null; state.keys = null; router(); });

  // ---------- горячие клавиши ----------
  const HELP = [["?", "эта подсказка"], ["g d / g c / g a / g s", "Диалоги / Чек-листы / Апелляции / Аналитика"], ["/", "поиск по диалогам"],
    ["n / p", "следующий / предыдущий диалог"], ["e", "оценить диалог"], ["j / k  или  ↓ / ↑", "следующий / предыдущий критерий"],
    ["f  или  Enter", "перейти к фрагменту"], ["a", "оспорить оценку"], ["Пробел", "воспроизвести ход разговора"], ["Esc", "назад к списку"]];
  let gPrefix = false;
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key;
    const overlay = $("#cqa-help");
    if (overlay && (k === "Escape" || k === "?")) { overlay.remove(); return e.preventDefault(); }
    if (k === "?") {
      const o = document.createElement("div");
      o.id = "cqa-help"; o.className = "help-overlay";
      o.innerHTML = `<div class="panel"><div class="panel-h"><h2 class="grow">Горячие клавиши</h2><span class="small muted">Esc — закрыть</span></div>
        ${HELP.map(([key, what]) => `<div class="help-row"><span>${key.split("  ").map((x) => x.split(" ").map((t) => t === "/" || t === "или" ? `<span class="muted">${t}</span>` : `<kbd>${esc(t)}</kbd>`).join(" ")).join(" ")}</span><span>${what}</span></div>`).join("")}</div>`;
      o.onclick = (ev) => { if (ev.target === o) o.remove(); };
      root.appendChild(o);
      return e.preventDefault();
    }
    if (gPrefix) {
      gPrefix = false;
      const to = { d: "dialogs", c: "checklist", a: "appeals", s: "analytics" }[k];
      if (to) { location.hash = "#/" + to; return e.preventDefault(); }
    }
    if (k === "g") { gPrefix = true; setTimeout(() => (gPrefix = false), 900); return; }
    if (k === "/" && $("#f-q")) { $("#f-q").focus(); return e.preventDefault(); }
    if (state.keys && state.keys(k)) e.preventDefault();
  });
  router();
})();
