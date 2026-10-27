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
| `js/config.js` | ključ za kontakt formu (Web3Forms) |
| `tools/export_data.py` | generiše `js/cv-data.js` iz Multipage projekta |

## Izmjena CV podataka

Podaci se mijenjaju na jednom mjestu, u `Multipage/cv_data.py`. Nakon toga pokreni:

```bash
python tools/export_data.py ../Multipage
```

## Kontakt forma

Forma šalje poruke preko besplatnog servisa [Web3Forms](https://web3forms.com).
Na web3forms.com upiši svoj email, ključ stiže na mail, a ti ga upišeš u `js/config.js` (`web3formsKey`).
Dok je ključ prazan, forma prikazuje poruku da je onemogućena, uz email adresu.

Zaštita od spama: captcha, skriveno polje za botove, provjera prebrzog slanja, pauza od 60 s između poruka,
najviše 5 poruka dnevno, 3 sa iste email adrese, blokada iste poruke i zaključavanje nakon 5 pogrešnih captcha odgovora.

## Lokalno pokretanje

```bash
python -m http.server 8000
```

Zatim otvori http://localhost:8000
