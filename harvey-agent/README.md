# Harvey-Agent

Misst Websites (Google PageSpeed + eigene Strukturanalyse) und bewertet sie mit einer strengen Checkliste aus über 30 Sichtbarkeits-Signalen. Daraus entstehen ein Problemcase für die Akquise und ein Teaser-Report für den Sichtbarkeits-Check auf mw-itservices.de.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `../vis-rules.js` | **Einzige Stelle für die Bewertung**: Signale, Schwellen, Ampeln, die 4 Kernpunkte, `OPEN_COUNT` |
| `core/analyze.js` | Messung ohne Abhängigkeiten: HTML, Schema.org, robots.txt, llms.txt, HTTPS, PageSpeed |
| `harvey-worker.js` | Lokaler Agent (Kommandozeile) |
| `cloudflare/worker.mjs` | Derselbe Test als Dienst für den Live-Check auf der Website |

## Lokal nutzen

`harvey-agent/.env` anlegen (steht in `.gitignore`):

```
PSI_API_KEY=AIza…   (PageSpeed-Schlüssel ohne Website-Beschränkung)
```

```bash
node harvey-worker.js huber-maler.de
node harvey-worker.js huber-maler.de beispiel-elektro.de --publish
node harvey-worker.js --list domains.txt --publish
node harvey-worker.js huber-maler.de --json
```

| Ausgabe | Inhalt | Öffentlich? |
|---|---|---|
| `out/<id>.md` | Problemcase: fehlende Signale mit Beleg und Lösung, Gesprächseinstieg, Anschreiben | nein (`.gitignore`) |
| `out/<id>.json` | Alle Rohdaten und der Case | nein |
| `../reports/<id>.json` | Teaser (Report v3): 4 Kernpunkte, 2 offen, 2 geblurrt, nur mit `--publish` | ja, nach Commit und Push |

Teaser-Link: `https://mw-itservices.de/?check=<id>#sichtbarkeit`. Die ID enthält einen Zufallsanteil.

## Cloudflare Worker (Live-Check)

Ohne Worker kann der Live-Check im Browser nur PageSpeed abfragen; fremde Seiten selbst darf der Browser nicht lesen. Der Worker führt die volle Prüfung aus.

1. Kostenloses Konto auf [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) anlegen.
2. Im Ordner `harvey-agent`:
   ```bash
   npx wrangler login
   npx wrangler secret put PSI_API_KEY --config cloudflare/wrangler.toml
   npm run cf:deploy
   ```
   Beim Secret den Agent-Schlüssel eingeben. Die Ausgabe nennt die Adresse, z. B. `https://mw-sichtbarkeit.<konto>.workers.dev`.
3. In `../script.js` eintragen: `const ANALYZE_ENDPOINT = 'https://mw-sichtbarkeit.<konto>.workers.dev/analyze';`
4. In `../index.html` in der CSP `https://*.workers.dev` durch die genaue Worker-Adresse ersetzen.

Aktuell deployt: `https://mw-sichtbarkeit.harvey-agent.workers.dev/analyze` (Konto info@mw-itservices.de). Nach Code-Änderungen an `core/`, `cloudflare/` oder `../vis-rules.js` erneut `npm run cf:deploy`.

Schutz im Worker: nur Anfragen von `ALLOWED_ORIGINS`, keine IP-Adressen oder internen Hosts, 10 Messungen pro Minute und IP, Ergebnis 6 Stunden im Cache.

## Rechtlicher Rahmen

Werbe-E-Mails an Betriebe ohne vorherige Einwilligung sind nach § 7 UWG unzulässig, Werbeanrufe bei Betrieben nur bei mutmaßlicher Einwilligung. Das Anschreiben ist für Brief, persönlichen Kontakt oder bestehende Kontakte gedacht.
