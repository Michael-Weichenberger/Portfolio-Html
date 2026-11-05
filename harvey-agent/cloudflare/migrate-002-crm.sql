-- Wiedervorlage, Auftragswerte, Projekt-Checkliste, Verlauf
ALTER TABLE leads ADD COLUMN follow_up TEXT;      -- Datum YYYY-MM-DD
ALTER TABLE leads ADD COLUMN value_once INTEGER;  -- Auftragswert netto, einmalig
ALTER TABLE leads ADD COLUMN value_month INTEGER; -- Betreuung netto pro Monat
ALTER TABLE leads ADD COLUMN won_at TEXT;
ALTER TABLE leads ADD COLUMN start_at TEXT;       -- Projektstart / Vertragsbeginn
ALTER TABLE leads ADD COLUMN checklist TEXT;      -- erledigte Schritte (JSON-Liste)
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
