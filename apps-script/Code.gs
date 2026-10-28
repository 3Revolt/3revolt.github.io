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
    body: 'Hvala Vam što ste me kontaktirali. Javiću Vam se što prije.\n\nSrdačan pozdrav,\nAmar Helać\nhttps://amarhelac.is-a.dev'
  },
  English: {
    subject: 'Thank you for your message – Amar Helać',
    body: 'Thank you for contacting me. I will get back to you as soon as possible.\n\nKind regards,\nAmar Helać\nhttps://amarhelac.is-a.dev'
  },
  Deutsch: {
    subject: 'Vielen Dank für Ihre Nachricht – Amar Helać',
    body: 'Vielen Dank für Ihre Kontaktaufnahme. Ich melde mich so schnell wie möglich bei Ihnen.\n\nMit freundlichen Grüßen\nAmar Helać\nhttps://amarhelac.is-a.dev'
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

    // 1. Automatski odgovor (fiksan tekst, najviše jednom dnevno po adresi)
    var replies = state.replies[emailKey] || [];
    var autoReplySent = false;
    if (replies.length < LIMITS.autoReplyPerEmailPerDay) {
      try {
        MailApp.sendEmail({
          to: email,
          name: 'Amar Helać',
          replyTo: notifyEmail,
          subject: AUTO_REPLY[language].subject,
          body: AUTO_REPLY[language].body,
          htmlBody: autoReplyHtml_(language)
        });
        replies.push(now);
        state.replies[emailKey] = replies;
        autoReplySent = true;
      } catch (err) {
        console.error('Auto-reply nije poslan: ' + err); // obavještenje tebi se i dalje šalje
      }
    }

    // 2. Obavještenje tebi (Reply-To = posjetilac)
    var sentAt = Utilities.formatDate(new Date(), 'Europe/Sarajevo', 'dd.MM.yyyy. HH:mm');
    MailApp.sendEmail({
      to: notifyEmail,
      replyTo: email,
      name: 'CV Website',
      subject: '📩 Nova poruka sa CV sajta – ' + name,
      body: 'Ime: ' + name + '\nEmail: ' + email + '\nJezik: ' + language + '\nVrijeme: ' + sentAt +
        '\nAutomatski odgovor poslan: ' + (autoReplySent ? 'da' : 'ne (već poslan danas)') + '\n\nPoruka:\n' + message,
      htmlBody: notificationHtml_(name, email, language, message, sentAt, autoReplySent)
    });

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

// --- HTML izgled mailova (inline stilovi, rade u Gmailu, Outlooku i na mobitelu) ---

var SITE_URL = 'https://amarhelac.is-a.dev';
var COLORS = { dark: '#0e1117', panel: '#1a1f29', accent: '#d33682', green: '#21c45d', text: '#1f2933', muted: '#6b7280', border: '#e5e7eb' };

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function emailShell_(title, inner, footer) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;' +
    'font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.06);">' +
    '<tr><td style="background:' + COLORS.dark + ';padding:22px 28px;border-bottom:4px solid ' + COLORS.accent + ';">' +
    '<div style="color:' + COLORS.green + ';font-size:13px;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Digital CV · Amar Helać</div>' +
    '<div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:6px;">' + title + '</div></td></tr>' +
    '<tr><td style="padding:26px 28px;color:' + COLORS.text + ';font-size:15px;line-height:1.6;">' + inner + '</td></tr>' +
    '<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid ' + COLORS.border + ';color:' + COLORS.muted + ';font-size:12px;line-height:1.5;">' + footer + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function notificationHtml_(name, email, language, message, sentAt, autoReplySent) {
  var row = function (label, value) {
    return '<tr><td style="padding:8px 12px 8px 0;color:' + COLORS.muted + ';font-size:13px;white-space:nowrap;vertical-align:top;">' + label + '</td>' +
      '<td style="padding:8px 0;font-size:15px;font-weight:600;color:' + COLORS.text + ';">' + value + '</td></tr>';
  };
  var replyLink = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent('Re: Vaša poruka sa CV sajta');
  var inner =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:18px;">' +
    row('Ime', escapeHtml_(name)) +
    row('Email', '<a href="' + replyLink + '" style="color:' + COLORS.accent + ';text-decoration:none;">' + escapeHtml_(email) + '</a>') +
    row('Jezik sajta', escapeHtml_(language)) +
    row('Vrijeme', escapeHtml_(sentAt)) +
    '</table>' +
    '<div style="font-size:13px;color:' + COLORS.muted + ';margin-bottom:6px;">Poruka</div>' +
    '<div style="background:#f9fafb;border:1px solid ' + COLORS.border + ';border-left:4px solid ' + COLORS.accent + ';border-radius:8px;' +
    'padding:14px 16px;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.6;">' + escapeHtml_(message) + '</div>' +
    '<div style="margin-top:22px;"><a href="' + replyLink + '" style="display:inline-block;background:' + COLORS.accent + ';color:#ffffff;' +
    'text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;">↩ Odgovori</a></div>';
  var footer = 'Poslano preko kontakt forme na <a href="' + SITE_URL + '" style="color:' + COLORS.muted + ';">amarhelac.is-a.dev</a> · ' +
    'Automatski odgovor posjetiocu: <b>' + (autoReplySent ? 'poslan' : 'nije poslan (već poslan danas)') + '</b>';
  return emailShell_('📩 Nova poruka sa CV sajta', inner, footer);
}

var AUTO_REPLY_HTML = {
  Bosanski: { title: 'Hvala na poruci! 🙏', text: 'Hvala Vam što ste me kontaktirali. Javiću Vam se što prije.', button: 'Posjetite moj CV', regards: 'Srdačan pozdrav,', role: 'IT Specijalista | Podrška i automatizacija', note: 'Ovo je automatski odgovor.' },
  English: { title: 'Thank you for your message! 🙏', text: 'Thank you for contacting me. I will get back to you as soon as possible.', button: 'Visit my CV', regards: 'Kind regards,', role: 'IT Specialist | Support & Automation', note: 'This is an automatic reply.' },
  Deutsch: { title: 'Vielen Dank für Ihre Nachricht! 🙏', text: 'Vielen Dank für Ihre Kontaktaufnahme. Ich melde mich so schnell wie möglich bei Ihnen.', button: 'Zu meinem Lebenslauf', regards: 'Mit freundlichen Grüßen', role: 'IT-Spezialist | Support & Automatisierung', note: 'Dies ist eine automatische Antwort.' }
};

function autoReplyHtml_(language) {
  var t = AUTO_REPLY_HTML[language] || AUTO_REPLY_HTML.English;
  var inner =
    '<p style="margin:0 0 22px;font-size:16px;">' + t.text + '</p>' +
    '<a href="' + SITE_URL + '" style="display:inline-block;background:' + COLORS.accent + ';color:#ffffff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;">' + t.button + ' →</a>' +
    '<p style="margin:26px 0 0;">' + t.regards + '</p>' +
    '<p style="margin:4px 0 0;font-weight:700;font-size:16px;">Amar Helać</p>' +
    '<p style="margin:2px 0 0;color:' + COLORS.muted + ';font-size:14px;">' + t.role + '</p>';
  return emailShell_(t.title, inner, t.note);
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
