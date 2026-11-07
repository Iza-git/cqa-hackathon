// Общие помощники и все запросы к серверу.
window.CQA = { views: {}, state: { group: "DEV", checklist: "chat-quality", role: "Оператор" } };

(function (CQA) {
  // Создание элементов. Текст всегда попадает как текст, а не как HTML.
  CQA.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "class") el.className = v;
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v);
    });
    kids.flat(Infinity).forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      el.append(kid instanceof Node ? kid : String(kid));
    });
    return el;
  };

  // replaceChildren не разворачивает массивы и пишет false как текст — выравниваем как в h().
  CQA.put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : String(k))));

  CQA.num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
  CQA.time = (sec) => {
    if (sec === null || sec === undefined || isNaN(sec)) return "—";
    const s = Math.floor(sec);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  CQA.answer = (a) => ({ yes: "Да", no: "Нет", NA: "N/A" }[a] || (a === null || a === undefined ? "—" : String(a)));
  CQA.channel = (c) => (c === "voice call" ? "Звонок" : "Чат");
  CQA.language = (l) => ({ RU: "Русский", KZ: "Казахский", EN: "Английский" }[l] || l);
  CQA.speaker = (s) => ({ client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система" }[s] || s);
  CQA.statusTag = (status) => {
    const map = {
      done: ["Оценён", "cqa-tag-ok"], queued: ["В очереди", ""], running: ["Оценивается", "cqa-tag-warn"],
      needs_review: ["Нужна проверка", "cqa-tag-warn"], error: ["Ошибка", "cqa-tag-err"], new: ["Не оценён", ""],
    };
    const [text, cls] = map[status] || [status || "Не оценён", ""];
    return CQA.h("span", { class: "cqa-tag " + cls }, text);
  };
  CQA.toast = (text) => {
    const root = document.getElementById("cqa-root");
    root.querySelectorAll(".cqa-toast").forEach((t) => t.remove());
    const el = CQA.h("div", { class: "cqa-toast", role: "status" }, text);
    root.append(el);
    setTimeout(() => el.remove(), 3800);
  };
  CQA.loading = () => CQA.h("div", { class: "cqa-empty" }, "Загрузка…");
  CQA.errorBox = (e) => CQA.h("div", { class: "cqa-alert cqa-alert-err", role: "alert" }, "Не удалось выполнить действие: " + (e.message || e));

  async function request(method, path, body) {
    if (window.CQA_MOCK) return CQA.mock.request(method, path, body);
    const res = await fetch((window.CQA_API_BASE || "") + "/api" + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : "Сервер ответил ошибкой " + res.status);
    }
    return data;
  }

  const query = (params) => {
    const q = Object.entries(params || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    return q ? "?" + q : "";
  };
  const seg = encodeURIComponent;

  CQA.api = {
    importDataset: (group_id) => request("POST", "/datasets/import", { group_id }),
    upload: (group_id, data) => request("POST", "/conversations/upload" + query({ group_id }), data),
    conversations: (params) => request("GET", "/conversations" + query(params)),
    conversation: (g, id) => request("GET", `/conversations/${seg(g)}/${seg(id)}`),
    checklists: () => request("GET", "/checklists"),
    versions: (id) => request("GET", `/checklists/${seg(id)}/versions`),
    version: (id, v) => request("GET", `/checklists/${seg(id)}/versions/${v}`),
    createChecklist: (c) => request("POST", "/checklists", c),
    updateChecklist: (id, c) => request("PUT", `/checklists/${seg(id)}`, c),
    evaluate: (payload) => request("POST", "/evaluations", payload),
    job: (id) => request("GET", `/jobs/${id}`),
    evaluation: (id) => request("GET", `/evaluations/${id}`),
    appeal: (payload) => request("POST", "/appeals", payload),
    appeals: (status) => request("GET", "/appeals" + query({ status })),
    decide: (id, payload) => request("POST", `/appeals/${id}/decision`, payload),
    analytics: (params) => request("GET", "/analytics" + query(params)),
    audioUrl: (path) => (window.CQA_MOCK ? CQA.mock.audioUrl(path) : (window.CQA_API_BASE || "") + path),
  };

  // Ждать завершения задания оценки и сообщать о ходе.
  CQA.watchJob = (jobId, onTick) => new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await CQA.api.job(jobId);
        onTick(job);
        if (job.status === "done" || job.done + job.failed >= job.total) resolve(job);
        else setTimeout(tick, window.CQA_MOCK ? 300 : 2000);
      } catch (e) { reject(e); }
    };
    tick();
  });
})(window.CQA);
