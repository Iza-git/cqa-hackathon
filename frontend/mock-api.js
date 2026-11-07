// Демо-сервер в браузере. Диалоги и оценки здесь придуманы вручную, это не работа ИИ.
// Форматы ответов совпадают с тем, что должен вернуть настоящий сервер.
(function (CQA) {
  const yn = (id, section, title, weight, instruction, na) => ({
    id, section, title, instruction, type: "yes_no", weight, steps: [],
    na_allowed: !!na, na_condition: na || "", is_critical: false,
  });
  const S1 = "Начало и понимание запроса", S2 = "Безопасность и решение", S3 = "Ведение и завершение диалога", S4 = "Грубые нарушения";
  const seed = {
    id: "chat-quality", version: 1, name: "Качество чатов", created_at: "2026-11-07T09:00:00Z",
    criteria: [
      yn("c01", S1, "Установление контакта", 10, "Да: оператор поздоровался на языке клиента и представился в первом ответе."),
      yn("c02", S1, "Выявление потребности", 15, "Да: оператор учёл известные детали и уточнил недостающее до ответа.", "Данных для ответа хватало с самого начала"),
      yn("c03", S2, "Идентификация", 20, "Да: проверка личности подтверждена до раскрытия данных или защищённого действия.", "Запрос не требовал идентификации"),
      { id: "c04", section: S2, title: "Корректная и полная консультация", instruction: "Оцени ответ или следующий шаг по шкале.", type: "scale", weight: 20,
        steps: [{ value: 20, label: "Все существенные вопросы закрыты или дан корректный следующий шаг" }, { value: 15, label: "Основной вопрос решён, пропущена второстепенная деталь" }, { value: 10, label: "Часть запроса закрыта, существенный вопрос остался открытым" }, { value: 5, label: "Есть общая подсказка, но клиенту непонятно, как действовать" }, { value: 0, label: "Ответа по существу нет или ключевая рекомендация ошибочна" }],
        na_allowed: true, na_condition: "Чат закончился до того, как клиент сформулировал запрос", is_critical: false },
      yn("c05", S3, "Эмпатия и клиентоориентированность", 15, "Да: оператор вежлив и отреагировал на конкретную проблему клиента."),
      { id: "c06", section: S3, title: "Управление диалогом, скорость и грамотность", instruction: "Оцени ясность, порядок ответов и предупреждение об ожидании.", type: "scale", weight: 15,
        steps: [{ value: 10, label: "Ответы ясные и связные, об ожидании предупредил" }, { value: 7, label: "Один заметный сбой, но клиент может продолжить" }, { value: 4, label: "Клиенту приходится переспрашивать" }, { value: 0, label: "Ход диалога непонятен" }],
        na_allowed: false, na_condition: "", is_critical: false },
      yn("c07", S3, "Завершение", 5, "Да: оператор подвёл итог или предложил дальнейшую помощь и попрощался.", "Чат оборвался до возможности его завершить"),
      { ...yn("c08", S4, "Грубые ошибки", 0, "Да: оскорбление клиента, платная услуга в обход компании или раскрытие конфиденциальной информации."), is_critical: true },
    ],
  };

  // Разбор реплик: [время, роль, текст]
  const T = (rows) => rows.map(([t, speaker, text], i) => ({ id: "u" + (i + 1), timestamp: typeof t === "number" ? CQA.time(t) : t, t: typeof t === "number" ? t : 0, speaker, text }));
  const E = (id, quote) => ({ id, quote });

  const base = [
    { conversation_id: "demo-call-024", channel: "voice call", language: "RU", audio: 393, transcript: T([
        [0, "system", "Звонок переведён на оператора"],
        [6, "operator", "Добрый день! Меня зовут [Имя скрыто], компания Freedom Broker. Чем могу помочь?"],
        [14, "client", "Здравствуйте. Я писал обращение по выводу средств, ответа до сих пор нет."],
        [29, "operator", "Понимаю, ожидание неприятно. Подскажите, пожалуйста, номер обращения и дату подачи."],
        [41, "client", "Номер 4471, подавал на прошлой неделе."],
        [58, "operator", "Спасибо. Назовите кодовое слово, чтобы я могла посмотреть детали."],
        [70, "client", "Кодовое слово: весна."],
        [86, "system", "Идентификация клиента подтверждена"],
        [98, "operator", "Вижу ваше обращение, сейчас оно на проверке у специалистов."],
        [128, "client", "Когда я получу ответ по обращению?"],
        [138, "operator", "Я передам вопрос специалистам."],
        [147, "client", "А сколько времени это займёт?"],
        [163, "operator", "Обычно специалисты отвечают в течение нескольких рабочих дней, ответ придёт в личный кабинет."],
        [201, "client", "Хорошо, а если средства не придут?"],
        [214, "operator", "Тогда напишите в то же обращение, мы проверим перевод повторно."],
        [372, "client", "Понял, спасибо."],
        [388, "system", "Звонок завершён"],
      ]), script: {
        c01: ["yes", "Оператор поздоровался на языке клиента и представился в первой реплике.", [E("u2", "Меня зовут [Имя скрыто]")]],
        c02: ["yes", "Перед ответом оператор уточнил номер и дату обращения.", [E("u4", "номер обращения и дату подачи")]],
        c03: ["yes", "Система подтвердила личность до раскрытия статуса обращения.", [E("u8", "Идентификация клиента подтверждена")]],
        c04: [15, "Основной вопрос решён, но точный срок ответа не уточнён.", [E("u13", "в течение нескольких рабочих дней")]],
        c05: ["yes", "Оператор вежлив и отреагировал на долгое ожидание клиента.", [E("u4", "Понимаю, ожидание неприятно")]],
        c06: [7, "Один заметный сбой: на вопрос о сроке оператор сначала ответил без срока, и клиенту пришлось спросить снова.", [E("u11", "Я передам вопрос специалистам")]],
        c07: ["no", "Оператор не подвёл итог и не попрощался, звонок закончился после благодарности клиента.", [], { from: "u15", to: "u17" }],
        c08: ["no", "Оскорблений, предложений в обход компании и раскрытия данных не найдено.", [], { from: "u2", to: "u15" }],
      } },
    { conversation_id: "demo-chat-ru-001", channel: "agent chat", language: "RU", transcript: T([
        ["00:02", "bot", "Здравствуйте! Я помощник AIM. Опишите ваш вопрос."],
        ["00:15", "client", "Какие комиссии на покупку акций США?"],
        ["00:18", "bot", "Перевожу вас на оператора."],
        ["00:40", "operator", "Здравствуйте! Меня зовут [Имя скрыто]. Комиссии зависят от тарифа, какой у вас подключён?"],
        ["01:05", "client", "Не знаю, откройте общую таблицу."],
        ["01:32", "operator", "Отправляю условия всех тарифов: они указаны в разделе «Тарифы» на сайте и в приложении."],
        ["02:01", "client", "А минимальная комиссия есть?"],
        ["02:20", "system", "Клиент покинул чат"],
      ]), script: {
        c01: ["yes", "Поздоровался и представился в первом ответе.", [E("u4", "Меня зовут [Имя скрыто]")]],
        c02: ["yes", "Уточнил тариф, которого не хватало для ответа.", [E("u4", "какой у вас подключён")]],
        c03: ["NA", "Общий вопрос о тарифах не требует идентификации.", []],
        c04: [10, "Общие условия даны, но вопрос о минимальной комиссии остался открытым.", [E("u6", "указаны в разделе «Тарифы»")]],
        c05: ["yes", "Оператор вежлив, недовольства клиент не выражал.", [E("u4", "Здравствуйте!")]],
        c06: [10, "Ответы ясные и связные.", [E("u6", "Отправляю условия всех тарифов")]],
        c07: ["NA", "Клиент вышел из чата, завершить диалог было невозможно.", []],
        c08: ["no", "Грубых нарушений нет.", [], { from: "u4", to: "u6" }],
      } },
    { conversation_id: "demo-chat-kz-002", channel: "agent chat", language: "KZ", transcript: T([
        ["00:03", "client", "Сәлеметсіз бе! Шотты қалай толтыруға болады?"],
        ["00:25", "operator", "Сәлеметсіз бе! Менің атым [Имя скрыто]. Қай банктен аударғыңыз келеді?"],
        ["00:48", "client", "Kaspi арқылы."],
        ["01:10", "operator", "Қосымшадағы «Толтыру» бөлімін ашып, деректемелерді көшіріңіз. Ақша әдетте бір жұмыс күні ішінде түседі."],
        ["01:40", "client", "Рақмет, түсінікті."],
        ["01:55", "operator", "Тағы сұрағыңыз бар ма? Болмаса, сау болыңыз!"],
      ]), script: {
        c01: ["yes", "Поздоровался на казахском и представился.", [E("u2", "Менің атым [Имя скрыто]")]],
        c02: ["yes", "Уточнил банк перед ответом.", [E("u2", "Қай банктен аударғыңыз келеді")]],
        c03: ["NA", "Общая инструкция по пополнению не раскрывает данных клиента.", []],
        c04: [20, "Дан корректный следующий шаг и срок зачисления.", [E("u4", "«Толтыру» бөлімін ашып")]],
        c05: ["yes", "Оператор вежлив на протяжении диалога.", [E("u6", "Тағы сұрағыңыз бар ма")]],
        c06: [10, "Ответы ясные и последовательные.", [E("u4", "деректемелерді көшіріңіз")]],
        c07: ["yes", "Предложил дальнейшую помощь и попрощался.", [E("u6", "сау болыңыз")]],
        c08: ["no", "Грубых нарушений нет.", [], { from: "u2", to: "u6" }],
      } },
    { conversation_id: "demo-chat-en-003", channel: "agent chat", language: "EN", transcript: T([
        ["00:04", "client", "Hello, my investments are down. What should I do?"],
        ["00:30", "operator", "Hi, this is [Имя скрыто]. Sorry to hear that. Which instruments do you hold?"],
        ["00:55", "client", "Mostly US tech stocks."],
        ["01:20", "operator", "The company cannot give personal advice here, but send me your personal number and I can consult you privately for a fee."],
        ["01:48", "client", "Is that allowed?"],
        ["02:05", "operator", "Sure. Bye."],
      ]), script: {
        c01: ["yes", "Поздоровался на английском и представился.", [E("u2", "this is [Имя скрыто]")]],
        c02: ["yes", "Уточнил инструменты клиента.", [E("u2", "Which instruments do you hold")]],
        c03: ["NA", "Запрос не требовал раскрытия данных или защищённого действия.", []],
        c04: [0, "Корректного ответа нет: оператор предложил частную услугу вместо следующего шага.", [E("u4", "consult you privately for a fee")]],
        c05: ["no", "На беспокойство клиента оператор отреагировал формально и закончил грубо коротко.", [E("u6", "Sure. Bye.")]],
        c06: [4, "Клиенту пришлось переспрашивать о законности предложения.", [E("u5", "Is that allowed?")]],
        c07: ["no", "Прощание есть, но итога и предложения помощи нет.", [E("u6", "Sure. Bye.")]],
        c08: ["yes", "Оператор просит личный номер для платной консультации в обход компании.", [E("u4", "send me your personal number")]],
      } },
    { conversation_id: "demo-chat-ru-004", channel: "agent chat", language: "RU", transcript: T([
        ["00:05", "client", "Хочу вывести 500 тысяч на другой счёт, оформите."],
        ["00:45", "operator", "Здравствуйте! Сейчас оформлю вывод, новый счёт записал."],
        ["01:20", "client", "Сколько это займёт?"],
        ["03:50", "operator", "Заявка создана, деньги придут завтра."],
        ["04:10", "client", "Спасибо."],
        ["04:30", "operator", "Обращайтесь! Всего доброго."],
      ]), script: {
        c01: ["no", "Оператор поздоровался, но не представился.", [E("u2", "Здравствуйте!")]],
        c02: ["no", "Оператор не уточнил сумму, валюту и реквизиты.", [], { from: "u1", to: "u2" }],
        c03: ["no", "Вывод средств оформлен без подтверждённой проверки личности.", [], { from: "u1", to: "u4" }],
        c04: [15, "Вывод оформлен и назван срок, не уточнены реквизиты.", [E("u4", "деньги придут завтра")]],
        c05: ["yes", "Оператор вежлив.", [E("u6", "Всего доброго")]],
        c06: [7, "Долгая пауза без предупреждения об ожидании.", [E("u4", "Заявка уже проверена специалистом")]],
        c07: ["yes", "Предложил обращаться и попрощался.", [E("u6", "Обращайтесь! Всего доброго")]],
        c08: ["no", "Грубых нарушений не найдено.", [], { from: "u2", to: "u6" }],
      } },
    { conversation_id: "demo-chat-en-005", channel: "agent chat", language: "EN", failFirst: true, transcript: T([
        ["00:02", "client", "Hi, where can I find my tax statement?"],
        ["00:20", "operator", "Hello, I'm [Имя скрыто]. Open Reports in your account and choose the tax statement. Anything else?"],
        ["00:45", "client", "No, thanks."],
        ["00:58", "operator", "Have a great day. Goodbye!"],
      ]), script: {
        c01: ["yes", "Поздоровался и представился.", [E("u2", "I'm [Имя скрыто]")]],
        c02: ["NA", "Данных для ответа хватало с самого начала.", []],
        c03: ["NA", "Общая инструкция не требует идентификации.", []],
        c04: [20, "Дан корректный следующий шаг.", [E("u2", "Open Reports in your account")]],
        c05: ["yes", "Оператор вежлив.", [E("u4", "Have a great day")]],
        c06: [10, "Ответ ясный.", [E("u2", "choose the tax statement")]],
        c07: ["yes", "Предложил помощь и попрощался.", [E("u4", "Goodbye!")]],
        c08: ["no", "Грубых нарушений нет.", [], { from: "u2", to: "u4" }],
      } },
  ];

  const db = { conversations: [], checklists: [JSON.parse(JSON.stringify(seed))], evaluations: [], appeals: [], jobs: [], nextId: 1 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fail = (message) => { throw new Error(message); };
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const latest = (id) => db.checklists.filter((c) => c.id === id).sort((a, b) => b.version - a.version)[0];
  const version = (id, v) => db.checklists.find((c) => c.id === id && c.version === Number(v));
  const conv = (g, id) => db.conversations.find((c) => c.group_id === g && c.conversation_id === id);

  function ratio(c, a) {
    if (c.type === "yes_no") return a === "yes" ? 1 : 0;
    return Number(a) / Math.max(...c.steps.map((s) => Number(s.value)));
  }
  function compute(criteria, answers) {
    const isApp = (c) => !c.is_critical && c.weight > 0 && answers[c.id] !== "NA";
    const applicable = criteria.filter(isApp);
    const totalWeight = applicable.reduce((s, c) => s + Number(c.weight), 0);
    const earned = applicable.reduce((s, c) => s + c.weight * ratio(c, answers[c.id]), 0);
    const per = {};
    criteria.forEach((c) => {
      const eff = isApp(c) ? (c.weight * 100) / totalWeight : 0;
      per[c.id] = { effective_weight: round2(eff), points: isApp(c) ? round2(eff * ratio(c, answers[c.id])) : 0 };
    });
    const sections = [...new Set(criteria.map((c) => c.section))].map((section) => {
      const list = applicable.filter((c) => c.section === section);
      const w = list.reduce((s, c) => s + Number(c.weight), 0);
      return { section, score: w ? round2((100 * list.reduce((s, c) => s + c.weight * ratio(c, answers[c.id]), 0)) / w) : null };
    });
    return {
      total: applicable.length ? round2((100 * earned) / totalWeight) : null,
      critical_flag: criteria.some((c) => c.is_critical && answers[c.id] === "yes"),
      per, sections,
    };
  }

  function validateChecklist(c) {
    if (!c.name || !c.name.trim()) fail("Укажите название чек-листа");
    if (!c.criteria || !c.criteria.length) fail("Нужен хотя бы один критерий");
    const ids = new Set();
    c.criteria.forEach((k, i) => {
      const n = "Критерий " + (i + 1) + ": ";
      if (!k.title || !k.title.trim()) fail(n + "укажите название");
      if (!k.instruction || !k.instruction.trim()) fail(n + "укажите инструкцию");
      if (ids.has(k.id)) fail(n + "повторяется id");
      ids.add(k.id);
      if (!(Number(k.weight) >= 0)) fail(n + "вес должен быть неотрицательным");
      if (k.na_allowed && !(k.na_condition || "").trim()) fail(n + "укажите условие N/A");
      if (k.is_critical && k.type !== "yes_no") fail(n + "грубая ошибка должна иметь тип Да/Нет");
      if (k.is_critical && Number(k.weight) !== 0) fail(n + "у грубой ошибки вес 0");
      if (k.is_critical && k.na_allowed) fail(n + "у грубой ошибки нет N/A");
      if (k.type === "scale") {
        const v = (k.steps || []).map((s) => Number(s.value));
        if (v.length < 2 || new Set(v).size !== v.length || v.some((x) => !(x >= 0)) || Math.max(...v) <= 0) fail(n + "шкала: нужны минимум 2 разные неотрицательные ступени");
      }
    });
    const sum = c.criteria.reduce((s, k) => s + Number(k.weight), 0);
    return sum === 100 ? [] : ["Сумма весов равна " + sum + ", итог будет приведён к 100"];
  }

  function scriptedResult(conversation, criterion) {
    const script = conversation.script && conversation.script[criterion.id];
    const op = conversation.transcript.find((t) => t.speaker === "operator") || conversation.transcript[0];
    let [answer, reason, ev, range] = script || [
      criterion.type === "scale" ? Math.max(...criterion.steps.map((s) => Number(s.value))) : (criterion.is_critical ? "no" : "yes"),
      "Демо-ответ для нового критерия. Настоящую оценку даст ИИ.",
      [E(op.id, op.text.slice(0, 40))],
    ];
    if (answer === "NA" && !criterion.na_allowed) answer = criterion.type === "scale" ? Math.max(...criterion.steps.map((s) => Number(s.value))) : "no";
    if (criterion.type === "scale" && !criterion.steps.some((s) => Number(s.value) === Number(answer)) && answer !== "NA") {
      const max = Math.max(...criterion.steps.map((s) => Number(s.value)));
      answer = criterion.steps.map((s) => Number(s.value)).sort((a, b) => a - b).reduce((best, v) => (v / max <= (Number(answer) / 20) ? v : best), 0);
    }
    const evidence = (ev || []).map((e) => {
      const turn = conversation.transcript.find((t) => t.id === e.id);
      return { ...e, verified: !!turn && turn.text.toLowerCase().includes(e.quote.toLowerCase()) };
    });
    return { criterion_id: criterion.id, ai_answer: answer, final_answer: answer, reason, evidence, checked_range: range || null };
  }

  function recalc(ev, field) {
    const cl = version(ev.checklist_id, ev.checklist_version);
    const answers = {};
    ev.results.forEach((r) => { answers[r.criterion_id] = r[field]; });
    return { calc: compute(cl.criteria, answers), cl };
  }
  function applyFinal(ev) {
    if (!ev.results.length) { ev.sections = []; return; }
    const { calc, cl } = recalc(ev, "final_answer");
    ev.final_total = calc.total;
    ev.final_critical_flag = calc.critical_flag;
    ev.sections = calc.sections;
    ev.results.forEach((r) => {
      const c = cl.criteria.find((k) => k.id === r.criterion_id);
      Object.assign(r, { title: c.title, section: c.section, type: c.type, is_critical: c.is_critical, base_weight: c.weight }, calc.per[r.criterion_id]);
    });
  }

  function runEvaluation(ev) {
    const c = conv(ev.group_id, ev.conversation_id);
    const cl = version(ev.checklist_id, ev.checklist_version);
    if (c.failFirst && !c.failedOnce) {
      c.failedOnce = true;
      Object.assign(ev, { status: "needs_review", error: "Демо: ответ модели дважды не прошёл проверку.", results: [], ai_total: null, final_total: null, ai_critical_flag: false, final_critical_flag: false, sections: [] });
      return;
    }
    ev.results = cl.criteria.map((k) => scriptedResult(c, k));
    const { calc } = recalc(ev, "ai_answer");
    Object.assign(ev, { status: "done", error: null, ai_total: calc.total, ai_critical_flag: calc.critical_flag });
    applyFinal(ev);
  }

  function makeEvaluation(c, cl, job) {
    const ev = { id: db.nextId++, job_id: job && job.id, group_id: c.group_id, conversation_id: c.conversation_id, checklist_id: cl.id, checklist_version: cl.version, model: "mock", prompt_version: "mock", status: "queued", error: null, ai_total: null, final_total: null, ai_critical_flag: false, final_critical_flag: false, sections: [], results: [], created_at: new Date().toISOString() };
    db.evaluations.push(ev);
    return ev;
  }

  function importGroup(group, list) {
    let imported = 0;
    list.forEach((rec) => {
      const row = clone(rec);
      row.group_id = group;
      const old = conv(group, row.conversation_id);
      if (old) Object.assign(old, row); else db.conversations.push(row);
      imported++;
    });
    return imported;
  }

  const latestEval = (c, checklistId) => db.evaluations
    .filter((e) => e.group_id === c.group_id && e.conversation_id === c.conversation_id && (!checklistId || e.checklist_id === checklistId))
    .sort((a, b) => b.id - a.id)[0];
  const duration = (c) => c.audio || c.transcript[c.transcript.length - 1].t;

  function listRow(c, checklistId) {
    const e = latestEval(c, checklistId);
    return {
      group_id: c.group_id, conversation_id: c.conversation_id, channel: c.channel, language: c.language,
      turn_count: c.transcript.length, duration: duration(c), status: e ? e.status : "new", evaluation_id: e ? e.id : null,
      ai_total: e ? e.ai_total : null, final_total: e ? e.final_total : null, critical_flag: e ? e.final_critical_flag : false,
      open_appeals: e ? db.appeals.filter((a) => a.evaluation_id === e.id && a.status === "open").length : 0,
    };
  }
  function evalView(ev) {
    return { ...clone(ev), appeals: db.appeals.filter((a) => a.evaluation_id === ev.id).map(clone) };
  }
  function appealView(a) {
    const ev = db.evaluations.find((e) => e.id === a.evaluation_id);
    const c = conv(ev.group_id, ev.conversation_id);
    const r = ev.results.find((x) => x.criterion_id === a.criterion_id);
    const cl = version(ev.checklist_id, ev.checklist_version);
    const k = cl.criteria.find((x) => x.id === a.criterion_id);
    const ids = (r.evidence.length ? r.evidence.map((x) => x.id) : r.checked_range ? [r.checked_range.from, r.checked_range.to] : []);
    const pos = ids.map((id) => c.transcript.findIndex((t) => t.id === id)).filter((i) => i >= 0);
    const from = Math.max(0, (pos.length ? Math.min(...pos) : 0) - 2), to = (pos.length ? Math.max(...pos) : 2) + 3;
    return {
      ...clone(a), group_id: ev.group_id, conversation_id: ev.conversation_id, language: c.language, channel: c.channel, title: k.title, type: k.type, steps: k.steps, na_allowed: k.na_allowed,
      ai_answer: r.ai_answer, final_answer: r.final_answer, reason: r.reason, evidence: r.evidence, checked_range: r.checked_range,
      ai_total: ev.ai_total, final_total: ev.final_total, fragment: clone(c.transcript.slice(from, to)),
    };
  }

  function analytics(params) {
    const convs = db.conversations.filter((c) => !params.group_id || c.group_id === params.group_id);
    const evs = convs.map((c) => latestEval(c, params.checklist_id)).filter(Boolean);
    const done = evs.filter((e) => e.status === "done");
    const avg = (arr) => (arr.length ? round2(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
    const stat = {};
    done.forEach((e) => e.results.forEach((r) => {
      if (r.is_critical) return;
      const k = (stat[r.criterion_id] = stat[r.criterion_id] || { criterion_id: r.criterion_id, title: r.title, values: [], na_count: 0 });
      if (r.final_answer === "NA") k.na_count++;
      else k.values.push(r.effective_weight ? r.points / r.effective_weight : 0);
    }));
    const groupBy = (key) => [...new Set(convs.map((c) => c[key]))].map((value) => {
      const list = done.filter((e) => conv(e.group_id, e.conversation_id)[key] === value).filter((e) => e.final_total !== null);
      return { [key]: value, count: list.length, average_total: avg(list.map((e) => e.final_total)) };
    });
    const ids = new Set(evs.map((e) => e.id));
    const appeals = db.appeals.filter((a) => ids.has(a.evaluation_id));
    return {
      evaluated: done.length,
      average_total: avg(done.filter((e) => e.final_total !== null).map((e) => e.final_total)),
      critical_count: done.filter((e) => e.final_critical_flag).length,
      needs_review: evs.filter((e) => e.status === "needs_review").length,
      weak_criteria: Object.values(stat).map((k) => ({ criterion_id: k.criterion_id, title: k.title, average_ratio: avg(k.values), na_count: k.na_count })).filter((k) => k.average_ratio !== null).sort((a, b) => a.average_ratio - b.average_ratio),
      by_language: groupBy("language"), by_channel: groupBy("channel"),
      appeals: { total: appeals.length, open: appeals.filter((a) => a.status === "open").length, confirmed: appeals.filter((a) => a.decision === "confirmed").length, changed: appeals.filter((a) => a.decision === "changed").length },
    };
  }

  function normalizeUpload(data) {
    const list = Array.isArray(data) ? data : data && data.data && data.data.records ? data.data.records : data && data.conversation_id ? [data] : fail("Файл должен содержать запись, массив записей или ответ API");
    return list.map((rec) => {
      if (!rec.conversation_id || !Array.isArray(rec.transcript)) fail("В записи нет conversation_id или transcript");
      const iso = rec.channel === "voice call" ? Date.parse(rec.transcript[0] && rec.transcript[0].timestamp) : NaN;
      return {
        conversation_id: rec.conversation_id, channel: rec.channel || "agent chat", language: rec.language || "RU",
        transcript: rec.transcript.map((t, i) => {
          if (!["client", "operator", "bot", "system"].includes(t.speaker)) fail("Неизвестная роль: " + t.speaker);
          let sec = null;
          const m = /^(\d+):(\d{2})$/.exec(t.timestamp || "");
          if (m) sec = Number(m[1]) * 60 + Number(m[2]);
          else if (!isNaN(iso) && !isNaN(Date.parse(t.timestamp))) sec = Math.round((Date.parse(t.timestamp) - iso) / 100) / 10;
          return { id: "u" + (i + 1), timestamp: t.timestamp, t: sec, speaker: t.speaker, text: t.text };
        }),
      };
    });
  }

  // Тихая запись нужной длины, чтобы в демо работала перемотка.
  const audioCache = {};
  function silentWav(seconds) {
    const rate = 8000, n = Math.ceil(seconds * rate), buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, "data"); v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  importGroup("DEV", base);
  db.conversations.forEach((c) => runEvaluation(makeEvaluation(c, db.checklists[0])));

  const routes = [
    ["POST", /^\/datasets\/import$/, (_, b) => {
      const g = (b.group_id || "").trim() || fail("Укажите group_id");
      const list = g === "DEV" ? base : base.slice(0, 3).map((x) => ({ ...x, conversation_id: x.conversation_id.replace("demo", g.toLowerCase()) }));
      const n = importGroup(g, list);
      return { imported: n, total: n };
    }],
    ["POST", /^\/conversations\/upload$/, (_, b, q) => {
      const list = normalizeUpload(b);
      return { imported: importGroup(q.get("group_id") || "UPLOAD", list) };
    }],
    ["GET", /^\/conversations$/, (_, __, q) => db.conversations
      .filter((c) => !q.get("group_id") || c.group_id === q.get("group_id"))
      .map((c) => listRow(c, q.get("checklist_id")))
      .filter((r) => (!q.get("channel") || r.channel === q.get("channel")) && (!q.get("language") || r.language === q.get("language")) && (!q.get("status") || r.status === q.get("status")))
      .sort((a, b) => (b.critical_flag - a.critical_flag) || ((b.status === "needs_review") - (a.status === "needs_review")) || ((a.final_total === null ? 101 : a.final_total) - (b.final_total === null ? 101 : b.final_total)))],
    ["GET", /^\/conversations\/([^/]+)\/([^/]+)$/, (m) => {
      const c = conv(decodeURIComponent(m[1]), decodeURIComponent(m[2])) || fail("Диалог не найден");
      const { script, audio, failFirst, failedOnce, ...pub } = clone(c);
      return {
        ...pub, duration: duration(c), audio_path: audio ? `/api/audio/${c.group_id}/${c.conversation_id}` : null,
        evaluations: db.evaluations.filter((e) => e.group_id === c.group_id && e.conversation_id === c.conversation_id).sort((x, y) => y.id - x.id)
          .map((e) => ({ id: e.id, checklist_id: e.checklist_id, checklist_version: e.checklist_version, status: e.status, final_total: e.final_total, created_at: e.created_at })),
      };
    }],
    ["GET", /^\/checklists$/, () => [...new Set(db.checklists.map((c) => c.id))].map((id) => clone(latest(id)))],
    ["GET", /^\/checklists\/([^/]+)\/versions$/, (m) => db.checklists.filter((c) => c.id === m[1]).sort((a, b) => b.version - a.version).map((c) => ({ id: c.id, version: c.version, name: c.name, created_at: c.created_at }))],
    ["GET", /^\/checklists\/([^/]+)\/versions\/(\d+)$/, (m) => clone(version(m[1], m[2]) || fail("Версия не найдена"))],
    ["POST", /^\/checklists$/, (_, b) => {
      const warnings = validateChecklist(b);
      const id = "checklist-" + Date.now();
      const row = { ...clone(b), id, version: 1, created_at: new Date().toISOString() };
      db.checklists.push(row);
      return { ...clone(row), warnings };
    }],
    ["PUT", /^\/checklists\/([^/]+)$/, (m, b) => {
      const prev = latest(m[1]) || fail("Чек-лист не найден");
      const warnings = validateChecklist(b);
      const row = { ...clone(b), id: prev.id, version: prev.version + 1, created_at: new Date().toISOString() };
      db.checklists.push(row);
      return { ...clone(row), warnings };
    }],
    ["POST", /^\/evaluations$/, (_, b) => {
      const list = b.all ? db.conversations.filter((c) => c.group_id === b.group_id) : (b.conversation_ids || []).map((id) => conv(b.group_id, id)).filter(Boolean);
      if (!list.length) fail("Нет диалогов для оценки");
      const cl = (b.version ? version(b.checklist_id, b.version) : latest(b.checklist_id)) || fail("Чек-лист не найден");
      const job = { id: db.nextId++, total: list.length, done: 0, failed: 0, status: "running", queue: [] };
      db.jobs.push(job);
      list.forEach((c) => {
        const cached = !b.force && db.evaluations.find((e) => e.group_id === c.group_id && e.conversation_id === c.conversation_id && e.checklist_id === cl.id && e.checklist_version === cl.version && e.status === "done");
        if (cached) job.done++;
        else job.queue.push(makeEvaluation(c, cl, job));
      });
      if (job.done === job.total) job.status = "done";
      const step = () => {
        const ev = job.queue.shift();
        if (!ev) { job.status = "done"; return; }
        ev.status = "running";
        setTimeout(() => {
          runEvaluation(ev);
          if (ev.status === "done") job.done++; else job.failed++;
          step();
        }, 250);
      };
      step();
      return { job_id: job.id, total: job.total };
    }],
    ["GET", /^\/jobs\/(\d+)$/, (m) => {
      const j = db.jobs.find((x) => x.id === Number(m[1])) || fail("Задание не найдено");
      return { id: j.id, status: j.status, total: j.total, done: j.done, failed: j.failed };
    }],
    ["GET", /^\/evaluations\/(\d+)$/, (m) => evalView(db.evaluations.find((e) => e.id === Number(m[1])) || fail("Оценка не найдена"))],
    ["POST", /^\/appeals$/, (_, b) => {
      const ev = db.evaluations.find((e) => e.id === b.evaluation_id) || fail("Оценка не найдена");
      if (!ev.results.some((r) => r.criterion_id === b.criterion_id)) fail("Критерий не найден");
      if (!(b.comment || "").trim()) fail("Добавьте комментарий");
      if (db.appeals.some((a) => a.evaluation_id === ev.id && a.criterion_id === b.criterion_id && a.status === "open")) fail("По этому критерию уже есть открытая апелляция");
      const a = { id: db.nextId++, evaluation_id: ev.id, criterion_id: b.criterion_id, comment: b.comment.trim(), status: "open", created_by: b.created_by, created_at: new Date().toISOString(), decision: null, new_answer: null, decision_reason: null, decided_by: null, decided_at: null };
      db.appeals.push(a);
      return clone(a);
    }],
    ["GET", /^\/appeals$/, (_, __, q) => db.appeals.filter((a) => !q.get("status") || a.status === q.get("status")).sort((a, b) => b.id - a.id).map(appealView)],
    ["POST", /^\/appeals\/(\d+)\/decision$/, (m, b) => {
      const a = db.appeals.find((x) => x.id === Number(m[1])) || fail("Апелляция не найдена");
      if (a.status !== "open") fail("Апелляция уже закрыта");
      if (!(b.decision_reason || "").trim()) fail("Укажите причину решения");
      const ev = db.evaluations.find((e) => e.id === a.evaluation_id);
      const r = ev.results.find((x) => x.criterion_id === a.criterion_id);
      if (b.decision === "changed") {
        const k = version(ev.checklist_id, ev.checklist_version).criteria.find((x) => x.id === a.criterion_id);
        let v = b.new_answer;
        if (k.type === "scale" && v !== "NA") v = Number(v);
        const valid = (v === "NA" && k.na_allowed) || (k.type === "yes_no" ? v === "yes" || v === "no" : k.steps.some((s) => Number(s.value) === v));
        if (!valid) fail("Недопустимая новая оценка");
        r.final_answer = v;
        a.new_answer = v;
      } else if (b.decision !== "confirmed") fail("Выберите решение");
      Object.assign(a, { status: "resolved", decision: b.decision, decision_reason: b.decision_reason.trim(), decided_by: b.decided_by, decided_at: new Date().toISOString() });
      applyFinal(ev);
      return evalView(ev);
    }],
    ["GET", /^\/analytics$/, (_, __, q) => analytics({ group_id: q.get("group_id"), checklist_id: q.get("checklist_id") })],
  ];

  CQA.mock = {
    request(method, fullPath, body) {
      const [path, search] = fullPath.split("?");
      const q = new URLSearchParams(search || "");
      for (const [m, re, fn] of routes) {
        const match = m === method && re.exec(path);
        if (match) return Promise.resolve().then(() => clone(fn(match, body, q)));
      }
      return Promise.reject(new Error("Демо-сервер: неизвестный запрос " + method + " " + path));
    },
    audioUrl(path) {
      if (!audioCache[path]) {
        const [, , , g, id] = path.split("/");
        audioCache[path] = silentWav(duration(conv(g, id)));
      }
      return audioCache[path];
    },
  };
})(window.CQA);
