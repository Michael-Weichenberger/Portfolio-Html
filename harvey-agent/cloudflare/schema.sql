-- Kasi-Dashboard: Anfragen aus dem Website-Test und Akquise-Kontakte
-- Anwenden: npx wrangler d1 execute harvey-leads --remote --file cloudflare/schema.sql
CREATE TABLE IF NOT EXISTS leads (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,                 -- anfrage | paket | akquise
    status      TEXT NOT NULL DEFAULT 'neu',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    email       TEXT,
    consent_at  TEXT,
    report      TEXT,                          -- Report v3 (JSON)
    findings    TEXT,                          -- fehlende Signale (JSON)
    measured_at TEXT,
    subject     TEXT,
    body        TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    published   INTEGER NOT NULL DEFAULT 0,    -- Teaser-Link öffentlich?
    sent_at     TEXT,
    phone       TEXT,
    topic       TEXT,                          -- Thema aus dem Anfrageformular
    message     TEXT,
    selection   TEXT,                          -- Planer-Auswahl (JSON, offer-rules.js)
    follow_up   TEXT,                          -- Wiedervorlage YYYY-MM-DD
    value_once  INTEGER,                       -- Auftragswert netto, einmalig
    value_month INTEGER,                       -- Betreuung netto pro Monat
    won_at      TEXT,
    start_at    TEXT,
    source      TEXT,                          -- Herkunft (Kampagnen-Parameter), JSON
    checklist   TEXT                           -- erledigte Projektschritte (JSON)
);
CREATE INDEX IF NOT EXISTS idx_leads_follow ON leads (follow_up);
CREATE TABLE IF NOT EXISTS activities (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL,
    at      TEXT NOT NULL,
    type    TEXT NOT NULL,
    text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_lead ON activities (lead_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_act_at ON activities (at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_kind_status ON leads (kind, status);

-- Bestehende Datenbank aktualisieren: cloudflare/migrate-*.sql der Reihe nach ausführen.

-- Cookielose Besuchs- und Klick-Zählung (nur Tageszähler)
CREATE TABLE IF NOT EXISTS visits (
    day    TEXT NOT NULL,
    page   TEXT NOT NULL,
    source TEXT NOT NULL,
    event  TEXT NOT NULL,
    n      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, page, source, event)
);
