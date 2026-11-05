-- Termine aus Cal.com (Webhook), damit Kasi Buchung, Verschiebung und Absage sauber nachvollzieht
-- Anwenden VOR dem Deploy des Workers: npx wrangler d1 execute harvey-leads --remote --file cloudflare/migrate-005-bookings.sql
CREATE TABLE IF NOT EXISTS bookings (
    uid          TEXT PRIMARY KEY,          -- Cal.com-Buchungs-UID
    lead_id      TEXT,                      -- zugeordnete Anfrage
    status       TEXT NOT NULL,             -- gebucht | verschoben | abgesagt
    start_at     TEXT,                      -- ISO
    end_at       TEXT,
    title        TEXT,
    name         TEXT,
    email        TEXT,
    location     TEXT,                      -- Adresse oder Video-Link
    notes        TEXT,                      -- Angaben des Kunden bei der Buchung
    replaced_by  TEXT,                      -- neue UID nach Verschiebung
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    handled_at   TEXT                       -- von Kasi verarbeitet (Vorlage, Entwurf)
);
CREATE INDEX IF NOT EXISTS idx_bookings_open ON bookings (handled_at, updated_at);
