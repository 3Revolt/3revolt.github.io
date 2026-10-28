// --- OFFLINE CHATBOT ENGINE (JavaScript verzija) ---
// Vjeran prijevod Multipage/chatbot_engine.py - radi potpuno u browseru, bez interneta i bez API-ja.
// Tabele (namjere, vještine, ključne riječi) i CV podaci dolaze iz js/cv-data.js.
//
// Kako radi:
//   1. Tekst se normalizuje (mala slova, bez kvačica, "c#" -> "csharp" ...).
//   2. Prepoznaje se jezik pitanja (bs / en / de).
//   3. Prepoznaju se entiteti: firma, vještina/oblast, projekat, godina.
//   4. Svaka namjera dobija bodove po ključnim riječima (tačno, prefiks ili fuzzy) i pobjeđuje najjača.
//   5. Ako ništa ne odgovara, pretražuje se cijeli tekst CV-a.
//   6. Kontekst razgovora (zadnja firma, tema) omogućava pitanja tipa "A koliko dugo?".

(function (global) {
  "use strict";

  const CV = global.CV_DATA;
  const BOT = global.CHATBOT_DATA;
  const LANGS = ["bs", "en", "de"];
  const LANGUAGE_CODES = { Bosanski: "bs", English: "en", Deutsch: "de" };
  const PRESENT = { bs: "Danas", en: "Present", de: "Heute" };

  // =========================================================================
  // CV pomoćne funkcije (isto kao cv_data.py)
  // =========================================================================

  const langCode = (name) => LANGUAGE_CODES[name] || "en";

  function tr(value, lang) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value[lang] || value.en || Object.values(value)[0];
    }
    return value;
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  function formatPeriod(job, lang) {
    const start = `${pad2(job.start[1])}/${job.start[0]}`;
    const end = job.end ? `${pad2(job.end[1])}/${job.end[0]}` : PRESENT[lang];
    return `${start} - ${end}`;
  }

  const skillCategoryLine = (c, lang) => `● **${tr(c.name, lang)}:** ${c.items[lang].join(", ")}.`;
  const projectLine = (p, lang) => `${p.emoji} **${tr(p.name, lang)}:** ${p.description[lang]}`;

  function educationLines(lang) {
    const sep = lang === "de" ? " – " : " - ";
    return [`• ${CV.education.years}${sep}${CV.education.school[lang]}`, `• ${CV.education.profession[lang]}`];
  }

  const jobRole = (job, lang) => tr(job.role || job.subheader, lang);

  const JOBS = CV.jobs;
  const JOBS_BY_ID = Object.fromEntries(JOBS.map((j) => [j.id, j]));
  const PROJECTS_BY_ID = Object.fromEntries(CV.projects.map((p) => [p.id, p]));
  const PROJECT_ORDER = CV.projects.map((p) => p.id);

  // =========================================================================
  // 1. NORMALIZACIJA I TOKENIZACIJA
  // =========================================================================

  const CHAR_MAP = { "č": "c", "ć": "c", "š": "s", "ž": "z", "ä": "a", "ö": "o", "ü": "u", "é": "e", "è": "e",
    "á": "a", "à": "a", "ó": "o", "í": "i", "ú": "u", "’": "'", "`": "'" };
  const TECH_SUBSTITUTIONS = BOT.techSubstitutions.map(([p, r]) => [new RegExp(p, "g"), r]);
  const STOPWORDS = new Set(BOT.stopwords);

  function normalize(text) {
    let t = text.toLowerCase().replace(/đ/g, "dj").replace(/ß/g, "ss");
    t = t.replace(/[čćšžäöüéèáàóíú’`]/g, (ch) => CHAR_MAP[ch]);
    for (const [pattern, replacement] of TECH_SUBSTITUTIONS) t = t.replace(pattern, replacement);
    return t;
  }

  const tokenize = (normalized) => normalized.match(/[a-z0-9]+/g) || [];

  // =========================================================================
  // 2. PREPOZNAVANJE JEZIKA
  // =========================================================================

  const LANG_WORDS = Object.fromEntries(Object.entries(BOT.langWords).map(([k, v]) => [k, new Set(v)]));

  function detectLanguage(text, fallback) {
    const lowered = text.toLowerCase();
    const tokens = tokenize(normalize(text));
    const scores = {};
    for (const lang of Object.keys(LANG_WORDS)) scores[lang] = tokens.filter((t) => LANG_WORDS[lang].has(t)).length;
    if (/[čćšđž]/.test(lowered)) scores.bs += 3;
    if (/[äöüß]/.test(lowered)) scores.de += 3;
    const best = maxKey(scores);
    const ordered = Object.values(scores).sort((a, b) => b - a);
    if (ordered[0] === 0 || ordered[0] === ordered[1]) return [fallback, 0];
    return [best, ordered[0] - ordered[1]];
  }

  // Prvi ključ sa najvećom vrijednošću (kao Pythonov max(d, key=d.get))
  function maxKey(obj) {
    let best = null;
    for (const [k, v] of entries(obj)) if (best === null || v > best[1]) best = [k, v];
    return best ? best[0] : null;
  }
  const entries = (obj) => (obj instanceof Map ? [...obj.entries()] : Object.entries(obj));
  // Stabilno sortiranje ključeva po vrijednosti, opadajuće (kao sorted(..., reverse=True))
  const sortedKeysDesc = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const maxValue = (map) => Math.max(...map.values());

  // =========================================================================
  // difflib.get_close_matches (Ratcliff/Obershelp, isto kao Python)
  // =========================================================================

  function matchingCharacters(a, b) {
    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
      if (!b2j.has(b[j])) b2j.set(b[j], []);
      b2j.get(b[j]).push(j);
    }
    function findLongestMatch(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        for (const j of b2j.get(a[i]) || []) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = newj2len;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
      return [besti, bestj, bestsize];
    }
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  function getCloseMatches(word, possibilities, n, cutoff) {
    const result = [];
    for (const x of possibilities) {
      const total = x.length + word.length;
      if ((2 * Math.min(x.length, word.length)) / total < cutoff) continue; // real_quick_ratio
      const avail = new Map();
      for (const ch of word) avail.set(ch, (avail.get(ch) || 0) + 1);
      let matches = 0;
      for (const ch of x) { const c = avail.get(ch) || 0; if (c > 0) { matches++; avail.set(ch, c - 1); } }
      if ((2 * matches) / total < cutoff) continue; // quick_ratio
      const ratio = (2 * matchingCharacters(x, word)) / total;
      if (ratio >= cutoff) result.push([ratio, x]);
    }
    result.sort((p, q) => q[0] - p[0] || (q[1] > p[1] ? 1 : q[1] < p[1] ? -1 : 0));
    return result.slice(0, n).map((r) => r[1]);
  }

  // =========================================================================
  // 3. POKLAPANJE KLJUČNIH RIJEČI
  // =========================================================================
  // "rijec" = tačno (ili fuzzy), "prefiks*" = počinje sa, "vise rijeci" = fraza, "rijec:2" = težina

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

  class KeywordMatcher {
    constructor(table, fuzzyCutoff = 0.84) {
      this.exact = new Map();
      this.prefixes = [];
      this.phrases = [];
      this.fuzzyCutoff = fuzzyCutoff;
      for (const [key, specs] of Object.entries(table)) {
        for (const raw of specs) {
          const idx = raw.indexOf(":");
          const weightText = idx >= 0 ? raw.slice(idx + 1) : "";
          const spec = normalize(idx >= 0 ? raw.slice(0, idx) : raw).trim();
          if (spec.includes(" ")) {
            const words = spec.split(/\s+/).map((w) => (w.endsWith("*") ? escapeRegex(w.slice(0, -1)) + "[a-z0-9]*" : escapeRegex(w)));
            const pattern = new RegExp("(?:^|[^a-z0-9])" + words.join(" ") + "(?![a-z0-9])");
            this.phrases.push([pattern, key, weightText ? parseFloat(weightText) : 2.5]);
          } else if (spec.endsWith("*")) {
            this.prefixes.push([spec.slice(0, -1), key, weightText ? parseFloat(weightText) : 1]);
          } else {
            if (!this.exact.has(spec)) this.exact.set(spec, []);
            this.exact.get(spec).push([key, weightText ? parseFloat(weightText) : 1]);
          }
        }
      }
      this.vocab = [...this.exact.keys()].filter((w) => w.length >= 5);
    }

    match(tokens) {
      const scores = new Map();
      const add = (key, weight) => scores.set(key, (scores.get(key) || 0) + weight);
      const joined = tokens.join(" ");
      for (const [pattern, key, weight] of this.phrases) if (pattern.test(joined)) add(key, weight);
      for (const token of tokens) {
        const hits = this.exact.get(token);
        if (hits) { for (const [key, weight] of hits) add(key, weight); continue; }
        let prefixHit = false;
        for (const [prefix, key, weight] of this.prefixes) {
          if (token.startsWith(prefix)) { add(key, weight); prefixHit = true; }
        }
        if (prefixHit || STOPWORDS.has(token) || token.length < 5) continue;
        for (const close of getCloseMatches(token, this.vocab, 2, this.fuzzyCutoff)) {
          for (const [key, weight] of this.exact.get(close)) add(key, weight * 0.8);
        }
      }
      return scores;
    }
  }

  // =========================================================================
  // 4-5. ZNANJE I NAMJERE
  // =========================================================================

  const KNOWLEDGE = BOT.knowledge;
  const KNOWLEDGE_BY_ID = Object.fromEntries(KNOWLEDGE.map((k) => [k.id, k]));
  const UNLISTED_TECH = BOT.unlistedTech;
  const FOLLOW_UP_SET = new Set(BOT.followUp);

  const INTENT_MATCHER = new KeywordMatcher(BOT.intents);
  const ASPECT_MATCHER = new KeywordMatcher(BOT.jobAspects);
  const COMPANY_MATCHER = new KeywordMatcher(Object.fromEntries(JOBS.map((j) => [j.id, j.aliases])), 0.8);
  const KNOWLEDGE_MATCHER = new KeywordMatcher(Object.fromEntries(KNOWLEDGE.map((k) => [k.id, k.aliases])), 0.88);
  const PROJECT_MATCHER = new KeywordMatcher(BOT.projectAliases, 0.88);

  // =========================================================================
  // 6. POMOĆNE FUNKCIJE ZA ODGOVORE
  // =========================================================================

  const L = (lang, bs, en, de) => ({ bs, en, de })[lang];
  const monthsBetween = (s, e) => (e[0] - s[0]) * 12 + (e[1] - s[1]);
  function today() { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1]; }
  const jobMonths = (job) => monthsBetween(job.start, job.end || today()) + 1;
  const tupleLE = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

  function formatDuration(months, lang) {
    const years = Math.floor(months / 12), rest = months % 12;
    const parts = [];
    if (years) {
      const bsWord = (years % 10 === 1 && years !== 11) ? "godina" : (years % 10 >= 2 && years % 10 <= 4 && !(years >= 12 && years <= 14)) ? "godine" : "godina";
      parts.push(L(lang, `${years} ${bsWord}`, `${years} year${years !== 1 ? "s" : ""}`, `${years} Jahr${years !== 1 ? "e" : ""}`));
    }
    if (rest) {
      const bsWord = rest === 1 ? "mjesec" : (rest >= 2 && rest <= 4) ? "mjeseca" : "mjeseci";
      parts.push(L(lang, `${rest} ${bsWord}`, `${rest} month${rest !== 1 ? "s" : ""}`, `${rest} Monat${rest !== 1 ? "e" : ""}`));
    }
    return parts.length ? parts.join(L(lang, " i ", " and ", " und ")) : L(lang, "manje od mjesec dana", "less than a month", "weniger als einen Monat");
  }

  function totalExperienceMonths(itOnly = false) {
    const covered = new Set();
    for (const job of JOBS) {
      if (itOnly && job.id === "ataco") continue;
      let [y, m] = job.start;
      const end = job.end || today();
      while (tupleLE([y, m], end)) {
        covered.add(y * 100 + m);
        m += 1;
        if (m > 12) { y += 1; m = 1; }
      }
    }
    return covered.size;
  }

  const companyLabel = (job, lang) => tr(job.company_name, lang);
  const knowledgeName = (item, lang) => tr(item.name, lang);

  function contactHint(lang, short = false) {
    const email = CV.personal.email;
    if (short) {
      return L(lang, `**${email}** ili **[kontakt forma](/#contact-me)**.`, `**${email}** or the **[contact form](/#contact-me)**.`,
        `**${email}** oder das **[Kontaktformular](/#contact-me)**.`);
    }
    return L(lang,
      `Za to me najbolje kontaktirajte direktno: **${email}** ili putem **[kontakt forme](/#contact-me)**.`,
      `For that, it's best to contact me directly: **${email}** or via the **[contact form](/#contact-me)**.`,
      `Dafür kontaktieren Sie mich am besten direkt: **${email}** oder über das **[Kontaktformular](/#contact-me)**.`);
  }

  function tokenMatch(q, d) {
    if (q === d) return true;
    if (q.length < 4 || d.length < 4) return false;
    let common = 0;
    while (common < q.length && common < d.length && q[common] === d[common]) common++;
    const needed = Math.max(4, Math.min(6, Math.min(q.length, d.length) - 2));
    return common >= needed;
  }

  function findEvidence(item, maxItems = 4, queryTokens = null) {
    const terms = (item.evidence || []).map((t) => t.toLowerCase());
    if (!terms.length) return [];
    const query = (queryTokens || []).filter((t) => !STOPWORDS.has(t) && t.length >= 4);
    const termRegexes = terms.map((t) => new RegExp("\\b" + escapeRegex(t)));
    const relevance = (job, i) => {
      const words = new Set();
      for (const lg of LANGS) for (const w of tokenize(normalize(job.duties[lg][i]))) words.add(w);
      return query.filter((q) => [...words].some((w) => tokenMatch(q, w))).length;
    };
    const results = [];
    for (const job of JOBS) {
      const idx = [];
      job.duties.en.forEach((duty, i) => { if (termRegexes.some((r) => r.test(duty.toLowerCase()))) idx.push(i); });
      if (idx.length) {
        const rel = new Map(idx.map((i) => [i, relevance(job, i)]));
        idx.sort((a, b) => rel.get(b) - rel.get(a));
        results.push([job, idx.slice(0, 2), rel.get(idx[0])]);
      }
    }
    results.sort((a, b) => b[2] - a[2]);
    return results.slice(0, maxItems).map((r) => [r[0], r[1]]);
  }

  function jobSummary(job, lang, full = true) {
    const period = formatPeriod(job, lang);
    const duration = formatDuration(jobMonths(job), lang);
    const role = jobRole(job, lang);
    const company = companyLabel(job, lang);
    const current = job.end === null;
    const header = L(lang,
      `U **${company}** ${current ? "radim" : "sam radio"} kao **${role}** (${period}, ${duration}).`,
      `At **${company}** I ${current ? "work" : "worked"} as **${role}** (${period}, ${duration}).`,
      `Bei **${company}** ${current ? "arbeite" : "arbeitete"} ich als **${role}** (${period}, ${duration}).`);
    if (!full) return header;
    const title = L(lang, "Ključne odgovornosti:", "Key responsibilities:", "Hauptaufgaben:");
    const lines = job.duties[lang].map((d) => `- ${d}`).join("\n");
    return `${header}\n\n${title}\n${lines}`;
  }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // =========================================================================
  // 7. ODGOVORI PO NAMJERAMA
  // =========================================================================

  const A = {};

  A.greeting = (lang) => pick(L(lang,
    ["Zdravo! 👋 Drago mi je. Pitajte me o mom iskustvu, vještinama, projektima ili kako me kontaktirati.",
      "Pozdrav! 😊 Šta vas zanima – radno iskustvo, tehničke vještine ili projekti?"],
    ["Hello! 👋 Nice to meet you. Ask me about my experience, skills, projects or how to contact me.",
      "Hi there! 😊 What would you like to know – work experience, technical skills or projects?"],
    ["Hallo! 👋 Schön, dass Sie da sind. Fragen Sie mich nach meiner Erfahrung, meinen Fähigkeiten, Projekten oder Kontaktdaten.",
      "Guten Tag! 😊 Was interessiert Sie – Berufserfahrung, technische Fähigkeiten oder Projekte?"]));

  A.farewell = (lang) => L(lang,
    `Hvala na posjeti! 👋 Ako vas nešto zanima kasnije, tu sam. Možete me kontaktirati i na **${CV.personal.email}**.`,
    `Thanks for stopping by! 👋 I'm here if you have more questions. You can also reach me at **${CV.personal.email}**.`,
    `Danke für Ihren Besuch! 👋 Bei weiteren Fragen bin ich da. Sie erreichen mich auch unter **${CV.personal.email}**.`);

  A.thanks = (lang) => pick(L(lang,
    ["Nema na čemu! 😊 Želite li znati još nešto?", "Drago mi je da sam pomogao! Ima li još pitanja?"],
    ["You're welcome! 😊 Anything else you'd like to know?", "Glad I could help! Any other questions?"],
    ["Gern geschehen! 😊 Möchten Sie noch etwas wissen?", "Freut mich, dass ich helfen konnte! Noch weitere Fragen?"]));

  A.how_are_you = (lang) => L(lang,
    "Odlično, hvala na pitanju! 😊 Spreman sam odgovoriti na sve o mom iskustvu i vještinama. Šta vas zanima?",
    "Great, thanks for asking! 😊 I'm ready to answer anything about my experience and skills. What would you like to know?",
    "Sehr gut, danke der Nachfrage! 😊 Ich beantworte gerne alles zu meiner Erfahrung und meinen Fähigkeiten. Was möchten Sie wissen?");

  A.bot = (lang) => L(lang,
    "Ja sam Amarov virtualni asistent 🤖. Radim **potpuno offline** – bez interneta i bez vanjskih AI servisa. " +
    "Odgovaram u Amarovo ime isključivo na osnovu podataka iz njegovog CV-a, na bosanskom, engleskom i njemačkom.",
    "I'm Amar's virtual assistant 🤖. I run **completely offline** – no internet and no external AI services. " +
    "I answer on Amar's behalf strictly based on his CV, in Bosnian, English and German.",
    "Ich bin Amars virtueller Assistent 🤖. Ich arbeite **komplett offline** – ohne Internet und ohne externe KI-Dienste. " +
    "Ich antworte in Amars Namen ausschließlich auf Basis seines Lebenslaufs, auf Bosnisch, Englisch und Deutsch.");

  A.intro = (lang) => {
    const current = JOBS[0];
    const years = Math.floor(totalExperienceMonths() / 12);
    const p = CV.personal;
    return L(lang,
      `Ja sam **${p.name}**, ${p.role[lang]}, iz grada ${p.location[lang]}.\n\n${p.description[lang]}\n\n` +
      `Trenutno radim u **${companyLabel(current, lang)}** kao **${jobRole(current, lang)}**, a ukupno imam oko **${years} godina** radnog iskustva u ${JOBS.length} firmi.`,
      `I'm **${p.name}**, ${p.role[lang]}, based in ${p.location[lang]}.\n\n${p.description[lang]}\n\n` +
      `I currently work at **${companyLabel(current, lang)}** as **${jobRole(current, lang)}**, with around **${years} years** of work experience across ${JOBS.length} companies.`,
      `Ich bin **${p.name}**, ${p.role[lang]}, wohnhaft in ${p.location[lang]}.\n\n${p.description[lang]}\n\n` +
      `Derzeit arbeite ich bei **${companyLabel(current, lang)}** als **${jobRole(current, lang)}** und habe insgesamt rund **${years} Jahre** Berufserfahrung in ${JOBS.length} Unternehmen.`);
  };

  A.name = (lang) => L(lang, `Zovem se **${CV.personal.name}**. 😊`, `My name is **${CV.personal.name}**. 😊`, `Mein Name ist **${CV.personal.name}**. 😊`);

  function bsYearsWord(n) {
    if (n % 10 === 1 && n !== 11) return "godina";
    if (n % 10 >= 2 && n % 10 <= 4 && !(n >= 12 && n <= 14)) return "godine";
    return "godina";
  }
  function currentAge() {
    const [day, month, year] = CV.personal.birth_date.split(".").map(Number);
    const d = new Date();
    const m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() - year - ((m < month || (m === month && dd < day)) ? 1 : 0);
  }

  A.age = (lang) => {
    const birth = CV.personal.birth_date, age = currentAge();
    return L(lang,
      `Rođen sam **${birth}** (${age} ${bsYearsWord(age)}). Imam preko 10 godina radnog iskustva, od 2014. godine.`,
      `I was born on **${birth}** (${age} years old). I have over 10 years of work experience, since 2014.`,
      `Ich bin am **${birth}** geboren (${age} Jahre alt). Ich habe über 10 Jahre Berufserfahrung, seit 2014.`);
  };

  A.personal = (lang) => L(lang,
    "To je privatna tema koju ne pokriva moj CV – ovdje se fokusiram na profesionalno iskustvo. 🙂 Pitajte me slobodno o poslu, vještinama ili projektima.",
    "That's a private topic my CV doesn't cover – here I focus on professional experience. 🙂 Feel free to ask about work, skills or projects.",
    "Das ist ein privates Thema, das mein Lebenslauf nicht abdeckt – hier geht es um Berufliches. 🙂 Fragen Sie gerne nach Arbeit, Fähigkeiten oder Projekten.");

  A.hobbies = (lang) => L(lang,
    "Hobiji nisu posebno navedeni u CV-u, ali u slobodno vrijeme se najviše bavim tehnologijom: " +
    "gradio sam **lokalni AI lab** (Ubuntu, Docker, Ollama), eksperimentišem sa **generativnim 3D alatima** (Rodin-3D, DINOv3) " +
    "i pravim **web projekte** u Reactu. ",
    "Hobbies aren't listed in my CV, but in my free time I'm mostly into technology: " +
    "I built a **local AI lab** (Ubuntu, Docker, Ollama), I experiment with **generative 3D tools** (Rodin-3D, DINOv3) " +
    "and build **web projects** with React. ",
    "Hobbys stehen nicht im Lebenslauf, aber in meiner Freizeit beschäftige ich mich vor allem mit Technologie: " +
    "Ich habe ein **lokales KI-Labor** aufgebaut (Ubuntu, Docker, Ollama), experimentiere mit **generativen 3D-Tools** (Rodin-3D, DINOv3) " +
    "und baue **Webprojekte** mit React. ") + L(lang, "Za ostalo – pitajte me lično. 🙂", "For anything else – just ask me personally. 🙂", "Alles Weitere – fragen Sie mich gerne persönlich. 🙂");

  A.contact = (lang) => {
    const email = CV.personal.email;
    return L(lang,
      `Možete me kontaktirati direktno putem emaila: **${email}**.\n\nTakođer, možete popuniti **[kontakt formu na početnoj stranici 'O meni'](/#contact-me)** – poruka mi stiže direktno na mail.`,
      `You can contact me directly via email: **${email}**.\n\nAlternatively, you can fill out the **[contact form on the 'About Me' home page](/#contact-me)** – the message goes straight to my inbox.`,
      `Sie können mich direkt per E-Mail erreichen: **${email}**.\n\nAlternativ können Sie das **[Kontaktformular auf der Startseite 'Über mich'](/#contact-me)** ausfüllen – die Nachricht landet direkt in meinem Postfach.`);
  };

  A.phone = (lang) => {
    const email = CV.personal.email, phone = CV.personal.phone;
    return L(lang,
      `Moj broj telefona je **${phone}**. Možete mi pisati i na **${email}** ili putem **[kontakt forme](/#contact-me)**.`,
      `My phone number is **${phone}**. You can also write to **${email}** or use the **[contact form](/#contact-me)**.`,
      `Meine Telefonnummer ist **${phone}**. Sie können mir auch an **${email}** schreiben oder das **[Kontaktformular](/#contact-me)** nutzen.`);
  };

  A.social = (lang) => L(lang,
    "Linkovi na društvene mreže (LinkedIn, GitHub) nisu objavljeni na ovom sajtu. ",
    "Social media links (LinkedIn, GitHub) aren't published on this site. ",
    "Social-Media-Links (LinkedIn, GitHub) sind auf dieser Seite nicht veröffentlicht. ") + contactHint(lang);

  A.location = (lang) => {
    const loc = CV.personal.location[lang], email = CV.personal.email;
    return L(lang,
      `Živim u **${loc}**. Za pitanja o preseljenju ili radu na daljinu, slobodno me kontaktirajte na **${email}** ili preko **[kontakt forme](/#contact-me)**.`,
      `I live in **${loc}**. For questions about relocation or remote work, feel free to contact me at **${email}** or through the **[contact form](/#contact-me)**.`,
      `Ich lebe in **${loc}**. Bei Fragen zu Umzug oder Remote-Arbeit kontaktieren Sie mich gerne unter **${email}** oder über das **[Kontaktformular](/#contact-me)**.`);
  };

  A.relocation = (lang) => {
    const loc = CV.personal.location[lang], email = CV.personal.email;
    return L(lang,
      `Trenutno sam u **${loc}**. Imam iskustvo sa uspostavljanjem sistema za **rad na daljinu** (CMS), a engleski govorim na nivou C1. ` +
      `O preseljenju, remote ili hibridnom radu najradije razgovaram direktno – **${email}** ili **[kontakt forma](/#contact-me)**.`,
      `I'm currently based in **${loc}**. I have experience setting up **remote work systems** (CMS) and speak English at C1 level. ` +
      `I'm happy to discuss relocation, remote or hybrid work directly – **${email}** or the **[contact form](/#contact-me)**.`,
      `Ich lebe derzeit in **${loc}**. Ich habe Erfahrung mit der Einrichtung von **Remote-Arbeitssystemen** (CMS) und spreche Englisch auf C1-Niveau. ` +
      `Über Umzug, Remote- oder Hybridarbeit spreche ich gerne direkt – **${email}** oder das **[Kontaktformular](/#contact-me)**.`);
  };

  A.current = (lang, state) => { const job = JOBS[0]; state.company = job.id; return jobSummary(job, lang); };

  A.experience = (lang) => {
    const years = Math.floor(totalExperienceMonths() / 12);
    const lines = JOBS.map((j) => `- **${companyLabel(j, lang)}** (${formatPeriod(j, lang)}): ${jobRole(j, lang)}`).join("\n");
    return L(lang,
      `Imam oko **${years} godina** radnog iskustva u ${JOBS.length} firmi:\n\n${lines}\n\nZa detalje o firmi pitajte npr. *„Šta si radio u Foreo?”* ili *„Koliko dugo si bio u Payten?”*`,
      `I have around **${years} years** of work experience across ${JOBS.length} companies:\n\n${lines}\n\nFor details, ask e.g. *"What did you do at Foreo?"* or *"How long were you at Payten?"*`,
      `Ich habe rund **${years} Jahre** Berufserfahrung in ${JOBS.length} Unternehmen:\n\n${lines}\n\nFür Details fragen Sie z. B. *„Was hast du bei Foreo gemacht?”* oder *„Wie lange warst du bei Payten?”*`);
  };

  // Prvi posao sa najranijim početkom (kao Pythonov min(JOBS, key=start))
  function firstJob() {
    let best = JOBS[0];
    for (const j of JOBS) if (tupleLE(j.start, best.start) && !(j.start[0] === best.start[0] && j.start[1] === best.start[1])) best = j;
    return best;
  }

  A.total_years = (lang) => {
    const total = totalExperienceMonths(), itTotal = totalExperienceMonths(true);
    const first = firstJob();
    const since = `${pad2(first.start[1])}/${first.start[0]}`;
    return L(lang,
      `Ukupno imam **${formatDuration(total, lang)}** radnog iskustva (od ${since}), od čega **${formatDuration(itTotal, lang)}** u IT-u i tehničkoj podršci.`,
      `In total I have **${formatDuration(total, lang)}** of work experience (since ${since}), of which **${formatDuration(itTotal, lang)}** in IT and technical support.`,
      `Insgesamt habe ich **${formatDuration(total, lang)}** Berufserfahrung (seit ${since}), davon **${formatDuration(itTotal, lang)}** in IT und technischem Support.`);
  };

  A.longest = (lang, state) => {
    let job = JOBS[0];
    for (const j of JOBS) if (jobMonths(j) > jobMonths(job)) job = j;
    state.company = job.id;
    return L(lang, "Najduže sam radio u ovoj firmi:\n\n", "The company where I worked the longest:\n\n", "Am längsten habe ich hier gearbeitet:\n\n") + jobSummary(job, lang);
  };

  A.first_job = (lang, state) => {
    const job = firstJob();
    state.company = job.id;
    return L(lang, "Karijeru sam počeo ovdje:\n\n", "I started my career here:\n\n", "Meine Karriere begann hier:\n\n") + jobSummary(job, lang);
  };

  A.previous = (lang, state) => {
    const ids = JOBS.map((j) => j.id);
    const current = state.company || ids[0];
    const idx = ids.includes(current) ? ids.indexOf(current) + 1 : 1;
    if (idx >= ids.length) {
      return L(lang, "To je bio moj prvi posao – prije toga sam završio srednju školu (2008–2012).",
        "That was my first job – before that I finished secondary school (2008–2012).",
        "Das war meine erste Stelle – davor habe ich die Mittelschule abgeschlossen (2008–2012).");
    }
    const job = JOBS[idx];
    state.company = job.id;
    return L(lang, "Prije toga:\n\n", "Before that:\n\n", "Davor:\n\n") + jobSummary(job, lang);
  };

  A.job_change = (lang) => L(lang,
    "Svaka promjena posla bila je dio mog **ličnog i profesionalnog razvoja**. Svjesno sam tražio nova okruženja u kojima mogu učiti, " +
    "rasti i graditi sebe kao IT stručnjaka – od korisničke podrške u telekomu i platnom prometu, preko mreža i servera, " +
    "do sistemske administracije, DevOps-a i AI automatizacije.\n\n" +
    "Svaka firma mi je donijela nova znanja i iskustva koja danas svakodnevno koristim. 🚀",
    "Every job change was part of my **personal and professional growth**. I deliberately looked for new environments where I could learn, " +
    "grow and build myself as an IT professional – from customer support in telecom and payments, through networks and servers, " +
    "to system administration, DevOps and AI automation.\n\n" +
    "Each company gave me new knowledge and experience that I use every day. 🚀",
    "Jeder Jobwechsel war Teil meiner **persönlichen und beruflichen Weiterentwicklung**. Ich habe bewusst neue Umfelder gesucht, in denen ich lernen, " +
    "wachsen und mich als IT-Fachmann weiterentwickeln konnte – vom Kundensupport in Telekommunikation und Zahlungsverkehr über Netzwerke und Server " +
    "bis hin zu Systemadministration, DevOps und KI-Automatisierung.\n\n" +
    "Jedes Unternehmen hat mir neues Wissen und Erfahrungen gebracht, die ich heute täglich nutze. 🚀");

  A.skills = (lang) => {
    const lines = CV.skillCategories.map((c) => skillCategoryLine(c, lang)).join("\n");
    const soft = CV.softSkills[lang].join(", ");
    return L(lang,
      `**Tehničke vještine:**\n\n${lines}\n\n**Soft skills:** ${soft}.\n\nPitajte me i za konkretnu tehnologiju, npr. *„Znaš li Docker?”*`,
      `**Technical skills:**\n\n${lines}\n\n**Soft skills:** ${soft}.\n\nYou can also ask about a specific technology, e.g. *"Do you know Docker?"*`,
      `**Technische Fähigkeiten:**\n\n${lines}\n\n**Soft Skills:** ${soft}.\n\nSie können auch nach einer konkreten Technologie fragen, z. B. *„Kennst du Docker?”*`);
  };

  function answerSkillCategory(categoryId, lang) {
    const category = CV.skillCategories.find((c) => c.id === categoryId);
    const related = KNOWLEDGE.filter((i) => i.category === categoryId && i.projects && i.projects.length);
    const projects = [...new Set(related.flatMap((i) => i.projects))].sort((a, b) => PROJECT_ORDER.indexOf(a) - PROJECT_ORDER.indexOf(b));
    let text = skillCategoryLine(category, lang);
    if (projects.length) {
      text += "\n\n" + L(lang, "Primijenjeno u projektima:", "Applied in projects:", "Angewendet in Projekten:") + "\n" +
        projects.map((p) => `- ${projectLine(PROJECTS_BY_ID[p], lang)}`).join("\n");
    }
    return text;
  }

  function answerKnowledge(item, lang, state, queryTokens = null) {
    state.topic = item.id;
    const name = knowledgeName(item, lang);
    const category = CV.skillCategories.find((c) => c.id === item.category) || null;
    const parts = [];
    if (item.level) {
      parts.push(L(lang, `Da, **${name}** – ${item.level[lang]}.`, `Yes, **${name}** – ${item.level[lang]}.`, `Ja, **${name}** – ${item.level[lang]}.`));
    } else {
      parts.push(L(lang, `Da, imam iskustva sa: **${name}**.`, `Yes, I have experience with **${name}**.`, `Ja, ich habe Erfahrung mit **${name}**.`));
    }
    const evidence = findEvidence(item, 4, queryTokens);
    if (evidence.length) {
      const lines = [];
      for (const [job, idx] of evidence) for (const i of idx) lines.push(`- **${companyLabel(job, lang)}** (${formatPeriod(job, lang)}): ${job.duties[lang][i]}`);
      parts.push(L(lang, "Iz radnog iskustva:", "From my work experience:", "Aus meiner Berufserfahrung:") + "\n" + lines.join("\n"));
    }
    const hasProjects = item.projects && item.projects.length;
    if (hasProjects) {
      parts.push(L(lang, "U projektima:", "In projects:", "In Projekten:") + "\n" + item.projects.map((p) => `- ${projectLine(PROJECTS_BY_ID[p], lang)}`).join("\n"));
    }
    if (!evidence.length && !hasProjects && category) {
      parts.push(L(lang, `Navedeno u kategoriji **${tr(category.name, lang)}** mojih vještina.`,
        `Listed under **${tr(category.name, lang)}** in my skills.`,
        `Aufgeführt unter **${tr(category.name, lang)}** in meinen Fähigkeiten.`));
    }
    if (item.note) parts.push(`ℹ️ ${item.note[lang]}`);
    return parts.join("\n\n");
  }

  function answerUnlisted(techName, relatedIds, lang) {
    const related = [];
    for (const rid of relatedIds) {
      if (KNOWLEDGE_BY_ID[rid]) related.push(knowledgeName(KNOWLEDGE_BY_ID[rid], lang));
      else {
        const category = CV.skillCategories.find((c) => c.id === rid);
        if (category) related.push(category.items[lang].slice(0, 4).join(", "));
      }
    }
    const relatedText = related.join("; ");
    const email = CV.personal.email;
    return L(lang,
      `**${techName}** nije posebno naveden u mom CV-u. Najbliže srodno iskustvo: **${relatedText}**. Brzo učim nove tehnologije – za detalje me slobodno kontaktirajte na **${email}**.`,
      `**${techName}** isn't specifically listed in my CV. The closest related experience: **${relatedText}**. I pick up new technologies quickly – feel free to contact me at **${email}** for details.`,
      `**${techName}** ist in meinem Lebenslauf nicht ausdrücklich aufgeführt. Am nächsten verwandte Erfahrung: **${relatedText}**. Ich lerne neue Technologien schnell – kontaktieren Sie mich gerne unter **${email}**.`);
  }

  A.projects = (lang) => {
    const lines = CV.projects.map((p) => `- ${projectLine(p, lang)}`).join("\n");
    return L(lang, `Moji ključni projekti:\n\n${lines}`, `My key projects:\n\n${lines}`, `Meine wichtigsten Projekte:\n\n${lines}`);
  };

  function answerProject(project, lang, state) {
    state.project = project.id;
    const tech = project.tech.join(", ");
    return `${projectLine(project, lang)}\n\n` + L(lang, `**Tehnologije:** ${tech}`, `**Technologies:** ${tech}`, `**Technologien:** ${tech}`);
  }

  function answerEducation(lang, asksUniversity = false) {
    const ed = CV.education;
    const courses = ed.courses[lang].join(", ");
    let text = L(lang,
      `🎓 **${ed.school[lang]}** (${ed.years})\nZvanje: ${ed.profession[lang]}.\n\nDodatno: ${courses}.`,
      `🎓 **${ed.school[lang]}** (${ed.years})\nQualification: ${ed.profession[lang]}.\n\nAdditionally: ${courses}.`,
      `🎓 **${ed.school[lang]}** (${ed.years})\nAbschluss: ${ed.profession[lang]}.\n\nZusätzlich: ${courses}.`);
    if (asksUniversity) {
      text += "\n\n" + L(lang,
        "Fakultet nije naveden u CV-u – moje IT znanje dolazi iz preko 10 godina prakse, samostalnog učenja i projekata.",
        "A university degree isn't listed in my CV – my IT knowledge comes from over 10 years of hands-on work, self-study and projects.",
        "Ein Hochschulabschluss ist nicht im Lebenslauf aufgeführt – mein IT-Wissen stammt aus über 10 Jahren Praxis, Selbststudium und Projekten.");
    }
    return text;
  }

  A.education = (lang) => answerEducation(lang);

  A.courses = (lang) => {
    const courses = CV.education.courses[lang].join(", ");
    return L(lang,
      `Završio sam **${courses}**. Ostali certifikati nisu navedeni u CV-u – većinu znanja sam stekao kroz praksu i projekte. `,
      `I completed a **${courses}**. Other certifications aren't listed in my CV – most of my knowledge comes from hands-on work and projects. `,
      `Ich habe einen **${courses}** absolviert. Weitere Zertifikate sind im Lebenslauf nicht aufgeführt – mein Wissen stammt vor allem aus der Praxis und Projekten. `) + contactHint(lang);
  };

  A.languages = (lang) => {
    const langs = CV.languages.map((l) => `- ${l.label[lang]}`).join("\n");
    return L(lang, `Govorim sljedeće jezike:\n\n${langs}`, `I speak the following languages:\n\n${langs}`, `Ich spreche folgende Sprachen:\n\n${langs}`);
  };

  A.soft_skills = (lang) => {
    const soft = CV.softSkills[lang].join(", ");
    return L(lang,
      `**Soft skills:** ${soft}.\n\nKroz godine rada u korisničkoj podršci (telekom, bankarski POS/ATM, ISP) navikao sam na rad pod pritiskom, jasnu komunikaciju sa korisnicima i timski rad sa tehničarima i razvojnim timovima.`,
      `**Soft skills:** ${soft}.\n\nYears of customer-facing support (telecom, banking POS/ATM, ISP) taught me to work under pressure, communicate clearly with users and collaborate with technicians and development teams.`,
      `**Soft Skills:** ${soft}.\n\nJahre im Kundensupport (Telekom, Bank-POS/ATM, ISP) haben mich gelehrt, unter Druck zu arbeiten, klar mit Benutzern zu kommunizieren und mit Technikern und Entwicklungsteams zusammenzuarbeiten.`);
  };

  A.strengths = (lang) => {
    const years = Math.floor(totalExperienceMonths() / 12);
    return L(lang,
      `Šta donosim timu:\n\n` +
      `- **${years}+ godina prakse** – od podrške korisnicima do sistemske administracije (Active Directory, mreže, serveri, sigurnost)\n` +
      `- **Automatizacija** – pišem skripte i koristim alate za automatizaciju, plus AI integracije i AI agente (Gemini API, Ollama, Claude Code)\n` +
      `- **Širina** – telekom, bankarski POS/ATM, ERP, javni sektor, web razvoj (React)\n` +
      `- **Komunikacija** – godine rada direktno sa korisnicima, pisanje dokumentacije i procedura\n` +
      `- **Brzo učenje** – samostalno sam razvio Help Desk sistem sa AI integracijom i lokalnu AI laboratoriju`,
      `What I bring to a team:\n\n` +
      `- **${years}+ years of hands-on work** – from user support to system administration (Active Directory, networks, servers, security)\n` +
      `- **Automation** – I write scripts and use automation tools, plus AI integrations and AI agents (Gemini API, Ollama, Claude Code)\n` +
      `- **Breadth** – telecom, banking POS/ATM, ERP, public sector, web development (React)\n` +
      `- **Communication** – years of working directly with users, writing documentation and procedures\n` +
      `- **Fast learner** – I independently developed a help desk system with AI integration and a local AI lab`,
      `Was ich einem Team biete:\n\n` +
      `- **${years}+ Jahre Praxis** – vom Benutzersupport bis zur Systemadministration (Active Directory, Netzwerke, Server, Sicherheit)\n` +
      `- **Automatisierung** – ich schreibe Skripte und nutze Automatisierungstools, dazu KI-Integrationen und KI-Agenten (Gemini API, Ollama, Claude Code)\n` +
      `- **Bandbreite** – Telekom, Bank-POS/ATM, ERP, öffentlicher Sektor, Webentwicklung (React)\n` +
      `- **Kommunikation** – jahrelange direkte Arbeit mit Benutzern, Erstellung von Dokumentationen und Verfahren\n` +
      `- **Schnelle Auffassungsgabe** – ich habe selbstständig ein Help-Desk-System mit KI-Integration und ein lokales KI-Labor entwickelt`);
  };

  A.salary = (lang) => L(lang, "Plata i uslovi su stvar dogovora i zavise od pozicije. ", "Salary and conditions are negotiable and depend on the position. ",
    "Gehalt und Konditionen sind Verhandlungssache und hängen von der Position ab. ") + contactHint(lang);

  A.availability = (lang) => L(lang,
    `Trenutno sam zaposlen u **${companyLabel(JOBS[0], lang)}**, pa početak zavisi od otkaznog roka i dogovora. `,
    `I'm currently employed at **${companyLabel(JOBS[0], lang)}**, so a start date depends on the notice period and agreement. `,
    `Ich bin derzeit bei **${companyLabel(JOBS[0], lang)}** angestellt, daher hängt der Beginn von der Kündigungsfrist und Absprache ab. `) + contactHint(lang);

  A.job_search = (lang) => L(lang,
    "Otvoren sam za zanimljive prilike, posebno u oblastima **DevOps**, **sistemske administracije** i **AI automatizacije**. " +
    "Za ponude, intervju ili saradnju pišite mi: ",
    "I'm open to interesting opportunities, especially in **DevOps**, **system administration** and **AI automation**. " +
    "For offers, interviews or collaboration, write to me: ",
    "Ich bin offen für interessante Möglichkeiten, besonders in den Bereichen **DevOps**, **Systemadministration** und **KI-Automatisierung**. " +
    "Für Angebote, Interviews oder Zusammenarbeit schreiben Sie mir: ") + contactHint(lang, true);

  A.goals = (lang) => L(lang,
    "Moj fokus je unapređenje IT procesa kroz **DevOps prakse** i **AI automatizaciju**. Cilj mi je da od klasične podrške i administracije " +
    "pređem na poziciju gdje gradim automatizovane sisteme – kao što je moj Help Desk sistem sa integrisanom AI funkcijom (Gemini API) ili lokalna LLM laboratorija sa Ollamom.",
    "My focus is improving IT workflows through **DevOps practices** and **AI automation**. My goal is to move from classic support and administration " +
    "to a role where I build automated systems – like my help desk system with integrated AI (Gemini API) or my local LLM lab with Ollama.",
    "Mein Fokus liegt auf der Optimierung von IT-Abläufen durch **DevOps-Praktiken** und **KI-Automatisierung**. Mein Ziel ist es, vom klassischen Support " +
    "und der Administration in eine Rolle zu wechseln, in der ich automatisierte Systeme aufbaue – wie mein Help-Desk-System mit integrierter KI (Gemini API) oder mein lokales LLM-Labor mit Ollama.");

  A.cv_download = (lang) => L(lang,
    "CV možete preuzeti kao PDF klikom na dugme **⬇️ Preuzmite CV** na stranici **[O meni](/)** – dostupan je na bosanskom, engleskom i njemačkom (prema izabranom jeziku).",
    "You can download my CV as a PDF with the **⬇️ Download CV** button on the **[About Me](/)** page – available in Bosnian, English and German (based on the selected language).",
    "Sie können meinen Lebenslauf als PDF über die Schaltfläche **⬇️ CV herunterladen** auf der Seite **[Über mich](/)** herunterladen – verfügbar auf Bosnisch, Englisch und Deutsch (je nach gewählter Sprache).");

  // Jedina namjerna razlika u odnosu na Python verziju: opis tehnologije sajta
  A.website = (lang) => L(lang,
    "Ovaj sajt sam napravio u **HTML-u, CSS-u i JavaScriptu** i hostam ga besplatno na **GitHub Pages**. Ima tri jezika, kontakt formu sa zaštitom od spama (captcha, limit poruka) " +
    "i ovog chatbota koji radi **potpuno offline** u vašem browseru – vlastiti sistem za prepoznavanje namjera, tolerantan na greške u kucanju, bez vanjskih API-ja.",
    "I built this site with **HTML, CSS and JavaScript** and host it for free on **GitHub Pages**. It has three languages, a contact form with spam protection (captcha, rate limiting) " +
    "and this chatbot, which runs **completely offline** in your browser – a custom intent recognition system, tolerant of typos, with no external APIs.",
    "Diese Seite habe ich mit **HTML, CSS und JavaScript** gebaut und hoste sie kostenlos auf **GitHub Pages**. Sie hat drei Sprachen, ein Kontaktformular mit Spamschutz (Captcha, Nachrichtenlimit) " +
    "und diesen Chatbot, der **komplett offline** in Ihrem Browser läuft – ein eigenes Intent-Erkennungssystem, tolerant gegenüber Tippfehlern, ohne externe APIs.");

  A.help = (lang) => L(lang,
    "Možete me pitati, na primjer:\n\n" +
    "- *Ko si ti?* / *Koliko godina iskustva imaš?*\n- *Gdje trenutno radiš?* / *Šta si radio u Foreo?*\n" +
    "- *Koliko dugo si bio u Payten?* / *Šta si radio 2019?*\n- *Znaš li Docker / Python / Active Directory?*\n" +
    "- *Imaš li iskustva sa mrežama / sigurnošću / bankarstvom?*\n- *Koji su tvoji projekti?*\n" +
    "- *Koje jezike govoriš?* / *Koje je tvoje obrazovanje?*\n- *Zašto bismo te zaposlili?*\n- *Kako te mogu kontaktirati?*",
    "You can ask me, for example:\n\n" +
    "- *Who are you?* / *How many years of experience do you have?*\n- *Where do you work now?* / *What did you do at Foreo?*\n" +
    "- *How long were you at Payten?* / *What did you do in 2019?*\n- *Do you know Docker / Python / Active Directory?*\n" +
    "- *Do you have networking / security / banking experience?*\n- *What are your projects?*\n" +
    "- *Which languages do you speak?* / *What is your education?*\n- *Why should we hire you?*\n- *How can I contact you?*",
    "Sie können mich zum Beispiel fragen:\n\n" +
    "- *Wer bist du?* / *Wie viele Jahre Erfahrung hast du?*\n- *Wo arbeitest du jetzt?* / *Was hast du bei Foreo gemacht?*\n" +
    "- *Wie lange warst du bei Payten?* / *Was hast du 2019 gemacht?*\n- *Kennst du Docker / Python / Active Directory?*\n" +
    "- *Hast du Erfahrung mit Netzwerken / Sicherheit / Banken?*\n- *Welche Projekte hast du?*\n" +
    "- *Welche Sprachen sprichst du?* / *Welche Ausbildung hast du?*\n- *Warum sollten wir dich einstellen?*\n- *Wie kann ich dich kontaktieren?*");

  A.joke = (lang) => pick(L(lang,
    ["Zašto je sistem administrator ostavio djevojku? Imala je previše *bugova* i nije htjela *update*. 😄",
      "Prvo pravilo IT podrške: *Jeste li probali isključiti i ponovo uključiti?* Drugo pravilo: vidi prvo pravilo. 😄",
      "Postoji 10 vrsta ljudi: oni koji razumiju binarni sistem i oni koji ne razumiju. 😄"],
    ["Why do sysadmins never get lost? They always follow the *route*. 😄",
      "First rule of IT support: *Have you tried turning it off and on again?* Second rule: see rule one. 😄",
      "There are 10 types of people: those who understand binary and those who don't. 😄"],
    ["Erste Regel im IT-Support: *Haben Sie es schon aus- und wieder eingeschaltet?* Zweite Regel: siehe erste Regel. 😄",
      "Es gibt 10 Arten von Menschen: die, die Binär verstehen, und die, die es nicht tun. 😄",
      "Warum gehen Admins nie verloren? Sie folgen immer der richtigen *Route*. 😄"]));

  A.insult = (lang) => L(lang,
    "Žao mi je ako odgovor nije bio od pomoći. 🙏 Pokušajte preformulisati pitanje ili napišite *pomoć* da vidite šta sve mogu odgovoriti.",
    "Sorry if my answer wasn't helpful. 🙏 Try rephrasing the question or type *help* to see what I can answer.",
    "Entschuldigung, wenn die Antwort nicht hilfreich war. 🙏 Formulieren Sie die Frage um oder schreiben Sie *Hilfe*, um zu sehen, was ich beantworten kann.");

  A.datetime = (lang) => {
    const d = new Date();
    const t = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
    return L(lang, `Danas je **${t}**. 📅 Mogu li vam pomoći oko nečega iz mog CV-a?`,
      `Today is **${t}**. 📅 Can I help you with anything from my CV?`,
      `Heute ist der **${t}**. 📅 Kann ich Ihnen mit etwas aus meinem Lebenslauf helfen?`);
  };

  function answerYear(year, lang, state) {
    const jobs = JOBS.filter((j) => j.start[0] <= year && year <= (j.end || today())[0]);
    const ed = CV.education;
    if (year >= 2008 && year <= 2012 && !jobs.length) {
      return L(lang, `U ${year}. sam se školovao – **${ed.school[lang]}** (${ed.years}).`,
        `In ${year} I was in school – **${ed.school[lang]}** (${ed.years}).`,
        `${year} war ich in der Schule – **${ed.school[lang]}** (${ed.years}).`);
    }
    if (!jobs.length) {
      return L(lang, `Za ${year}. godinu nemam podataka u CV-u. Moje radno iskustvo počinje 2014. godine.`,
        `I have no CV data for ${year}. My work experience starts in 2014.`,
        `Für ${year} habe ich keine Daten im Lebenslauf. Meine Berufserfahrung beginnt 2014.`);
    }
    if (jobs.length === 1) state.company = jobs[0].id;
    const lines = jobs.map((j) => jobSummary(j, lang, false)).join("\n\n");
    return L(lang, `U ${year}. godini:\n\n${lines}`, `In ${year}:\n\n${lines}`, `Im Jahr ${year}:\n\n${lines}`);
  }

  function answerJob(job, aspect, lang, state) {
    state.company = job.id;
    state.aspect = aspect;
    const company = companyLabel(job, lang);
    const period = formatPeriod(job, lang);
    const current = job.end === null;
    if (aspect === "duration") {
      const duration = formatDuration(jobMonths(job), lang);
      return L(lang,
        `U **${company}** ${current ? "radim već" : "sam radio"} **${duration}** (${period}).`,
        `I ${current ? "have been working" : "worked"} at **${company}** for **${duration}** (${period}).`,
        `Bei **${company}** ${current ? "arbeite ich seit" : "habe ich"} **${duration}** ${current ? "" : "gearbeitet "}(${period}).`.split("  ").join(" "));
    }
    if (aspect === "when") {
      return L(lang, `U **${company}** ${current ? "radim od" : "sam radio u periodu"}: **${period}**.`,
        `I ${current ? "have worked" : "worked"} at **${company}** during: **${period}**.`,
        `Bei **${company}** ${current ? "arbeite ich seit" : "war ich im Zeitraum"}: **${period}**.`);
    }
    if (aspect === "role") {
      const role = jobRole(job, lang);
      return L(lang, `U **${company}** ${current ? "radim" : "sam radio"} kao **${role}** (${period}). Sektor: ${tr(job.sector, lang)}.`,
        `At **${company}** I ${current ? "work" : "worked"} as **${role}** (${period}). Sector: ${tr(job.sector, lang)}.`,
        `Bei **${company}** ${current ? "arbeite" : "arbeitete"} ich als **${role}** (${period}). Branche: ${tr(job.sector, lang)}.`);
    }
    if (aspect === "website") {
      if (job.url) return L(lang, `Web stranica firme **${company}**: ${job.url}`, `Website of **${company}**: ${job.url}`, `Webseite von **${company}**: ${job.url}`);
      return L(lang, `Za **${company}** nemam objavljen link.`, `I don't have a published link for **${company}**.`, `Für **${company}** habe ich keinen veröffentlichten Link.`);
    }
    if (aspect === "tech") {
      const found = KNOWLEDGE.filter((item) => findEvidence(item, 20).some(([j]) => j.id === job.id)).map((item) => knowledgeName(item, lang));
      if (found.length) {
        const list = found.join(", ");
        return L(lang, `U **${company}** sam radio sa: **${list}**.\n\n`, `At **${company}** I worked with: **${list}**.\n\n`,
          `Bei **${company}** habe ich gearbeitet mit: **${list}**.\n\n`) + jobSummary(job, lang);
      }
    }
    if (aspect === "why_left") {
      if (current) return L(lang, `U **${company}** još uvijek radim.`, `I'm still working at **${company}**.`, `Ich arbeite noch bei **${company}**.`);
      return L(lang,
        `Iz **${company}** sam otišao radi daljeg **ličnog i profesionalnog razvoja** – želio sam novo okruženje u kojem mogu još više učiti ` +
        `i graditi sebe. Iskustvo koje sam stekao u **${company}** (${period}) i danas mi je vrijedan temelj.`,
        `I left **${company}** for further **personal and professional growth** – I wanted a new environment where I could keep learning ` +
        `and building myself. The experience I gained at **${company}** (${period}) is still a valuable foundation for me.`,
        `Ich habe **${company}** für meine weitere **persönliche und berufliche Entwicklung** verlassen – ich wollte ein neues Umfeld, in dem ich ` +
        `weiter lernen und mich weiterentwickeln kann. Die Erfahrung bei **${company}** (${period}) ist bis heute eine wertvolle Grundlage.`);
    }
    return jobSummary(job, lang);
  }

  // =========================================================================
  // 8. PRETRAGA CIJELOG CV-a
  // =========================================================================

  const DOCUMENTS = [];
  for (const job of JOBS) job.duties.en.forEach((_, i) => DOCUMENTS.push([Object.fromEntries(LANGS.map((lg) => [lg, job.duties[lg][i]])), ["job", job.id]]));
  for (const p of CV.projects) DOCUMENTS.push([Object.fromEntries(LANGS.map((lg) => [lg, `${tr(p.name, lg)}: ${p.description[lg]}`])), ["project", p.id]]);
  for (const c of CV.skillCategories) DOCUMENTS.push([Object.fromEntries(LANGS.map((lg) => [lg, skillCategoryLine(c, lg)])), ["skills", c.id]]);
  DOCUMENTS.push([Object.fromEntries(LANGS.map((lg) => [lg, CV.personal.description[lg]])), ["about", null]]);
  DOCUMENTS.push([Object.fromEntries(LANGS.map((lg) => [lg, educationLines(lg).join(" ")])), ["education", null]]);
  const DOC_TOKENS = DOCUMENTS.map(([texts]) => {
    const all = new Set();
    for (const lg of LANGS) for (const t of tokenize(normalize(texts[lg]))) if (!STOPWORDS.has(t)) all.add(t);
    return [...all];
  });

  function searchCV(tokens, limit = 4) {
    const query = tokens.filter((t) => !STOPWORDS.has(t) && (t.length >= 3 || /^\d+$/.test(t)));
    if (!query.length) return [];
    const nDocs = DOCUMENTS.length;
    const docFreq = new Map(query.map((q) => [q, DOC_TOKENS.filter((d) => d.some((t) => tokenMatch(q, t))).length]));
    const scored = [];
    DOC_TOKENS.forEach((doc, i) => {
      let score = 0;
      for (const q of query) {
        if (docFreq.get(q) && doc.some((t) => tokenMatch(q, t))) score += 1.0 + Math.pow(nDocs / docFreq.get(q), 0.5) / 3;
      }
      if (score) scored.push([score, i]);
    });
    scored.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    if (!scored.length || scored[0][0] < 1.8) return [];
    const best = scored[0][0];
    return scored.slice(0, limit).filter(([s]) => s >= best * 0.6).map(([, i]) => i);
  }

  function answerSearch(indices, lang, state) {
    const lines = indices.map((i) => {
      const [texts, [kind, ref]] = DOCUMENTS[i];
      if (kind === "job") {
        const job = JOBS_BY_ID[ref];
        state.company = ref;
        return `- **${companyLabel(job, lang)}** (${formatPeriod(job, lang)}): ${texts[lang]}`;
      }
      return `- ${texts[lang]}`;
    });
    return L(lang, "Evo šta sam pronašao u svom CV-u o tome:\n\n", "Here's what I found in my CV about that:\n\n",
      "Folgendes habe ich dazu in meinem Lebenslauf gefunden:\n\n") + lines.join("\n");
  }

  const answerFallback = (lang) => L(lang,
    "Hmm, na to pitanje nemam odgovor u svom CV-u. 🤔 Mogu vam reći o mom **radnom iskustvu**, **vještinama**, **projektima**, " +
    "**edukaciji**, **jezicima** ili kako me **kontaktirati**. Napišite *pomoć* za primjere pitanja.\n\n" + contactHint(lang),
    "Hmm, I don't have an answer to that in my CV. 🤔 I can tell you about my **work experience**, **skills**, **projects**, " +
    "**education**, **languages** or how to **contact** me. Type *help* for example questions.\n\n" + contactHint(lang),
    "Hmm, darauf habe ich in meinem Lebenslauf keine Antwort. 🤔 Ich kann Ihnen etwas über meine **Berufserfahrung**, **Fähigkeiten**, **Projekte**, " +
    "**Ausbildung**, **Sprachen** oder **Kontaktmöglichkeiten** erzählen. Schreiben Sie *Hilfe* für Beispielfragen.\n\n" + contactHint(lang));

  const CATEGORY_INTENTS = { programming: "programming", ai_cat: "ai", devops_cat: "devops", virt_cat: "virtualization", sysadmin_cat: "sysadmin", tools_cat: "tools" };
  const COMBINABLE = new Set(["skills", "languages", "education", "projects", "contact", "location", "soft_skills", "courses", "experience",
    "total_years", "current", "salary", "availability", "goals", "strengths", "hobbies"]);
  const SOCIAL_INTENTS = new Set(["greeting", "farewell", "thanks", "how_are_you"]);
  const PRIORITY = new Set(["relocation", "contact", "salary", "availability", "languages", "education", "location", "phone",
    "website", "bot", "job_search", "goals", "strengths", "cv_download"]);
  const UNI_PREFIXES = ["fakultet", "univerz", "universit", "studij", "studir", "studium", "degree", "bachelor", "master", "uni"];

  // =========================================================================
  // 9. GLAVNA FUNKCIJA
  // =========================================================================

  const MAX_INPUT_LENGTH = 500;

  function respond(text, uiLanguage = "English", state = {}) {
    text = (text || "").trim().slice(0, MAX_INPUT_LENGTH);

    const fallbackLang = state.lang || langCode(uiLanguage);
    let [lang, confidence] = detectLanguage(text, fallbackLang);
    if (confidence === 0) lang = fallbackLang;
    state.lang = lang;

    const tokens = tokenize(normalize(text));
    if (!tokens.length) return A.help(lang, state);

    const intents = INTENT_MATCHER.match(tokens);
    const aspects = ASPECT_MATCHER.match(tokens);
    const companies = COMPANY_MATCHER.match(tokens);
    const knowledge = KNOWLEDGE_MATCHER.match(tokens);
    const projects = PROJECT_MATCHER.match(tokens);
    const unlisted = tokens.filter((t) => Object.prototype.hasOwnProperty.call(UNLISTED_TECH, t)).map((t) => UNLISTED_TECH[t]);
    const years = tokens.filter((t) => /^\d+$/.test(t) && +t >= 2000 && +t <= 2035).map(Number);

    const companyIds = sortedKeysDesc(companies);

    let greetingPrefix = "";
    const contentIntents = new Map([...intents].filter(([k]) => !SOCIAL_INTENTS.has(k)));
    const hasContent = Boolean(contentIntents.size || companyIds.length || knowledge.size || projects.size || unlisted.length || years.length);
    const social = [...intents.keys()].filter((k) => SOCIAL_INTENTS.has(k));
    if (social.length && !hasContent) {
      const topSocial = maxKey(new Map(social.map((k) => [k, intents.get(k)])));
      return A[topSocial](lang, state);
    }
    if (intents.has("greeting") && hasContent) greetingPrefix = L(lang, "Zdravo! 👋 ", "Hello! 👋 ", "Hallo! 👋 ");

    const finish = (answer, intent = null) => { state.intent = intent; return greetingPrefix + answer; };

    const topAspect = aspects.size ? maxKey(aspects) : null;
    const isFollowUp = tokens.length <= 5 && (FOLLOW_UP_SET.has(tokens[0]) || aspects.size > 0);

    // 1. Pitanje o konkretnoj firmi
    if (companyIds.length && !((contentIntents.get("experience") || 0) >= 3 && companyIds.length > 2)) {
      const answers = companyIds.slice(0, 3).map((cid) => {
        let aspect = topAspect;
        if (aspect === null && tokens.length <= 4 && state.aspect) aspect = state.aspect;
        return answerJob(JOBS_BY_ID[cid], aspect, lang, state);
      });
      return finish(answers.join("\n\n---\n\n"), "job");
    }

    // 2. Pitanje o godini
    if (years.length && !knowledge.size) return finish(years.slice(0, 2).map((y) => answerYear(y, lang, state)).join("\n\n"), "year");

    // 3. Nastavak razgovora o firmi
    const strongIntent = contentIntents.size ? maxValue(contentIntents) : 0;
    if (state.company && topAspect && strongIntent < 1.5 && !knowledge.size && !projects.size) {
      return finish(answerJob(JOBS_BY_ID[state.company], topAspect, lang, state), "job");
    }

    // 4. Konkretan projekat
    if (projects.size && (maxValue(projects) >= 2 || intents.has("projects"))) {
      return finish(answerProject(PROJECTS_BY_ID[maxKey(projects)], lang, state), "project");
    }

    // 5. Tehnologije koje nisu na CV-u
    if (unlisted.length && !knowledge.size) {
      return finish(unlisted.slice(0, 2).map(([name, rel]) => answerUnlisted(name, rel, lang)).join("\n\n"), "unlisted");
    }

    // 6. Kategorija vještina
    const categoryHits = new Map();
    for (const [k, v] of intents) if (CATEGORY_INTENTS[k]) categoryHits.set(CATEGORY_INTENTS[k], v);
    if (categoryHits.size && maxValue(categoryHits) >= 1.5 && !(knowledge.size && maxValue(knowledge) >= 1)) {
      const bestCategory = maxKey(categoryHits);
      if (bestCategory !== "sysadmin" || intents.has("skills") || maxValue(categoryHits) >= 2) {
        return finish(answerSkillCategory(bestCategory, lang), "category");
      }
    }

    // 7. Konkretna vještina ili oblast
    if (knowledge.size) {
      const topIntent = contentIntents.size ? maxKey(contentIntents) : null;
      if (!(PRIORITY.has(topIntent) && contentIntents.get(topIntent) >= maxValue(knowledge) + 1)) {
        const items = sortedKeysDesc(knowledge).slice(0, 3);
        let answer = items.map((i) => answerKnowledge(KNOWLEDGE_BY_ID[i], lang, state, tokens)).join("\n\n---\n\n");
        if (unlisted.length) answer += "\n\n---\n\n" + unlisted.slice(0, 2).map(([name, rel]) => answerUnlisted(name, rel, lang)).join("\n\n");
        return finish(answer, "knowledge");
      }
    }

    // 8. Opšte namjere
    if (contentIntents.size) {
      const ranked = [...contentIntents.entries()].sort((a, b) => b[1] - a[1]);
      const [top, topScore] = ranked[0];

      if (CATEGORY_INTENTS[top]) return finish(answerSkillCategory(CATEGORY_INTENTS[top], lang), "category");
      if (top === "education") {
        const asksUni = tokens.some((t) => UNI_PREFIXES.some((p) => t.startsWith(p)));
        if (contentIntents.has("courses") && contentIntents.get("courses") >= topScore) return finish(A.courses(lang, state), "courses");
        return finish(answerEducation(lang, asksUni), "education");
      }
      if (contentIntents.has("previous") && state.company) return finish(A.previous(lang, state), "previous");
      if (top === "experience" && contentIntents.has("total_years")) return finish(A.total_years(lang, state), "total_years");
      if (top === "age" && (contentIntents.has("experience") || contentIntents.has("total_years"))) return finish(A.total_years(lang, state), "total_years");
      if ((top === "location" || top === "current") && contentIntents.get("current") && contentIntents.has("experience")) return finish(A.current(lang, state), "current");

      if (topScore >= 0.5) {
        let answer = A[top](lang, state);
        if (ranked.length > 1 && COMBINABLE.has(top)) {
          const [second, secondScore] = ranked[1];
          const pair = [top, second].sort().join("|");
          if (COMBINABLE.has(second) && secondScore >= 1.5 && secondScore >= topScore * 0.7 &&
            pair !== "experience|total_years" && pair !== "current|experience") {
            answer += "\n\n---\n\n" + A[second](lang, state);
          }
        }
        return finish(answer, top);
      }
    }

    // 9. Nastavak bez jasne teme
    if (isFollowUp && state.company) return finish(answerJob(JOBS_BY_ID[state.company], topAspect, lang, state), "job");
    if (isFollowUp && KNOWLEDGE_BY_ID[state.topic]) return finish(answerKnowledge(KNOWLEDGE_BY_ID[state.topic], lang, state), "knowledge");

    // 10. Pretraga cijelog CV-a
    const hits = searchCV(tokens);
    if (hits.length) return finish(answerSearch(hits, lang, state), "search");

    return finish(answerFallback(lang), "fallback");
  }

  function greetingMessage(uiLanguage) {
    return L(langCode(uiLanguage),
      "Zdravo! Ja sam Amarov virtualni asistent. Kako vam mogu pomoći? Možete me pitati o mom iskustvu, vještinama ili projektima.",
      "Hello! I am Amar's virtual assistant. How can I help you today? You can ask me about my experience, skills, or projects.",
      "Hallo! Ich bin Amars virtueller Assistent. Wie kann ich Ihnen heute helfen? Sie können mich nach meiner Erfahrung, meinen Fähigkeiten oder Projekten fragen.");
  }

  global.Chatbot = { respond, greetingMessage };
  global.CVHelpers = { tr, langCode, formatPeriod, skillCategoryLine, projectLine, educationLines, jobRole };
})(window);
