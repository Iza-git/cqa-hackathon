// Меню, роль и маршруты.
(function (CQA) {
  const { h } = CQA;
  const icon = (d) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p);
    return s;
  };
  const items = [
    ["dialogs", "Диалоги", "M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z"],
    ["checklists", "Чек-листы", "M4 5h16v14H4zM8 12l3 3 5-6"],
    ["appeals", "Апелляции", "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z"],
    ["analytics", "Аналитика", "M5 20v-6M12 20V6M19 20v-10"],
  ];

  try { CQA.state.role = localStorage.getItem("cqa-role") || CQA.state.role; } catch (e) { /* хранилище недоступно */ }

  const links = {};
  const nav = h("nav", { class: "cqa-nav", "aria-label": "Разделы" }, items.map(([id, label, d]) => (links[id] = h("a", { href: "#/" + id }, icon(d), label))));
  const roleSelect = h("select", { "aria-label": "Роль", onChange: (e) => {
    CQA.state.role = e.target.value;
    try { localStorage.setItem("cqa-role", e.target.value); } catch (err) { /* хранилище недоступно */ }
    route();
  } }, ["Оператор", "Проверяющий"].map((r) => h("option", { value: r, selected: r === CQA.state.role }, r)));
  const main = h("main", { class: "cqa-main" });

  document.getElementById("cqa-root").append(
    h("aside", { class: "cqa-side" },
      h("div", { class: "cqa-logo" }, "CQA"), nav,
      h("label", { class: "cqa-role" }, "Роль", roleSelect),
      window.CQA_MOCK && h("div", { class: "cqa-demo-note" }, "Демо-режим: диалоги и оценки придуманы, сервер и ИИ не подключены."))
  );
  document.getElementById("cqa-root").append(main);

  let token = 0;
  async function route() {
    const hash = location.hash.replace(/^#\/?/, "") || "dialogs";
    const [pathPart, search] = hash.split("?");
    const parts = pathPart.split("/");
    const name = parts[0];
    const active = name === "dialog" ? "dialogs" : name;
    Object.entries(links).forEach(([id, a]) => {
      a.classList.toggle("cqa-active", id === active);
      if (id === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const view = { dialogs: CQA.views.dialogs, dialog: CQA.views.card, checklists: CQA.views.checklists, appeals: CQA.views.appeals, analytics: CQA.views.analytics }[name];
    const mine = ++token;
    if (CQA.cleanup) { CQA.cleanup(); CQA.cleanup = null; }
    main.replaceChildren(CQA.loading());
    try {
      if (!view) throw new Error("Раздел не найден");
      const node = await view(parts.slice(1).map(decodeURIComponent), new URLSearchParams(search || ""));
      if (mine === token) { main.replaceChildren(node); main.scrollTop = 0; }
    } catch (e) {
      if (mine === token) main.replaceChildren(CQA.errorBox(e));
    }
  }
  CQA.rerender = route;
  window.addEventListener("hashchange", route);
  route();
})(window.CQA);
