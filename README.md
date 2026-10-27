# Amar Helać – Digital CV

Statička verzija digitalnog CV-a (HTML, CSS, JavaScript), hostana besplatno na GitHub Pages.
Izgled je preuzet 1:1 sa Streamlit verzije ([Multipage](https://github.com/3Revolt/Multipage)).

## Šta sadrži

- **O meni**: vještine, projekti, edukacija, jezici, preuzimanje CV-a i kontakt forma
- **Iskustvo**: radno iskustvo sa logotipima firmi
- **Chat Bot**: offline asistent koji odgovara na pitanja o CV-u. Radi u browseru, bez API-ja,
  na tri jezika, tolerantan je na greške u kucanju i pamti kontekst razgovora
- Tri jezika: bosanski, engleski, njemački

## Struktura

| Fajl | Namjena |
|---|---|
| `index.html` | stranica (sidebar + sadržaj) |
| `css/style.css` | izgled (mjere preuzete sa Streamlit verzije) |
| `js/app.js` | navigacija, jezici, stranice, chat i kontakt forma |
| `js/chatbot.js` | chatbot engine (prijevod `chatbot_engine.py` iz Multipage projekta) |
| `js/cv-data.js` | CV podaci i tabele chatbota, **generisano automatski** |
| `js/config.js` | adresa servera za kontakt formu i Turnstile Site Key (javni podaci) |
| `apps-script/Code.gs` | server za kontakt formu (Google Apps Script) |
| `tools/export_data.py` | generiše `js/cv-data.js` iz Multipage projekta |

## Izmjena CV podataka

Podaci se mijenjaju na jednom mjestu, u `Multipage/cv_data.py`. Nakon toga pokreni:

```bash
python tools/export_data.py ../Multipage
```

## Kontakt forma

Forma šalje poruke na vlastiti besplatni server: **Google Apps Script** (`apps-script/Code.gs`),
uz zaštitu **Cloudflare Turnstile**.

- Tebi stiže poruka (Reply-To je posjetilac), a posjetiocu automatski odgovor na njegovom jeziku
- Sve provjere rade na serveru: Turnstile token (samo sa dozvoljenih domena), skriveno polje za botove,
  najviše 3 poruke dnevno sa iste adrese, blokada iste poruke, najviše 1 auto-reply dnevno po adresi
  i globalni limit od 10 poruka na sat i 40 dnevno
- `js/config.js` sadrži samo javne vrijednosti: Web app URL i Turnstile Site Key.
  **Secret Key je samo u Apps Script postavkama** (Script Properties: `TURNSTILE_SECRET`, `NOTIFY_EMAIL`)

Nakon izmjene `Code.gs`: zalijepi novi kod u Apps Script, pa **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**
(URL ostaje isti).

## Lokalno pokretanje

```bash
python -m http.server 8000
```

Zatim otvori http://localhost:8000
