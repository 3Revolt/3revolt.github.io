/**
 * --- KONTAKT FORMA: server na Google Apps Scriptu (besplatno) ---
 *
 * Prima poruke sa sajta, provjerava ih i šalje:
 *   1. obavještenje tebi (Reply-To = posjetilac, pa odgovaraš jednim klikom)
 *   2. automatski odgovor posjetiocu (fiksan tekst na njegovom jeziku)
 *
 * Zaštita (sve se provjerava ovdje na serveru, ne može se zaobići iz browsera):
 *   - Cloudflare Turnstile: svaka poruka mora imati svjež token stvarnog posjetioca
 *   - Turnstile token mora biti izdat za jednu od dozvoljenih domena
 *   - skriveno polje za botove (honeypot)
 *   - provjera dužine polja, ispravnosti emaila i linkova u imenu
 *   - najviše 3 poruke dnevno sa iste email adrese
 *   - ista poruka se ne može poslati dvaput u 24h
 *   - najviše 1 automatski odgovor dnevno na istu adresu (zaštita od "backscatter" zloupotrebe)
 *   - globalni limit: 10 poruka na sat, 40 dnevno (Gmail dozvoljava ~100 mailova dnevno)
 *
 * Podešavanja (Project Settings -> Script Properties), NE u kodu:
 *   TURNSTILE_SECRET   - Secret Key iz Cloudflare Turnstile
 *   NOTIFY_EMAIL       - adresa na koju stižu poruke (npr. hela3292@hotmail.com)
 *   ALLOWED_HOSTNAMES  - (opcionalno) npr. "3revolt.github.io,amarhelac.is-a.dev"
 */

var LIMITS = {
  perEmailPerDay: 3,
  autoReplyPerEmailPerDay: 1,
  globalPerHour: 10,
  globalPerDay: 40,
  duplicateWindowSeconds: 86400,
  maxName: 100,
  maxEmail: 254,
  maxMessage: 3000
};

var DEFAULT_ALLOWED_HOSTNAMES = ['3revolt.github.io', 'amarhelac.is-a.dev'];

var AUTO_REPLY = {
  Bosanski: {
    subject: 'Hvala na poruci – Amar Helać',
    body: 'Zdravo,\n\nhvala što ste me kontaktirali putem mog CV sajta. Vaša poruka je uspješno primljena i javiću vam se u najkraćem mogućem roku.\n\nSrdačan pozdrav,\nAmar Helać\nIT Specijalista | Podrška i automatizacija\n\n---\nOvo je automatski odgovor. Ako niste vi poslali poruku, slobodno zanemarite ovaj email.'
  },
  English: {
    subject: 'Thank you for your message – Amar Helać',
    body: 'Hello,\n\nthank you for contacting me through my CV website. Your message has been received and I will get back to you as soon as possible.\n\nKind regards,\nAmar Helać\nIT Specialist | Support & Automation\n\n---\nThis is an automatic reply. If you did not send a message, please ignore this email.'
  },
  Deutsch: {
    subject: 'Vielen Dank für Ihre Nachricht – Amar Helać',
    body: 'Hallo,\n\nvielen Dank für Ihre Kontaktaufnahme über meine CV-Webseite. Ihre Nachricht ist eingegangen und ich melde mich so schnell wie möglich bei Ihnen.\n\nMit freundlichen Grüßen\nAmar Helać\nIT-Spezialist | Support & Automatisierung\n\n---\nDies ist eine automatische Antwort. Falls Sie keine Nachricht gesendet haben, ignorieren Sie diese E-Mail bitte.'
  }
};

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handle_(data));
  } catch (err) {
    console.error(err);
    return json_({ success: false, code: 'server' });
  }
}

// Otvaranje URL-a u browseru samo potvrđuje da skripta radi
function doGet() {
  return json_({ success: true, status: 'ok' });
}

function handle_(data) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TURNSTILE_SECRET');
  var notifyEmail = props.getProperty('NOTIFY_EMAIL');
  if (!secret || !notifyEmail) return { success: false, code: 'not_configured' };

  // Bot je popunio skriveno polje: tihi "uspjeh", ništa se ne šalje
  if (data.website) return { success: true };

  var name = clean_(data.name, LIMITS.maxName + 1);
  var email = clean_(data.email, LIMITS.maxEmail + 1).toLowerCase();
  var message = String(data.message || '').trim();
  var language = AUTO_REPLY[data.language] ? data.language : 'English';

  if (!name || !email || !message) return { success: false, code: 'invalid' };
  if (name.length > LIMITS.maxName || email.length > LIMITS.maxEmail || message.length > LIMITS.maxMessage) return { success: false, code: 'invalid' };
  if (/https?:\/\/|www\./i.test(name)) return { success: false, code: 'invalid' };
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email)) return { success: false, code: 'invalid' };

  // Cloudflare Turnstile: posjetilac mora biti stvaran, a token izdat za tvoju domenu
  var allowed = (props.getProperty('ALLOWED_HOSTNAMES') || DEFAULT_ALLOWED_HOSTNAMES.join(','))
    .split(',').map(function (h) { return h.trim().toLowerCase(); }).filter(String);
  var verify = verifyTurnstile_(secret, data.token);
  if (!verify.success || allowed.indexOf(String(verify.hostname || '').toLowerCase()) === -1) {
    return { success: false, code: 'turnstile' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = Math.floor(Date.now() / 1000);
    var state = loadState_(props, now);
    var emailKey = hash_(email);
    var messageKey = hash_(message.toLowerCase());

    var hour = state.global.filter(function (t) { return now - t < 3600; });
    if (hour.length >= LIMITS.globalPerHour) return { success: false, code: 'global_limit', retryAfter: Math.min.apply(null, hour) + 3600 - now };
    if (state.global.length >= LIMITS.globalPerDay) return { success: false, code: 'global_limit', retryAfter: Math.min.apply(null, state.global) + 86400 - now };

    var sentFromEmail = state.emails[emailKey] || [];
    if (sentFromEmail.length >= LIMITS.perEmailPerDay) return { success: false, code: 'email_limit', retryAfter: Math.min.apply(null, sentFromEmail) + 86400 - now };
    if (state.messages[messageKey] && now - state.messages[messageKey] < LIMITS.duplicateWindowSeconds) return { success: false, code: 'duplicate' };

    // 1. Obavještenje tebi
    MailApp.sendEmail({
      to: notifyEmail,
      replyTo: email,
      name: 'CV Website',
      subject: 'Message from CV Website - ' + name,
      body: 'Name: ' + name + '\nEmail: ' + email + '\nLanguage: ' + language + '\n\nMessage:\n' + message
    });

    // 2. Automatski odgovor (fiksan tekst, najviše jednom dnevno po adresi)
    var replies = state.replies[emailKey] || [];
    if (replies.length < LIMITS.autoReplyPerEmailPerDay) {
      MailApp.sendEmail({ to: email, name: 'Amar Helać', subject: AUTO_REPLY[language].subject, body: AUTO_REPLY[language].body });
      replies.push(now);
      state.replies[emailKey] = replies;
    }

    state.global.push(now);
    sentFromEmail.push(now);
    state.emails[emailKey] = sentFromEmail;
    state.messages[messageKey] = now;
    saveState_(props, state);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function verifyTurnstile_(secret, token) {
  if (!token || String(token).length > 2048) return { success: false };
  var response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: secret, response: String(token) },
    muteHttpExceptions: true
  });
  try {
    return JSON.parse(response.getContentText());
  } catch (err) {
    return { success: false };
  }
}

// Stanje limita se čuva u Script Properties (samo hash-evi adresa i poruka, ne sam sadržaj)
function loadState_(props, now) {
  var state;
  try { state = JSON.parse(props.getProperty('RATE_STATE') || '{}'); } catch (err) { state = {}; }
  var day = 86400;
  var keepRecent = function (list) { return (list || []).filter(function (t) { return now - t < day; }); };
  var pruneMap = function (map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { var v = keepRecent(map[k]); if (v.length) out[k] = v; });
    return out;
  };
  var messages = {};
  Object.keys(state.messages || {}).forEach(function (k) { if (now - state.messages[k] < LIMITS.duplicateWindowSeconds) messages[k] = state.messages[k]; });
  return {
    global: keepRecent(state.global),
    emails: pruneMap(state.emails),
    replies: pruneMap(state.replies),
    messages: messages
  };
}

function saveState_(props, state) {
  props.setProperty('RATE_STATE', JSON.stringify(state));
}

function hash_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.slice(0, 12).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function clean_(value, maxLength) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
