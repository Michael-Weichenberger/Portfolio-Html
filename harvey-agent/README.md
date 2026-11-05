# Kasi · Agentur-Zentrale von MW IT-SERVICES

Kasi misst Websites, findet passende Betriebe, schreibt Antworten, Angebote, Briefe und Mahnungen vor und behält Rechnungen im Blick. **Kasi versendet und bucht nichts eigenständig.** Jede Mail geht erst nach Ihrer Freigabe raus.

## Überblick

| Teil | Wo | Wofür |
|---|---|---|
| Live-Check | mw-itservices.de → Worker `mw-sichtbarkeit` | Website-Test für Besucher, speichert Anfragen |
| Web-Dashboard | `mw-harvey.harvey-agent.workers.dev` (Cloudflare Access) | Anfragen, Angebote, Wiedervorlagen, Kunden, Projekt-Checkliste, Verlauf, von überall |
| Zentrale (lokal) | `npm run dashboard` → http://127.0.0.1:5590 | Sprach-Kugel mit Morgen-Briefing, Postausgang mit „Freigeben & Senden“, Rechnungen, Mahnstufen, Scout-Vorschläge, Termine aus allen Kalendern |
| Agenten (Terminal) | `npm run scout / pipeline / billing / monitor / send-approval` | Suche, Messung, Finanzen, Zahlungs- und Antwort-Erkennung |

Gemeinsame Regeln, nur an einer Stelle:

| Datei | Inhalt |
|---|---|
| `../vis-rules.js` | Signale, Schwellen, Ampeln des Sichtbarkeits-Checks |
| `../offer-rules.js` | Preise, Black-Friday-Aktion, Angebotsberechnung (auch für den Planer der Website) |
| `core/drafts.js` | Textbausteine für Report-Mail, Angebot, Akquise-Brief, **Buchungslink** (`BOOKING_URL`) |
| `core/billing.js` | Rechnungsbeträge, Verzug, Zinsen, Mahntexte Stufe 1–3 |
| `core/store.js` | Status, Bereiche, Projektschritte des Web-Dashboards |
| `core/scout.js` | Branchen (OpenStreetMap-Tags), Leidensdruck, Potenzial, Akquise-Ansätze |

## Einrichtung

```bash
npm install
npm run setup
```

`npm run setup` legt `data/` an (steht in `.gitignore`). Danach die Firmendaten ausfüllen, am einfachsten in der Zentrale unter **Kunden & Stammdaten** (oder direkt in `data/company.json`): Anschrift, Steuernummer oder USt-IdNr., IBAN. Den Basiszinssatz jedes Halbjahr prüfen (1.1. und 1.7., Link steht in der Datei).

`harvey-agent/.env` (steht in `.gitignore`):

```
PSI_API_KEY=AIza…                  PageSpeed-Schlüssel ohne Website-Beschränkung
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=info@mw-itservices.de
SMTP_PASS=…                        Google-App-Passwort (Google-Konto → Sicherheit → App-Passwörter)
SMTP_FROM="Michael Weichenberger <info@mw-itservices.de>"
MAIL_BCC=info@mw-itservices.de     optional
```

Für das Postfach (Antwort-Erkennung) gelten dieselben Zugangsdaten, abweichend `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`.

## Täglicher Ablauf

```bash
npm run dashboard                  # Zentrale im Browser öffnen
npm run monitor                    # Zahlungen (Kontoauszug-CSV in data/inbox/) und Antworten erkennen
npm run billing                    # offene Posten, Mahnvorschläge → Postausgang
npm run send-approval              # Postausgang im Terminal (Alternative zur Zentrale)
```

### Zentrale: Briefing, Sprache, Kalender

- **Morgen-Briefing:** Beim ersten Öffnen am Tag liest Kasi Termine, Scout-Ergebnisse, offene Rechnungen und den Postausgang vor. Lässt der Browser Ton erst nach einem Klick zu, startet es beim ersten Klick. Abschalten: Haken „Briefing morgens automatisch“ unter der Kugel. Die Anrede steht unter Stammdaten → Zentrale.
- **Sprachbefehle:** Mikrofon-Knopf oder `Alt+M`, dann z. B. „Status“, „Termine“, „Finanzen“, „Leads“, „Postausgang“, „Kontoauszug abgleichen“, „Mahn-Check“, „Stopp“. Dieselben Befehle lassen sich unter der Kugel eintippen. Senden per Sprache gibt es nicht (Vier-Augen-Prinzip). Spracheingabe gibt es nur in Chrome und Edge; dort wird das Gesprochene auf Servern von Google bzw. Microsoft erkannt. Die Sprachausgabe läuft lokal.
- **Kalender:** Unter „Termine“ die geheime iCal-Adresse eines Kalenders einfügen (Google: Einstellungen → Kalender → „Privatadresse im iCal-Format“). Cal.com-Buchungen erscheinen über den verbundenen Google-Kalender. Die Adressen liegen nur in `data/calendars.json` und werden im Browser nicht angezeigt. Kasi ergänzt Lead-Termine und Fälligkeiten offener Rechnungen.
- **Modi:** Übersicht (gebogene Panel-Wand), Fokus (Postausgang groß), Agenten (Projekte und Server), Finanzen. Die Wahl bleibt im Browser gespeichert.
- **Befehle (Strg+K / Cmd+K):** Befehle und Suche über Leads, Kunden, Rechnungen, Mails und Termine, z. B. „Lead anlegen“, „Rechnung generieren“, „Briefing wiederholen“, „Mahn-Check“. Senden ist dort bewusst kein Befehl.
- **Projekte & Agenten:** prüft alle 5 Minuten die Websites (MW IT-Services, PhoenixOne AI, beide Cloudflare-Worker), das Git-Repository mit GitHub-Daten, Docker-Container und diesen Rechner. Einstellbar in `data/projects.json`; für private Repositories `GITHUB_TOKEN` in `.env`.
- **Live-Aktivität:** Ticker am rechten Rand mit allem, was Kasi im Hintergrund tut (Läufe, Prüfungen, Versand, Zahlungen).
- **Stimme:** Kasi wählt die natürlichste deutsche Stimme des Browsers, unter der Kugel lässt sie sich ändern. Am natürlichsten klingen in **Microsoft Edge** die Stimmen „… Online (Natural)“ (z. B. Seraphina, Katja, Conrad), in Chrome „Google Deutsch“. Die alten Windows-Stimmen (Hedda, Stefan) klingen blechern.
- **Externe Skripte:** Three.js r128 (cdnjs) und Tailwind 4.1.11 (jsDelivr), beide versionsgenau mit Prüfsumme (SRI). Ohne Internet bleibt die Zentrale bedienbar, die Kugel wird dann flach gezeichnet und die Kacheln stehen untereinander.

### Vertriebs- und Betreuungs-Agenten

Alle Agenten schreiben nur Entwürfe und Hinweise. Gesendet oder veröffentlicht wird erst nach „Freigeben & Senden“ im Postausgang. Ohne die jeweiligen Zugänge laufen sie mit Regeln und Vorlagen weiter.

| Agent | Befehl | Was er tut | braucht |
|---|---|---|---|
| Morgenlauf | startet beim ersten Öffnen der Zentrale am Tag (von Hand: `npm run daily`) | alle Agenten in Reihenfolge, Stand an der Kugel, danach das Briefing; montags Beiträge, am 1. des Monats Berichte, am Quartalsanfang ROI | – |
| Posteingang | `npm run inbox` | Mails bekannter Kontakte einordnen (Interesse, Termin, Absage …), Antwort vorschreiben | IMAP, für Entwürfe KI |
| Support-Tickets | über den Posteingang | Mails von Bestandskunden: Thema und Dringlichkeit, bei „Website geht nicht“ sofortige eigene Prüfung, Lösungsvorschlag für Standardfälle als Entwurf, Ticket unter Agenten | IMAP |
| Nachfass | `npm run followup` | Angebote ohne Antwort nach 5/10/21 Tagen nachfassen, stoppt bei Antwort/Termin; Akquise per Brief nur als Erinnerung | Cloudflare-Login |
| Termin-Vorbereitung | `npm run termine` | Gesprächsvorlage je Termin in `out/termine/`, Hauptpunkt im Briefing | Kalender unter „Termine“ |
| Heiße Leads | `npm run alert` | neue Anfragen bewerten (läuft alle 10 Min. bei offener Zentrale), Hinweis aufs Handy, WhatsApp-Schnellstart zum Selbst-Senden | Handy-Kanal |
| Website-Wächter | `npm run watch` | Kunden-Websites täglich: Erreichbarkeit, Ladezeit, SSL, Domain, Impressum, defekte Links; Alarm bei Ausfall | – |
| Betreuungsbericht | `npm run report` | Monatsbericht an Betreuungskunden | optional Google |
| Quartals-ROI | `npm run roi` | Besucher, Anrufe, Routen, geschätzter Auftragswert gegen Betreuungskosten (Annahmen je Kunde in `clients.json` → `roi`) | Google |
| KI-Sichtbarkeit | `npm run geo` | fragt eine KI-Suche wie ein Kunde, ob der Betrieb genannt wird | KI |
| Bewertungen | `npm run reviews` | neue Google-Bewertungen, Antwort-Entwurf, veröffentlicht erst nach Freigabe | Google |
| Video-Pitch | `npm run video -- --domain x.de` | Website-Check als Video (Desktop + Handy) mit Sprechtext in `out/video/` | Chrome oder Edge |
| Bank | `npm run bank` | Zahlungseingänge direkt vom Konto für den Monitor | Enable Banking |
| Onboarding | `npm run onboarding` | neue Aufträge aus dem Web-Dashboard als Kunde anlegen, Projektordner `out/kunden/` (Checkliste, Material, Zugänge ohne Passwörter, Projektplan), Willkommensmail als Entwurf | Cloudflare-Login |
| Buchhaltung | `npm run buchhaltung` | Rechnungen und Zahlungen als Buchungssätze: DATEV-Buchungsstapel und Liste in `out/buchhaltung/<Monat>/`; Übergabe an Lexware Office nur auf Klick (`--push`) | optional Lexware |
| Beiträge | `npm run beitraege` | jede Woche ein Beitrag fürs eigene Google-Profil und für LinkedIn mit Bild im Website-Look (`out/beitraege/`); Google nach Freigabe, LinkedIn kopieren und selbst posten | optional Google |
| Marketing | `npm run marketing` · `npm run anzeigenbilder` | Anfragen je Kampagne und Unterseite (Herkunft aus dem Link, `utm_*`), Unterseiten erreichbar?, Bewertungs-Erinnerungen; Anzeigenbilder im Website-Look für Feed und Story in `out/marketing/`. Ansicht „Marketing“ in der Zentrale mit Marke, Kampagnen, Texten und Links zum Kopieren | Cloudflare-Login |

Der Morgenlauf startet von selbst, wenn Sie die Zentrale zum ersten Mal am Tag öffnen, und höchstens einmal am Tag. Ohne Terminal: `npm run schedule:install` richtet die Aufgabe „Kasi Zentrale“ ein (startet die Zentrale beim Anmelden unsichtbar und nach einem Absturz neu) und legt auf dem Desktop die Verknüpfung „Kasi“ an, die Kasi als App-Fenster öffnet. Ausgaben stehen in `data/zentrale.log`, entfernen mit `npm run schedule:remove`.

Buchhaltung: Konten in `data/company.json` → `accounting` (Standard SKR03: Erlöse 8400, Bank 1200, Debitoren ab 10000; für DATEV zusätzlich `datev.consultant` und `datev.client`). Vor der ersten Übergabe einen Probe-Import mit dem Steuerberater machen.

**Einrichtung in `.env`** (alles optional, Stand sehen Sie unter Zentrale → Agenten → Einrichtung):

```
LEXWARE_API_KEY=…                    optional: Übergabe gestellter Rechnungen an Lexware Office (app.lexware.de/addons/public-api)
GOOGLE_OWN_LOCATION=MW IT-SERVICES   optional: eigenes Google-Profil für Beiträge (sonst das mit mw-itservices.de)
ANTHROPIC_API_KEY=sk-ant-…            optional, für später: KI-Entwürfe (console.anthropic.com), vorher DPA abschließen. Ohne Schlüssel arbeiten alle Agenten mit Vorlagen.
HARVEY_MODEL=claude-opus-5-5          optional, Standard für Entwürfe und Recherche
HARVEY_MODEL_FAST=claude-haiku-5-5    optional, Standard für das Einordnen von Mails
WHATSAPP_PHONE=+49176…                Hinweise an Sie selbst per WhatsApp (CallMeBot)
CALLMEBOT_APIKEY=…
NTFY_TOPIC=mw-harvey-…                oder per ntfy-App (langes, geheimes Thema wählen)
HARVEY_NOTIFY_MINIMAL=1               optional: Hinweise ohne Namen
GOOGLE_CLIENT_ID=… / GOOGLE_CLIENT_SECRET=…   Unternehmensprofile und Search Console (Anleitung in core/google.js)
ENABLEBANKING_APP_ID=…                Bank (Anleitung in core/bank.js), Schlüssel als data/enablebanking.pem
ENABLEBANKING_REDIRECT_URL=https://mw-itservices.de/bank-ok
GITHUB_TOKEN=…                        optional, für private Repositories im Projekt-Monitor
```

- **Google:** Ihre Kunden geben Ihrem Google-Konto Verwaltungszugriff auf Unternehmensprofil und Search Console. Für Bewertungen ist beim Google-Unternehmensprofil ein API-Zugang zu beantragen. Danach Zentrale → Agenten → „Google verbinden“.
- **Bank:** GoCardless nimmt keine neuen Konten für Kontodaten mehr an, daher Enable Banking (für eigene Konten kostenlos). Nach `npm run bank -- --connect "<Bank>"` bei der Bank freigeben, die Zieladresse mit `--code` einfügen, oder alles unter Zentrale → Agenten → „Bank verbinden“. Die Freigabe gilt bis zu 180 Tage.
- **Video:** einmalig `npx playwright-core install ffmpeg` (Aufnahme-Baustein von Playwright, schon erledigt). Video und Link per Brief oder beim Besuch übergeben, per Mail nur mit Einwilligung.
- **Datenschutz:** Textbausteine für die Datenschutzerklärung in `DATENSCHUTZ-BAUSTEINE.md`, einfügen, sobald ein Dienst wirklich genutzt wird.

### Akquise

```bash
npm run scout -- --city Augsburg --trades maler,elektriker --limit 15
npm run scout -- --trades-list
npm run scout -- --accept huber-maler.de --contact brief
npm run pipeline                   # Detail-Analyse, Problemcase und Brief je Betrieb
```

Der Scout sucht in **OpenStreetMap** (frei nutzbar, © OpenStreetMap-Mitwirkende, ODbL). Google-Suchergebnisse automatisch auszulesen verstößt gegen deren Bedingungen. Gemessen wird mit derselben Prüfung wie der Live-Check. Ergebnisse stehen in `out/scout/<datum>/` (Markdown und `leads-suggestions.json`).

Kontaktwege nach § 7 UWG: Brief und persönlicher Besuch sind ohne Einwilligung zulässig, Werbe-Mails und -Anrufe nicht. Der Postausgang sperrt Akquise-Mails ohne `einwilligung` oder `bestehend`. Beim ersten Brief den Datenschutzhinweis nach Art. 14 DSGVO beilegen (Link auf mw-itservices.de/datenschutz).

### Rechnungen und Mahnwesen

```bash
npm run billing -- --draft K-1001             # Entwurf aus dem gebuchten Paket
npm run billing -- --monthly                  # Betreuungs-Entwürfe dieses Monats
npm run billing -- --issue E-…                # prüft Pflichtangaben (§ 14 UStG), vergibt Nummer
npm run billing -- --paid RE-2026-001         # Zahlung von Hand eintragen
npm run billing -- --resume RE-2026-001       # pausiertes Mahnwesen fortsetzen
npm run billing -- --import harvey-export.json  # Kunden aus dem Web-Dashboard übernehmen
```

Mahnstufen (Tage seit Rechnungsdatum, nur wenn überfällig, mindestens 7 Tage Abstand, in `company.json` einstellbar):

| Stufe | ab Tag | Ton |
|---|---|---|
| 1 | 14 | freundliche Erinnerung, „im Baustellen-Stress untergegangen“ |
| 2 | 21 | verbindliche Zahlungsaufforderung mit neuem Ziel |
| 3 | 30 | letzte Mahnung mit Verzugszinsen (9 Prozentpunkte über Basiszins, § 288 Abs. 2 BGB) und 40 € Pauschale (§ 288 Abs. 5 BGB), zusätzlich als Brief |

Jeder Lauf schreibt `out/billing/<datum>/` mit Übersicht, Mahnentwürfen und `offene-posten-<datum>.csv` für den Steuerberater (Semikolon, deutsches Zahlenformat; kein DATEV-EXTF-Format). Rechnungen als PDF bitte aus dem Buchhaltungsprogramm versenden und archivieren (GoBD, 10 Jahre).

**Automatischer Mahnstopp:**
- Kontoauszug als CSV in `data/inbox/` legen (oder `--bank datei.csv`). Der Monitor erkennt die Rechnungsnummer im Verwendungszweck, sonst einen eindeutigen Betrag, trägt die Zahlung ein, setzt die Rechnung auf bezahlt und verwirft offene Mahnentwürfe.
- Antwortet ein Kunde mit offener Mahnung (Postfach-Prüfung, nur Absender und Betreff), pausiert das Mahnwesen für ihn, bis Sie es fortsetzen.

## Cloudflare

```bash
npm run cf:deploy        # öffentlicher Prüfdienst (Live-Check, Anfragen, Teaser, Cal.com-Webhook)
npm run dash:deploy      # Web-Dashboard
npm run db:schema        # Tabellen anlegen (neue Datenbank); Änderungen: cloudflare/migrate-*.sql
```

Nach Änderungen an `core/`, `cloudflare/`, `../vis-rules.js` oder `../offer-rules.js` beide neu deployen.

### Web-Dashboard absichern (einmalig, Pflicht)

Das Dashboard bleibt gesperrt, bis Cloudflare Access eingerichtet ist:

1. dash.cloudflare.com → Workers & Pages → **mw-harvey** → Settings → Domains & Routes → bei `workers.dev` **Cloudflare Access aktivieren**.
2. In Zero Trust → Access → Applications die Anwendung öffnen. Unter Policies nur `info@mw-itservices.de` erlauben (Login per E-Mail-Code).
3. Die **Application Audience (AUD)** und die Team-Domain (`https://<team>.cloudflareaccess.com`) in `cloudflare/dashboard/wrangler.toml` bei `ACCESS_AUD` und `ACCESS_TEAM_DOMAIN` eintragen, dann `npm run dash:deploy`.

Der Worker prüft zusätzlich jedes Access-Token selbst (Signatur, Audience, Ablauf).

### Terminbuchung über Cal.com

1. Konto auf cal.com anlegen, Google-Kalender verbinden, Termin-Typ „Erstgespräch (15 Min.)“ anlegen. Cal.com blockiert den Termin dann selbst in Ihrem Kalender.
2. Link in `core/drafts.js` bei `BOOKING_URL` eintragen. Er erscheint dann in allen Mails, Angeboten und Briefen.
3. Webhook in Cal.com (Settings → Developer → Webhooks): URL `https://mw-sichtbarkeit.harvey-agent.workers.dev/webhook/cal`, Ereignisse „Booking created / rescheduled / cancelled“, ein selbst gewähltes Secret.
4. Dasselbe Secret im Worker hinterlegen:
   ```bash
   npx wrangler secret put CAL_WEBHOOK_SECRET --config cloudflare/wrangler.toml
   ```
5. `npm run cf:deploy` und `npm run dash:deploy`.

Bucht jemand, setzt Kasi den passenden Eintrag (gleiche E-Mail) auf „Termin“, legt die Wiedervorlage auf den Termintag und schreibt es in den Verlauf. Unbekannte Buchende werden als neue Anfrage angelegt.

## Daten und Sicherheit

| Ort | Inhalt | Im Repository? |
|---|---|---|
| `data/` | Firmendaten, Kunden, Leads, Rechnungen, Postausgang, Ereignisse, Kalender-Adressen, Google- und Bank-Anmeldung, Bank-Schlüssel, Messwerte der Agenten, Sicherungen | nein |
| `out/` | Briefings, Vorschläge, Mahn- und Rechnungsentwürfe | nein |
| `.env`, `.dev.vars` | Schlüssel und Passwörter | nein |
| Cloudflare D1 `harvey-leads` (EU) | Anfragen aus der Website, Angebote, Verlauf | nein |
| `../reports/*.json` | nur mit `--publish` erzeugte Teaser | ja, öffentlich |
| `data-templates/` | Beispieldaten ohne echte Personen | ja |

- Die lokale Zentrale lauscht nur auf 127.0.0.1, prüft Host und Origin und sendet nur nach Bestätigung im Browser.
- Datensicherung des Web-Dashboards: Link „Datensicherung (JSON)“ in der Seitenleiste.
- Mahntexte, Zinsberechnung und Rechnungsvorlage sind Vorlagen und keine Rechtsberatung. Vor gerichtlichen Schritten Steuerberater oder Anwalt einbeziehen.
