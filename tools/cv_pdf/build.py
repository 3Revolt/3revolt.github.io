"""
Generiše CV (HTML za štampu u PDF) na tri jezika iz Multipage/cv_data.py.
Stil: tamnoplava tema kao u originalnom Canva CV-u.

    python tools/cv_pdf/build.py ../Multipage

Rezultat: tools/cv_pdf/out/cv-bs.html, cv-en.html, cv-de.html
PDF: otvori HTML u Chromeu -> Print -> Save as PDF (Margins: None, Background graphics: ON),
ili ga napravi automatski skriptom koja poziva headless Chrome.
"""
import html
import io
import sys
from pathlib import Path

import qrcode
import qrcode.image.svg

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "../Multipage").resolve()
sys.path.insert(0, str(SOURCE))
import cv_data as cv  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

LABELS = {
    "bs": {"profile": "Profil", "contact": "Kontakt", "languages": "Jezici", "skills": "Vještine", "soft": "Lične vještine",
           "projects": "Ključni projekti", "education": "Obrazovanje", "experience": "Radno iskustvo", "other": "Ostalo",
           "online": "Online CV i chatbot", "scan": "Skenirajte za interaktivni CV", "born": "Datum rođenja", "course": "Kurs"},
    "en": {"profile": "Profile", "contact": "Contact", "languages": "Languages", "skills": "Skills", "soft": "Soft skills",
           "projects": "Key projects", "education": "Education", "experience": "Work experience", "other": "Other",
           "online": "Online CV & chatbot", "scan": "Scan for the interactive CV", "born": "Date of birth", "course": "Course"},
    "de": {"profile": "Profil", "contact": "Kontakt", "languages": "Sprachen", "skills": "Kenntnisse", "soft": "Soziale Kompetenzen",
           "projects": "Wichtige Projekte", "education": "Ausbildung", "experience": "Berufserfahrung", "other": "Sonstiges",
           "online": "Online-CV & Chatbot", "scan": "Scannen für den interaktiven Lebenslauf", "born": "Geburtsdatum", "course": "Kurs"},
}

# Opšte stavke koje ne govore ništa konkretno - izostavljaju se iz PDF-a (na sajtu ostaju)
GENERIC_EN = ("Responsibility for timely", "Other activities", "Performing other tasks")
# Stariji poslovi: prikazuje se samo nekoliko ključnih stavki
OLDER_JOB_ITEMS = 3
OLDER_THAN_YEAR = 2020

ICONS = {
    "phone": '<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>',
    "mail": '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>',
    "home": '<path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z"/>',
    "web": '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zm2.9-8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/>',
    "cake": '<path d="M12 6c1.1 0 2-.9 2-2 0-.4-.1-.7-.3-1L12 0l-1.7 3c-.2.3-.3.6-.3 1 0 1.1.9 2 2 2zm6 3h-5V7h-2v2H6c-1.7 0-3 1.3-3 3v1.5c0 1.1.9 2 2 2 .5 0 1-.2 1.4-.6L8.5 13l2.1 2c.7.7 2.1.7 2.8 0l2.1-2 2.1 1.9c.4.4.9.6 1.4.6 1.1 0 2-.9 2-2V12c0-1.7-1.3-3-3-3zm-1 7.8c-.8 0-1.6-.3-2.1-.9L13.8 15c-1 1-2.6 1-3.6 0l-1.1-1.1c-.6.6-1.3.9-2.1.9-.6 0-1.1-.2-1.5-.5V21c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-4.7c-.4.3-1 .5-1.5.5z"/>',
}

e = html.escape


def icon(name):
    return f'<span class="ic"><svg viewBox="0 0 24 24">{ICONS[name]}</svg></span>'


def qr_svg(url):
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    return svg[svg.index("<svg"):]


def bold_md(text):
    # "**x:** y" -> <b>x:</b> y
    parts = e(text).split("**")
    return "".join(f"<b>{p}</b>" if i % 2 else p for i, p in enumerate(parts))


def job_block(job, lang):
    duties = [d for d, en in zip(job["duties"][lang], job["duties"]["en"]) if not en.startswith(GENERIC_EN)]
    if job["start"][0] < 2019:      # 2014-2018: dvije ključne stavke
        duties = duties[:2]
    elif job["start"][0] < OLDER_THAN_YEAR:
        duties = duties[:OLDER_JOB_ITEMS]
    elif job["start"][0] < 2021:      # 2020: najviše 6 stavki
        duties = duties[:6]
    elif job["end"] is not None:      # raniji poslovi od 2021: najviše 8 stavki
        duties = duties[:8]
    company = cv.tr(job["company_name"], lang)
    items = "".join(f"<li>{e(d)}</li>" for d in duties)
    return (f'<div class="block job" data-split="1">'
            f'<div class="job-head"><div class="job-company">{e(company)}</div>'
            f'<div class="job-date">{e(cv.format_period(job, lang))}</div></div>'
            f'<div class="job-role">{e(cv.job_role(job, lang))}</div>'
            f'<ul>{items}</ul></div>')


def build(lang):
    L = LABELS[lang]
    p = cv.PERSONAL
    first, last = p["name"].split(" ", 1)
    site = f"https://{p['website']}"

    contact = (f'<div class="contact-row">{icon("phone")}<span>{e(p["phone"])}</span></div>'
               f'<div class="contact-row">{icon("mail")}<span>{e(p["email"])}</span></div>'
               f'<div class="contact-row">{icon("home")}<span>{e(p["city"][lang])}</span></div>'
               f'<div class="contact-row">{icon("cake")}<span>{e(L["born"])}: {e(p["birth_date"])}</span></div>'
               f'<div class="contact-row">{icon("web")}<a href="{site}">{e(p["website"])}</a></div>')
    languages = "".join(f"<li>{e(l['label'][lang])}</li>" for l in cv.LANGUAGES)
    skills = "".join(f'<li><b>{e(cv.tr(c["name"], lang))}:</b> {e(", ".join(c["items"][lang]))}</li>' for c in cv.SKILL_CATEGORIES)
    soft = e(", ".join(cv.SOFT_SKILLS[lang]))

    projects = "".join(
        f'<li><b>{e(cv.tr(pr["name"], lang))}</b> – {e(pr["description"][lang])}</li>' for pr in cv.PROJECTS)
    ed = cv.EDUCATION
    education = (f'<div class="block"><div class="job-head"><div class="job-company">{e(ed["school"][lang])}</div>'
                 f'<div class="job-date">{e(ed["years"])}</div></div>'
                 f'<div class="job-role">{e(ed["profession"][lang])}</div>'
                 f'<ul><li>{e(", ".join(ed["courses"][lang]))}</li></ul></div>')

    content_blocks = [
        f'<div class="block"><h3 class="bar">{e(L["projects"])}</h3><ul class="projects">{projects}</ul></div>',
        f'<div class="block"><h3 class="bar">{e(L["education"])}</h3></div>',
        education,
        f'<div class="block keep-next"><h3 class="bar">{e(L["experience"])}</h3></div>',
    ] + [job_block(j, lang) for j in cv.JOBS]

    qr = qr_svg(site)
    blocks_html = "\n".join(f"<template>{b}</template>" for b in content_blocks)

    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>CV – {e(p["name"])}</title>
<style>
  /* Kompletni fontovi u jednom fajlu (sa č, ć, š, ž, ä, ö, ü) - tekst u PDF-u ostaje čitljiv i za ATS sisteme */
  @font-face {{ font-family: "Montserrat"; src: url("../fonts/Montserrat.ttf") format("truetype"); font-weight: 100 900; }}
  @font-face {{ font-family: "League Spartan"; src: url("../fonts/LeagueSpartan.ttf") format("truetype"); font-weight: 100 900; }}
  @page {{ size: A4; margin: 0; }}
  :root {{ --navy: #263445; --navy-2: #2f3c4f; --text: #1f2933; --muted: #5b6573; --accent: #3a6ea5; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; background: #e5e7eb; }}
  body {{ font-family: "Montserrat", sans-serif; color: var(--text); font-size: 8.3pt; line-height: 1.38;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .page {{ position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; margin: 0 auto 8mm; page-break-after: always; }}
  .page:last-child {{ page-break-after: auto; }}
  @media print {{ html, body {{ background: #fff; }} .page {{ margin: 0; }} }}

  /* Dekoracije kao u originalu: tamnoplavi četvrt-krug i šrafirani krugovi */
  .corner {{ position: absolute; top: 0; left: 0; width: 58mm; height: 52mm; background: var(--navy); border-bottom-right-radius: 100% 100%; }}
  .corner::after {{ content: ""; position: absolute; right: -1px; bottom: -1px; width: 30mm; height: 30mm; background: #fff; border-top-left-radius: 100%; }}
  .hatch {{ position: absolute; width: 34mm; height: 34mm; border-radius: 50%;
           background: repeating-linear-gradient(135deg, #c3c8cf 0 0.35mm, transparent 0.35mm 1.4mm); opacity: .9; }}
  .hatch.tr {{ top: -12mm; right: -12mm; }}
  .hatch.bl {{ bottom: -14mm; left: -14mm; }}
  .hatch.br {{ bottom: -14mm; right: -14mm; }}

  /* Zaglavlje */
  .header {{ position: absolute; top: 9mm; left: 64mm; right: 14mm; }}
  .name {{ font-family: "League Spartan", sans-serif; font-weight: 800; color: var(--navy); font-size: 40pt; line-height: .92; letter-spacing: .5pt; }}
  .name .last {{ display: block; padding-left: 16mm; }}
  .title {{ margin-top: 3mm; font-size: 11pt; font-weight: 600; color: var(--navy); letter-spacing: .3pt; }}
  .profile {{ margin-top: 3mm; font-size: 8.8pt; color: var(--muted); text-align: justify; }}

  /* Kolone */
  .side {{ position: absolute; left: 0; width: 66mm; padding: 0 7mm 0 9mm; }}
  .page.first .side {{ top: 62mm; bottom: 0; }}
  .page.rest .side {{ top: 0; bottom: 0; background: var(--navy-2); color: #e8edf3; padding-top: 14mm; }}
  .main {{ position: absolute; left: 72mm; right: 12mm; }}
  .page.first .main {{ top: 62mm; bottom: 9mm; }}
  .page.rest .main {{ top: 10mm; bottom: 9mm; }}
  .main-inner {{ height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: 2.3mm; }}

  h3.bar {{ margin: 0 0 2.4mm; background: var(--navy); color: #fff; font-weight: 500; font-size: 9.5pt; letter-spacing: 1.2pt;
            text-transform: uppercase; text-align: center; padding: 1.4mm 2mm; }}
  .side h3.bar {{ margin-top: 4.5mm; }}
  .page.rest .side h3.bar {{ background: #fff; color: var(--navy-2); }}
  ul {{ margin: 0; padding-left: 4mm; }}
  li {{ margin: 0 0 .5mm; }}
  li::marker {{ color: var(--navy); }}
  .page.rest .side li::marker {{ color: #fff; }}

  .contact-row {{ display: flex; align-items: center; gap: 2.6mm; margin: 0 0 2.2mm; font-size: 8.4pt; }}
  .contact-row a {{ color: var(--text); text-decoration: none; font-weight: 600; }}
  .ic {{ flex: 0 0 6.6mm; width: 6.6mm; height: 6.6mm; border-radius: 50%; background: var(--navy); display: flex; align-items: center; justify-content: center; }}
  .ic svg {{ width: 3.6mm; height: 3.6mm; fill: #fff; }}
  .side .langs li {{ font-size: 9pt; }}
  .side .skills li {{ font-size: 7.8pt; margin-bottom: 1.1mm; line-height: 1.32; }}
  .soft {{ font-size: 8pt; }}

  .job-head {{ display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; }}
  .job-company {{ font-weight: 700; font-size: 9.6pt; color: var(--navy); text-transform: uppercase; letter-spacing: .3pt; }}
  .job-date {{ flex: 0 0 auto; font-weight: 600; font-size: 8.2pt; color: #fff; background: var(--accent); border-radius: 3mm; padding: .4mm 2.4mm; }}
  .job-role {{ font-weight: 600; font-size: 8.8pt; color: var(--accent); margin: .5mm 0 1.1mm; }}
  .projects li {{ margin-bottom: 1.6mm; }}
  .projects b {{ color: var(--navy); }}
  .cont {{ font-size: 7.6pt; color: var(--muted); font-style: italic; margin-bottom: 1mm; }}

  .qr-box {{ display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2mm; }}
  .qr-box svg {{ width: 30mm; height: 30mm; background: #fff; padding: 1.6mm; border-radius: 2mm; }}
  .qr-box .qr-title {{ font-weight: 700; font-size: 9pt; letter-spacing: .6pt; text-transform: uppercase; }}
  .qr-box .qr-sub {{ font-size: 7.8pt; opacity: .85; }}
  .qr-box a {{ color: inherit; font-weight: 600; text-decoration: none; }}
  .page.first .qr-small {{ margin-top: 4mm; }}
</style>
</head>
<body>
<div id="pages"></div>

<template id="first-page">
  <div class="page first">
    <div class="corner"></div><div class="hatch tr"></div><div class="hatch bl"></div>
    <div class="header">
      <div class="name">{e(first.upper())}<span class="last">{e(last.upper())}</span></div>
      <div class="title">{e(p["role"][lang])}</div>
      <div class="profile">{e(p["description"][lang])}</div>
    </div>
    <div class="side">
      <h3 class="bar" style="margin-top:0">{e(L["contact"])}</h3>
      {contact}
      <h3 class="bar">{e(L["languages"])}</h3><ul class="langs">{languages}</ul>
      <h3 class="bar">{e(L["skills"])}</h3><ul class="skills">{skills}</ul>
    </div>
    <div class="main"><div class="main-inner"></div></div>
  </div>
</template>

<template id="rest-page">
  <div class="page rest">
    <div class="hatch br"></div>
    <div class="side">
      <h3 class="bar" style="margin-top:0">{e(L["soft"])}</h3><div class="soft">{soft}</div>
      <h3 class="bar">{e(L["other"])}</h3><div class="soft">{e(cv.DRIVING_LICENSE[lang])}</div>
      <h3 class="bar">{e(L["online"])}</h3>
      <div class="qr-box">{qr}<div class="qr-sub">{e(L["scan"])}</div><a href="{site}">{e(p["website"])}</a></div>
    </div>
    <div class="main"><div class="main-inner"></div></div>
  </div>
</template>

{blocks_html}

<script>
// Raspoređivanje sadržaja po stranicama: blok ide na sljedeću stranicu kad ne stane,
// a dugačak posao se dijeli po stavkama.
(async () => {{
  // Sačekaj da se fontovi stvarno učitaju prije mjerenja (inače raspored ne odgovara štampi)
  // Tekst sa kvačicama i umlautima učitava i "latin-ext" dio fonta
  const sample = 'AaŽžĆćČčŠšĐđÄäÖöÜüß–';
  await Promise.all([
    ...['400', '500', '600', '700'].map(w => document.fonts.load(`${{w}} 10pt Montserrat`, sample)),
    document.fonts.load('800 40pt "League Spartan"', sample),
  ]);
  await document.fonts.ready;
  const pages = document.getElementById('pages');
  const newPage = (first) => {{
    const node = document.getElementById(first ? 'first-page' : 'rest-page').content.firstElementChild.cloneNode(true);
    pages.appendChild(node);
    return node.querySelector('.main-inner');
  }};
  const overflows = (col) => col.scrollHeight > col.clientHeight + 1;
  let col = newPage(true);
  const blocks = [...document.querySelectorAll('body > template:not([id])')].map(t => t.content.firstElementChild);
  for (let i = 0; i < blocks.length; i++) {{
    let block = blocks[i].cloneNode(true);
    col.appendChild(block);
    // Naslov sekcije ne smije ostati sam na dnu stranice
    if (block.classList.contains('keep-next') && i + 1 < blocks.length) {{
      const probe = blocks[i + 1].cloneNode(true);
      const firstItems = probe.querySelectorAll('li');
      firstItems.forEach((li, k) => {{ if (k > 1) li.remove(); }});
      col.appendChild(probe);
      const bad = overflows(col);
      probe.remove();
      if (bad) {{ block.remove(); col = newPage(false); col.appendChild(block); }}
      continue;
    }}
    if (!overflows(col)) continue;
    if (block.dataset.split) {{
      const items = [...block.querySelectorAll('li')];
      const rest = block.cloneNode(true);
      rest.querySelector('ul').innerHTML = '';
      let moved = [];
      while (overflows(col) && items.length > 2) {{ moved.unshift(items.pop()); moved[0].remove(); }}
      if (overflows(col) || block.querySelectorAll('li').length < 2) {{
        block.remove(); col = newPage(false);
        block = blocks[i].cloneNode(true); col.appendChild(block);
        continue;
      }}
      if (moved.length) {{
        col = newPage(false);
        rest.querySelector('.job-head').insertAdjacentHTML('afterend', '');
        moved.forEach(li => rest.querySelector('ul').appendChild(li));
        col.appendChild(rest);
      }}
    }} else {{
      block.remove(); col = newPage(false); col.appendChild(block);
    }}
  }}
  document.body.dataset.ready = '1';
}})();
</script>
</body>
</html>"""


for lang in ("bs", "en", "de"):
    target = OUT / f"cv-{lang}.html"
    target.write_text(build(lang), encoding="utf-8")
    print("OK", target)
