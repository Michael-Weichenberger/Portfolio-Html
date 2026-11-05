-- Herkunft einer Anfrage (Kampagnen-Parameter aus dem Link, z. B. Meta-Anzeige)
-- Anwenden VOR dem Deploy des Workers: npx wrangler d1 execute harvey-leads --remote --file cloudflare/migrate-003-source.sql
ALTER TABLE leads ADD COLUMN source TEXT;            -- JSON {source, medium, campaign, content}
