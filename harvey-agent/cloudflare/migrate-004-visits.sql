-- Cookielose Besuchs- und Klick-Zählung: nur Tageszähler, keine IP, kein Cookie, keine Nutzerkennung
-- Anwenden VOR dem Deploy des Workers: npx wrangler d1 execute harvey-leads --remote --file cloudflare/migrate-004-visits.sql
CREATE TABLE IF NOT EXISTS visits (
    day    TEXT NOT NULL,              -- JJJJ-MM-TT
    page   TEXT NOT NULL,              -- Pfad, z. B. / oder /website-fuer-maler/
    source TEXT NOT NULL,              -- google, instagram, direkt, signatur, … (aus utm_source oder Herkunfts-Seite)
    event  TEXT NOT NULL,              -- view, check, planer, anfrage, tel, mail, whatsapp, instagram, termin
    n      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, page, source, event)
);
