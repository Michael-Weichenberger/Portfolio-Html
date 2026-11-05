# Datenschutz-Bausteine für die neuen Agenten

Erst einfügen, wenn der jeweilige Dienst wirklich eingerichtet ist (Schlüssel in `.env`). Ort: `datenschutz.html`, Abschnitt 04 unter dem Absatz zur Kundenverwaltung, oder als eigener Abschnitt „Kommunikation mit Kunden und Interessenten“. Vor dem Veröffentlichen von Steuerberater oder Datenschutz-Anwalt gegenlesen lassen. Die Texte sind Vorlagen und keine Rechtsberatung.

## KI-gestützte Entwürfe (Anthropic)

> Antworten auf Ihre Nachrichten, Nachfragen zu Angeboten und Gesprächsvorlagen bereite ich teilweise mit Unterstützung eines KI-Dienstes vor (Anthropic, PBC, San Francisco, USA; Anschrift aus dem aktuellen Impressum von Anthropic übernehmen). Dabei wird nur der Inhalt übermittelt, der für den Entwurf nötig ist, etwa der Text Ihrer Nachricht und der Name Ihres Betriebs. Ich prüfe jeden Entwurf und versende ihn persönlich; es findet keine automatisierte Entscheidung statt. Grundlage ist ein Auftragsverarbeitungsvertrag mit Anthropic; für die Übermittlung in die USA gelten die EU-Standardvertragsklauseln. Anthropic verwendet die Daten nach eigenen Angaben nicht zum Training seiner Modelle. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, bei allgemeinen Anfragen Art. 6 Abs. 1 lit. f DSGVO.

Vorher: Auftragsverarbeitungsvertrag (DPA) in der Anthropic-Konsole abschließen; Angaben zu Sitz, DPA und Datenübermittlung mit den aktuellen Bedingungen abgleichen.

## Website-Betreuung (Website-Wächter, Berichte, Google)

> Für Kunden mit Betreuungsvertrag prüfe ich die betreute Website täglich automatisch auf Erreichbarkeit, Ladezeit, gültiges Sicherheitszertifikat und defekte Links. Mit Ihrer Zustimmung rufe ich außerdem Kennzahlen aus Ihrer Google Search Console und Ihrem Google-Unternehmensprofil ab (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland), um Ihnen monatlich und vierteljährlich einen Bericht zu senden, und bereite Antworten auf Bewertungen vor, die ich erst nach Ihrer Freigabe veröffentliche. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Betreuungsvertrag).

Im Betreuungsvertrag regeln: Verwaltungszugriff auf Unternehmensprofil und Search Console, Freigabe von Bewertungsantworten.

## Zahlungsabgleich (Enable Banking)

> Zahlungseingänge auf meinem Geschäftskonto gleiche ich automatisch mit offenen Rechnungen ab. Dafür nutze ich den Kontoinformationsdienst Enable Banking Oy (Finnland; Anschrift aus dem Impressum von Enable Banking übernehmen), der nur lesend auf mein Konto zugreift. Verarbeitet werden Betrag, Datum, Verwendungszweck und der Name des Zahlenden. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO (Vertragserfüllung, Buchführungspflichten).

## Hinweise aufs Handy (CallMeBot, ntfy)

Die Hinweise gehen nur an Sie selbst, enthalten aber den Namen des Betriebs. Wenn Sie das vermeiden wollen, in `.env` `HARVEY_NOTIFY_MINIMAL=1` setzen: Dann steht im Hinweis nur „Neuer Hinweis, Details in der Zentrale.“

## Video-Pitch und Erstkontakt

Kein Baustein für die Website nötig. Beim ersten Brief an einen Betrieb aus dem Scout weiterhin den Datenschutzhinweis nach Art. 14 DSGVO beilegen (Herkunft der Daten: OpenStreetMap, öffentliche Website).

## Buchhaltung (Lexware Office, Steuerberater)

> Rechnungsdaten (Rechnungsnummer, Datum, Beträge, Firmenname) übermittle ich zur Buchführung an meinen Steuerberater und, sofern genutzt, an die Buchhaltungssoftware Lexware Office (Haufe-Lexware GmbH & Co. KG, Freiburg; Anschrift aus dem Impressum von Lexware übernehmen). Rechtsgrundlage ist Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit § 147 AO und § 257 HGB (Aufbewahrungspflichten).

Vorher: Auftragsverarbeitungsvertrag mit Lexware abschließen (in den Lexware-Einstellungen). Der DATEV-Export bleibt lokal, bis Sie ihn dem Steuerberater geben.

## Support-Tickets und Onboarding

Kein neuer Dienst: Mails von Kunden werden lokal eingeordnet (mit KI nur, wenn der Baustein „KI-gestützte Entwürfe“ aktiv ist). Der Abschnitt zur Kundenverwaltung deckt das ab.
