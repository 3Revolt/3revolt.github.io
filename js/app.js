// --- APLIKACIJA: navigacija, jezici, stranice, chat i kontakt forma ---
(function () {
  "use strict";

  const CV = window.CV_DATA;
  const { tr, langCode, formatPeriod, skillCategoryLine, projectLine, educationLines } = window.CVHelpers;
  const CONFIG = window.SITE_CONFIG || {};
  const LANGUAGE_OPTIONS = ["Bosanski", "English", "Deutsch"];
  const DEFAULT_LANGUAGE = "Bosanski";

  // =========================================================================
  // Pomoćne funkcije
  // =========================================================================

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const storage = {
    get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* privatni prozor i sl. */ } },
  };
  const session = {
    get(key, fallback = null) { try { const v = sessionStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignorisati */ } },
  };

  // Mali markdown renderer (podskup koji koristi Streamlit verzija: pasusi, liste, **bold**, *italic*, linkovi, ---)
  function inlineMd(text) {
    let s = esc(text);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => `<a href="${mapHref(href)}"${isExternal(href) ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>");
    return s;
  }
  const isExternal = (href) => /^https?:\/\//.test(href);
  // Linkovi iz chatbota ("/#contact-me", "/") vode na stranice ovog sajta
  function mapHref(href) {
    if (href === "/#contact-me") return "#/contact";
    if (href === "/") return "#/";
    return href;
  }

  function renderMarkdown(text) {
    const blocks = String(text).split(/\n{2,}/);
    const out = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.length === 1 && /^-{3,}\s*$/.test(lines[0])) { out.push("<hr>"); continue; }
      let para = [];
      let list = [];
      const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join(" ")}</p>`); para = []; } };
      const flushList = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inlineMd(l)}</li>`).join("")}</ul>`); list = []; } };
      for (const line of lines) {
        const m = line.match(/^\s*[-*]\s+(.*)$/);
        if (m) { flushPara(); list.push(m[1]); }
        else if (list.length && /^\s+\S/.test(line)) list[list.length - 1] += " " + line.trim();
        else { flushList(); if (line.trim()) para.push(line.trim()); }
      }
      flushPara();
      flushList();
    }
    return out.join("");
  }

  // =========================================================================
  // Prevodi (isti tekstovi kao u Streamlit verziji)
  // =========================================================================

  const T = {
    Bosanski: {
      page_about: "O meni", page_experience: "Iskustvo", select_page: "O MENI", experience_title: "Radno iskustvo",
      contact_me: "✉️ Kontaktirajte me", download_cv: "⬇️ Preuzmite CV",
      Skills: "Tehničke vještine", Education: "Edukacija", Projects: "Ključni projekti", Languages: "Jezici",
      your_name: "Vaše Ime", your_email: "Vaš Email", your_message: "Vaša Poruka", send: "Pošaljite",
      error_email: "Molimo unesite važeću email adresu.", error_fields: "Molimo popunite sva polja.",
      error_length: "Ime može imati najviše 100 znakova, a poruka najviše 3000 znakova.",
      error_links_in_name: "Ime ne smije sadržavati linkove.",
      error_too_fast: "Forma je poslana prebrzo. Sačekajte trenutak i pokušajte ponovo.",
      sending: "Šaljem vašu poruku🚀...", success_message: "Poruka je uspješno poslana!",
      error_message: "Došlo je do greške prilikom slanja poruke. Pokušajte kasnije ili pišite direktno na",
      form_disabled: "Kontakt forma je trenutno onemogućena (nije podešen email server). Možete pisati direktno na",
      security_check: "Sigurnosna provjera", turnstile_wait: "Sačekajte da se sigurnosna provjera završi, pa pokušajte ponovo.",
      turnstile_error: "Sigurnosna provjera nije uspjela. Osvježite stranicu i pokušajte ponovo.",
      global_limit_error: "Kontakt forma je trenutno opterećena. Pokušajte ponovo za {wait}.",
      rate_limit_error: "Dostigli ste dnevni limit poruka. Pokušajte ponovo za {wait}.",
      cooldown_error: "Sačekajte {wait} prije slanja sljedeće poruke.",
      email_limit_error: "Previše poruka sa ove email adrese danas. Pokušajte ponovo za {wait}.",
      duplicate_error: "Ova poruka je već poslana. Hvala!",
      chat_intro: "Pitajte me bilo šta o Amarovom iskustvu, vještinama ili obrazovanju.",
      chat_placeholder: "Upišite pitanje...", chat_thinking: "Razmišljam...",
      menu_open: "Otvori meni", menu_close: "Zatvori meni",
    },
    English: {
      page_about: "About Me", page_experience: "Experience", select_page: "ABOUT ME", experience_title: "Experience",
      contact_me: "✉️ Contact Me", download_cv: "⬇️ Download CV",
      Skills: "Technical Skills", Education: "Education", Projects: "Key Projects", Languages: "Languages",
      your_name: "Your Name", your_email: "Your Email", your_message: "Your Message", send: "Send",
      error_email: "Please enter a valid email address.", error_fields: "Please fill in all fields.",
      error_length: "The name may have at most 100 characters and the message at most 3000 characters.",
      error_links_in_name: "The name must not contain links.",
      error_too_fast: "The form was submitted too quickly. Please wait a moment and try again.",
      sending: "Sending your message...", success_message: "Message sent successfully!",
      error_message: "An error occurred while sending the message. Please try again later or write directly to",
      form_disabled: "The contact form is currently disabled (email server is not configured). You can write directly to",
      security_check: "Security Check", turnstile_wait: "Please wait for the security check to finish, then try again.",
      turnstile_error: "The security check failed. Please refresh the page and try again.",
      global_limit_error: "The contact form is temporarily busy. Please try again in {wait}.",
      rate_limit_error: "You have reached the daily message limit. Please try again in {wait}.",
      cooldown_error: "Please wait {wait} before sending another message.",
      email_limit_error: "Too many messages from this email address today. Please try again in {wait}.",
      duplicate_error: "This message has already been sent. Thank you!",
      chat_intro: "Ask me anything about Amar's experience, skills, or background.",
      chat_placeholder: "Type your question here...", chat_thinking: "Thinking...",
      menu_open: "Open menu", menu_close: "Close menu",
    },
    Deutsch: {
      page_about: "Über mich", page_experience: "Erfahrung", select_page: "ÜBER MICH", experience_title: "Arbeitserfahrung",
      contact_me: "✉️ Kontaktieren Sie mich", download_cv: "⬇️ CV herunterladen",
      Skills: "Technische Fähigkeiten", Education: "Die Ausbildung", Projects: "Wichtige Projekte", Languages: "Sprache",
      your_name: "Ihr Name", your_email: "Ihre E-Mail", your_message: "Ihre Nachricht", send: "Senden",
      error_email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.", error_fields: "Bitte füllen Sie alle Felder aus.",
      error_length: "Der Name darf höchstens 100 Zeichen und die Nachricht höchstens 3000 Zeichen haben.",
      error_links_in_name: "Der Name darf keine Links enthalten.",
      error_too_fast: "Das Formular wurde zu schnell gesendet. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
      sending: "Ihre Nachricht wird gesendet...", success_message: "Nachricht erfolgreich gesendet!",
      error_message: "Beim Senden der Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut oder schreiben Sie direkt an",
      form_disabled: "Das Kontaktformular ist derzeit deaktiviert (kein E-Mail-Server konfiguriert). Sie können direkt schreiben an",
      security_check: "Sicherheitsüberprüfung", turnstile_wait: "Bitte warten Sie, bis die Sicherheitsüberprüfung abgeschlossen ist, und versuchen Sie es erneut.",
      turnstile_error: "Die Sicherheitsüberprüfung ist fehlgeschlagen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
      global_limit_error: "Das Kontaktformular ist vorübergehend ausgelastet. Bitte versuchen Sie es in {wait} erneut.",
      rate_limit_error: "Sie haben das tägliche Nachrichtenlimit erreicht. Bitte versuchen Sie es in {wait} erneut.",
      cooldown_error: "Bitte warten Sie {wait}, bevor Sie eine weitere Nachricht senden.",
      email_limit_error: "Zu viele Nachrichten von dieser E-Mail-Adresse heute. Bitte versuchen Sie es in {wait} erneut.",
      duplicate_error: "Diese Nachricht wurde bereits gesendet. Vielen Dank!",
      chat_intro: "Fragen Sie mich alles über Amars Erfahrung, Fähigkeiten oder Werdegang.",
      chat_placeholder: "Geben Sie Ihre Frage ein...", chat_thinking: "Denke nach...",
      menu_open: "Menü öffnen", menu_close: "Menü schließen",
    },
  };

  const CV_FILES = { Bosanski: "assets/CVbos.pdf", English: "assets/CVeng.pdf", Deutsch: "assets/CVde.pdf" };
  const HTML_LANG = { Bosanski: "bs", English: "en", Deutsch: "de" };

  let language = storage.get("language", DEFAULT_LANGUAGE);
  if (!LANGUAGE_OPTIONS.includes(language)) language = DEFAULT_LANGUAGE;
  const t = (key) => T[language][key];
  const lc = () => langCode(language);

  // =========================================================================
  // Sidebar: navigacija, padajući meni za jezik, otvaranje/zatvaranje
  // =========================================================================

  const sidebar = $("#sidebar");
  const select = $("#langSelect");
  const selectBox = $(".select-box", select);
  const selectMenu = $(".select-menu", select);
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  function renderSidebarTexts() {
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $(".select-value", select).textContent = language;
    selectMenu.innerHTML = LANGUAGE_OPTIONS.map((l) => `<li role="option" data-value="${l}" aria-selected="${l === language}">${l}</li>`).join("");
    $("#sbCollapse").setAttribute("aria-label", t("menu_close"));
    $("#sbExpand").setAttribute("aria-label", t("menu_open"));
    document.documentElement.lang = HTML_LANG[language];
  }

  let focusedOption = -1;
  function openSelect(open) {
    select.classList.toggle("open", open);
    selectMenu.hidden = !open;
    selectBox.setAttribute("aria-expanded", String(open));
    focusedOption = open ? LANGUAGE_OPTIONS.indexOf(language) : -1;
    highlightOption();
  }
  function highlightOption() {
    [...selectMenu.children].forEach((li, i) => li.classList.toggle("focused", i === focusedOption));
  }
  selectBox.addEventListener("click", () => openSelect(selectMenu.hidden));
  selectBox.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      if (selectMenu.hidden) openSelect(true);
      focusedOption = (focusedOption + (e.key === "ArrowDown" ? 1 : -1) + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
      highlightOption();
    } else if (e.key === "Enter" && !selectMenu.hidden && focusedOption >= 0) {
      e.preventDefault();
      setLanguage(LANGUAGE_OPTIONS[focusedOption]);
      openSelect(false);
    } else if (e.key === "Escape") openSelect(false);
  });
  selectMenu.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) { setLanguage(li.dataset.value); openSelect(false); selectBox.focus(); }
  });
  document.addEventListener("click", (e) => { if (!select.contains(e.target)) openSelect(false); });

  function setLanguage(value) {
    if (value === language) return;
    language = value;
    storage.set("language", value);
    renderSidebarTexts();
    renderPage();
  }

  function setSidebar(open) {
    if (isMobile()) {
      document.body.classList.toggle("sidebar-open", open);
    } else {
      document.body.classList.toggle("sidebar-collapsed", !open);
      storage.set("sidebarCollapsed", !open);
    }
  }
  $("#sbCollapse").addEventListener("click", () => setSidebar(false));
  $("#sbExpand").addEventListener("click", () => setSidebar(true));
  $("#sbBackdrop").addEventListener("click", () => setSidebar(false));
  if (!isMobile() && storage.get("sidebarCollapsed", false)) document.body.classList.add("sidebar-collapsed");
  sidebar.addEventListener("click", (e) => { if (e.target.closest(".sb-link") && isMobile()) setSidebar(false); });

  // =========================================================================
  // Navigacija (hash rute: #/ , #/experience , #/chatbot , #/contact)
  // =========================================================================

  const page = $("#page");
  const bottom = $("#bottom");
  const main = $("#main");

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    if (hash.startsWith("experience")) return "experience";
    if (hash.startsWith("chatbot")) return "chatbot";
    if (hash.startsWith("contact")) return "contact";
    return "about";
  }

  function renderPage() {
    const route = currentRoute();
    const pageName = route === "contact" ? "about" : route;
    document.body.classList.remove("page-about", "page-experience", "page-chatbot");
    document.body.classList.add(`page-${pageName}`);
    document.querySelectorAll(".sb-link").forEach((a) => a.classList.toggle("active", a.dataset.route === pageName));
    const titles = { about: t("page_about"), experience: t("page_experience"), chatbot: "Chat Bot" };
    document.title = `${titles[pageName]} – ${CV.personal.name}`;

    bottom.hidden = pageName !== "chatbot";
    if (pageName === "about") renderAbout();
    else if (pageName === "experience") renderExperience();
    else renderChat();

    if (route === "contact") {
      requestAnimationFrame(() => { const el = $("#contact-me"); if (el) el.scrollIntoView({ behavior: "smooth" }); });
    }
  }

  let lastRoute = null;
  window.addEventListener("hashchange", () => {
    const route = currentRoute();
    renderPage();
    if (route !== "contact" && route !== lastRoute) main.scrollTop = 0;
    lastRoute = route;
  });

  // =========================================================================
  // Stranica: O meni
  // =========================================================================

  function renderAbout() {
    const lang = lc();
    const p = CV.personal;
    page.innerHTML = `
      <div class="heading md"><h2>${esc(t("select_page"))}</h2></div>
      <div class="columns center">
        <div class="col col-1"><img src="assets/cv.gif" alt="${esc(p.name)}" width="800" height="600"></div>
        <div class="col col-1">
          <div class="heading"><h1>${esc(p.name)}</h1></div>
          <div class="heading"><h3>${esc(p.role[lang])}</h3></div>
          <div class="md"><p>${esc(p.description[lang])}</p></div>
          <div class="md"><p><button class="html-btn" type="button" data-scroll-contact>${esc(t("contact_me"))}</button></p></div>
          <div><a class="st-btn" href="${CV_FILES[language]}" download="CV_${language}.pdf">${esc(t("download_cv"))}</a></div>
        </div>
      </div>
      <div class="spacer"></div>
      <div class="heading"><h3>${esc(t("Skills"))}</h3></div>
      <div class="md"><p>${CV.skillCategories.map((c) => inlineMd(skillCategoryLine(c, lang))).join(" ")}</p></div>
      <div class="spacer"></div>
      <div class="heading"><h3>${esc(t("Projects"))}</h3></div>
      <div class="md"><p>${CV.projects.map((pr) => inlineMd(projectLine(pr, lang))).join(" ")}</p></div>
      <div class="spacer"></div>
      <div class="heading"><h3>${esc(t("Education"))}</h3></div>
      <div class="md"><p>${educationLines(lang).map(esc).join(" ")}</p></div>
      <div class="spacer"></div>
      <div class="heading"><h3>${esc(t("Languages"))}</h3></div>
      <div class="md"><p>${CV.languages.map((l) => esc(`● ${l.label[lang]}`)).join(" ")}</p></div>
      <div class="spacer"></div>
      <div class="heading"><h3 id="contact-me">${esc(t("contact_me"))}</h3></div>
      <div id="contactForm" style="display:contents"></div>
    `;
    $("[data-scroll-contact]", page).addEventListener("click", () => $("#contact-me").scrollIntoView({ behavior: "smooth" }));
    renderContactForm($("#contactForm"));
  }

  // =========================================================================
  // Kontakt forma: Google Apps Script server + Cloudflare Turnstile
  // =========================================================================
  // Prava zaštita (Turnstile provjera, limiti po email adresi, duplikati, globalni limit)
  // radi na serveru (apps-script/Code.gs). Provjere ovdje služe samo za brzu povratnu informaciju.

  const MAX_NAME_LENGTH = 100;
  const MAX_MESSAGE_LENGTH = 3000;
  const MIN_FILL_SECONDS = 3;
  const RULES = { cooldown: 60, perDay: 5, day: 86400 };

  const formState = { name: "", email: "", message: "", loadedAt: null, notice: null };

  function formatWait(seconds) {
    seconds = Math.max(1, Math.ceil(seconds));
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
    const h = Math.ceil(seconds / 3600);
    return language === "Deutsch" ? `${h} Std.` : `${h} h`;
  }

  // Pauza i dnevni limit u browseru (server ima svoje, strože limite)
  function sentTimes() {
    const now = Date.now() / 1000;
    return (storage.get("contactSent", []) || []).filter((x) => now - x < RULES.day);
  }
  function checkLocalLimits() {
    const now = Date.now() / 1000;
    const sent = sentTimes();
    if (sent.length && now - Math.max(...sent) < RULES.cooldown) return ["cooldown_error", RULES.cooldown - (now - Math.max(...sent))];
    if (sent.length >= RULES.perDay) return ["rate_limit_error", Math.min(...sent) + RULES.day - now];
    return [null, 0];
  }
  const recordSent = () => storage.set("contactSent", [...sentTimes(), Date.now() / 1000]);

  const isValidEmail = (email) => /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email) && email.length <= 254;

  // Cloudflare Turnstile se učitava tek kad se prikaže forma
  let turnstileLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
      turnstileLoading = new Promise((resolve, reject) => {
        window.onTurnstileLoad = () => resolve(window.turnstile);
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
        script.async = true;
        script.onerror = () => { turnstileLoading = null; reject(new Error("Turnstile se nije učitao")); };
        document.head.appendChild(script);
      });
    }
    return turnstileLoading;
  }

  function renderContactForm(container) {
    if (!CONFIG.contactEndpoint || !CONFIG.turnstileSiteKey) {
      container.innerHTML = `<div class="alert alert-info"><p>${esc(t("form_disabled"))} <strong>${esc(CV.personal.email)}</strong>.</p></div>`;
      return;
    }
    if (!formState.loadedAt) formState.loadedAt = Date.now(); // mjeri se od prvog prikaza forme
    container.innerHTML = `
      <div class="widget"><label class="widget-label" for="cfName">${esc(t("your_name"))}</label>
        <div class="text-field"><input id="cfName" type="text" autocomplete="name" maxlength="200"></div></div>
      <div class="widget"><label class="widget-label" for="cfEmail">${esc(t("your_email"))}</label>
        <div class="text-field"><input id="cfEmail" type="email" autocomplete="email" maxlength="254"></div></div>
      <div class="widget"><label class="widget-label" for="cfMessage">${esc(t("your_message"))}</label>
        <div class="text-field"><textarea id="cfMessage"></textarea></div></div>
      <div class="honeypot" aria-hidden="true"><label>Website<input id="cfWebsite" type="text" tabindex="-1" autocomplete="off"></label></div>
      <div class="widget"><span class="widget-label">${esc(t("security_check"))}</span><div class="turnstile-box" id="cfTurnstile"></div></div>
      <div><button class="st-btn" type="button" id="cfSend">${esc(t("send"))}</button></div>
      <div id="cfNotice" style="display:contents"></div>
    `;
    const name = $("#cfName", container), email = $("#cfEmail", container), message = $("#cfMessage", container);
    const sendBtn = $("#cfSend", container), notice = $("#cfNotice", container);
    name.value = formState.name; email.value = formState.email; message.value = formState.message;
    name.addEventListener("input", () => { formState.name = name.value; });
    email.addEventListener("input", () => { formState.email = email.value; });
    message.addEventListener("input", () => { formState.message = message.value; });

    const show = (kind, html) => { formState.notice = kind ? { kind, html } : null; notice.innerHTML = kind ? `<div class="alert alert-${kind}"><p>${html}</p></div>` : ""; };
    if (formState.notice) show(formState.notice.kind, formState.notice.html);

    // Turnstile widget
    let token = "";
    let widgetId = null;
    const resetTurnstile = () => { token = ""; if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); };
    loadTurnstile().then((ts) => {
      const box = $("#cfTurnstile", container);
      if (!box || !document.body.contains(box)) return;
      widgetId = ts.render(box, {
        sitekey: CONFIG.turnstileSiteKey,
        theme: "dark",
        size: "flexible",
        language: { Bosanski: "hr", English: "en", Deutsch: "de" }[language],
        action: "contact",
        callback: (value) => { token = value; },
        "expired-callback": () => { token = ""; },
        "error-callback": () => { token = ""; },
      });
    }).catch(() => show("error", esc(t("turnstile_error"))));

    sendBtn.addEventListener("click", async () => {
      const n = name.value.trim(), e = email.value.trim(), m = message.value.trim();
      show(null);

      // 0. Bot provjere (bot dobija lažni "uspjeh")
      if ($("#cfWebsite", container).value) { show("success", esc(t("success_message"))); return; }
      if ((Date.now() - formState.loadedAt) / 1000 < MIN_FILL_SECONDS) { show("error", esc(t("error_too_fast"))); return; }

      // 1. Validacija
      if (!n || !e || !m) { show("error", esc(t("error_fields"))); return; }
      if (n.length > MAX_NAME_LENGTH || m.length > MAX_MESSAGE_LENGTH) { show("error", esc(t("error_length"))); return; }
      if (/https?:\/\/|www\./i.test(n)) { show("error", esc(t("error_links_in_name"))); return; }
      if (!isValidEmail(e)) { show("error", esc(t("error_email"))); return; }

      // 2. Sigurnosna provjera (Turnstile)
      if (!token) { show("error", esc(t("turnstile_wait"))); return; }

      // 3. Pauza i dnevni limit
      const [limitKey, wait] = checkLocalLimits();
      if (limitKey) { show("error", esc(t(limitKey).replace("{wait}", formatWait(wait)))); return; }

      // 4. Slanje na server
      sendBtn.disabled = true;
      notice.innerHTML = `<div class="spinner-row"><div class="spinner"></div><span>${esc(t("sending"))}</span></div>`;
      try {
        const response = await fetch(CONFIG.contactEndpoint, {
          method: "POST",
          // text/plain = "jednostavan" zahtjev, Google Apps Script ga prima bez dodatnog CORS koraka
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ name: n, email: e, message: m, language, token, website: "" }),
        });
        const result = await response.json().catch(() => ({ success: false, code: "server" }));
        if (!result.success) {
          const key = {
            invalid: "error_fields", turnstile: "turnstile_error", email_limit: "email_limit_error",
            duplicate: "duplicate_error", global_limit: "global_limit_error",
          }[result.code];
          resetTurnstile();
          if (result.code === "duplicate") { show("info", esc(t(key))); return; }
          if (key) { show("error", esc(t(key).replace("{wait}", formatWait(result.retryAfter || 3600)))); return; }
          throw new Error(result.code || "server");
        }
        recordSent();
        Object.assign(formState, { name: "", email: "", message: "", loadedAt: Date.now() });
        renderContactForm(container);
        formState.notice = null;
        $("#cfNotice", container).innerHTML = `<div class="alert alert-success"><p>${esc(t("success_message"))}</p></div>`;
      } catch (err) {
        console.error("Slanje poruke nije uspjelo:", err);
        resetTurnstile();
        show("error", `${esc(t("error_message"))} <strong>${esc(CV.personal.email)}</strong>.`);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  // =========================================================================
  // Stranica: Iskustvo
  // =========================================================================

  function renderExperience() {
    const lang = lc();
    const parts = [`<div class="heading"><h1>${esc(t("experience_title"))}</h1></div>`];
    CV.jobs.forEach((job, i) => {
      if (i > 0) parts.push('<div class="br-gap"></div>');
      parts.push(`
        <div class="columns split-1-3">
          <div class="col col-1">
            <img src="assets/${job.logo}" alt="${esc(job.company)}" loading="lazy">
            <div class="md"><p>${inlineMd(job.logo_caption)}</p></div>
          </div>
          <div class="col col-3">
            <div class="md"><p><strong>${esc(tr(job.header, lang))}</strong></p></div>
            <div class="md"><p>🚧 <strong>${esc(tr(job.subheader, lang))}</strong></p></div>
            <div class="md"><p>${esc(formatPeriod(job, lang))}</p></div>
            <div class="md"><ul>${job.duties[lang].map((d) => `<li>► ${esc(d)}</li>`).join("")}</ul></div>
          </div>
        </div>`);
    });
    page.innerHTML = parts.join("");
    page.querySelectorAll(".col a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  }

  // =========================================================================
  // Stranica: Chat Bot
  // =========================================================================

  const chat = {
    messages: session.get("chatMessages", null),
    state: session.get("chatState", {}),
    busy: false,
  };
  if (!Array.isArray(chat.messages) || !chat.messages.length) chat.messages = [{ role: "assistant", content: window.Chatbot.greetingMessage(language), greeting: true }];
  const saveChat = () => { session.set("chatMessages", chat.messages); session.set("chatState", chat.state); };

  const messageHtml = (m) => `
    <div class="chat-message">
      <div class="avatar ${m.role}"><span class="ms">${m.role === "user" ? "face" : "smart_toy"}</span></div>
      <div class="chat-content md">${m.role === "user" ? `<p>${esc(m.content)}</p>` : renderMarkdown(m.content)}</div>
    </div>`;

  function renderChat() {
    // Ako je promijenjen jezik prije prvog pitanja - prevedi pozdrav
    if (chat.messages.length === 1 && chat.messages[0].greeting) chat.messages[0].content = window.Chatbot.greetingMessage(language);

    page.innerHTML = `
      <div class="heading"><h1>💬 Chat Assistant</h1></div>
      <div class="md"><p>${esc(t("chat_intro"))}</p></div>
      <div id="chatLog" style="display:contents">${chat.messages.map(messageHtml).join("")}</div>`;

    bottom.innerHTML = `
      <div class="bottom-inner">
        <form class="chat-input" id="chatForm" autocomplete="off">
          <textarea id="chatText" rows="1" maxlength="500" placeholder="${esc(t("chat_placeholder"))}" aria-label="${esc(t("chat_placeholder"))}"></textarea>
          <button class="chat-send" type="submit" disabled aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg></button>
        </form>
      </div>`;

    const form = $("#chatForm"), text = $("#chatText"), sendBtn = $(".chat-send", form);
    const autosize = () => {
      text.style.height = "38px";
      text.style.height = Math.min(text.scrollHeight, 200) + "px";
      text.style.overflowY = text.scrollHeight > 200 ? "auto" : "hidden";
      sendBtn.disabled = !text.value.trim() || chat.busy;
    };
    text.addEventListener("input", autosize);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const prompt = text.value.trim();
      if (!prompt || chat.busy) return;
      text.value = "";
      autosize();
      ask(prompt);
    });
    requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
  }

  async function ask(prompt) {
    chat.busy = true;
    const log = $("#chatLog");
    chat.messages.push({ role: "user", content: prompt });
    log.insertAdjacentHTML("beforeend", messageHtml({ role: "user", content: prompt }));

    log.insertAdjacentHTML("beforeend", `
      <div class="chat-message" id="pending">
        <div class="avatar assistant"><span class="ms">smart_toy</span></div>
        <div class="chat-content md"><div class="spinner-row"><div class="spinner"></div><span>${esc(t("chat_thinking"))}</span></div></div>
      </div>`);
    main.scrollTop = main.scrollHeight;
    const pending = $("#pending");
    const content = $(".chat-content", pending);

    await sleep(300); // kratka pauza radi prirodnijeg osjećaja
    let answer;
    try {
      answer = window.Chatbot.respond(prompt, language, chat.state);
    } catch (err) {
      console.error(err);
      answer = window.Chatbot.respond("help", language, {});
    }

    // Efekat kucanja (čuva nove redove, pa liste i formatiranje ostaju ispravni)
    const chunks = answer.split(/(\s+)/);
    let shown = "";
    for (const chunk of chunks) {
      shown += chunk;
      if (chunk.trim()) {
        content.innerHTML = renderMarkdown(shown + "▌");
        if (main.scrollHeight - main.scrollTop - main.clientHeight < 200) main.scrollTop = main.scrollHeight;
        await sleep(20);
        if (!document.body.contains(content)) break; // korisnik je otišao na drugu stranicu
      }
    }
    content.innerHTML = renderMarkdown(answer);
    pending.removeAttribute("id");
    chat.messages.push({ role: "assistant", content: answer });
    saveChat();
    chat.busy = false;
    const text = $("#chatText");
    if (text) { text.dispatchEvent(new Event("input")); text.focus({ preventScroll: true }); }
    main.scrollTop = main.scrollHeight;
  }

  // Klik na link iz chata ("kontakt forma") vodi na formu
  page.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#/contact"]');
    if (a && currentRoute() === "contact") { e.preventDefault(); $("#contact-me")?.scrollIntoView({ behavior: "smooth" }); }
  });

  // =========================================================================
  // Start
  // =========================================================================

  renderSidebarTexts();
  lastRoute = currentRoute();
  renderPage();
})();
