/* =============================================================================
   KASI · Auswertung der Search-Console-Daten
   - Schnelle Gewinne: Suchbegriffe knapp hinter Seite 1 (Position 8 bis 15) mit
     vielen Einblendungen. Etwas mehr Inhalt oder ein besserer Titel bringt sie
     oft nach vorn.
   - Seite 1, aber kaum Klicks: Titel und Beschreibung überzeugen nicht.
   - Vergleich: letzte 28 Tage gegen die 28 Tage davor (gleich lange Zeiträume),
     mit Warnung bei einem deutlichen Einbruch und den betroffenen Seiten.
   Reine Rechenfunktionen ohne Netz, die Daten holt marketing-agent.js.
   ============================================================================= */
'use strict';

// Für einen lokalen Betrieb sind 1.000 Einblendungen (Wert aus großen Shops) zu hoch
const MIN_IMPRESSIONS = Number(process.env.SEO_QUICKWIN_MIN || 30);
const DROP = 0.25;          // ab 25 % weniger Klicks
const DROP_MIN_CLICKS = 10; // erst ab 10 Klicks im Vorzeitraum, sonst ist es Zufall

function quickWins(queries, min = MIN_IMPRESSIONS) {
    return (queries || [])
        .filter((q) => q.position && q.position >= 8 && q.position <= 15 && q.impressions >= min)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10)
        .map((q) => ({ ...q, hint: q.position <= 10 ? 'unten auf Seite 1: Titel und Beschreibung schärfen' : 'Anfang Seite 2: Inhalt zum Begriff ausbauen, intern verlinken' }));
}

/* Seite 1, viele Einblendungen, aber deutlich weniger Klicks als üblich */
function lowCtr(queries, min = MIN_IMPRESSIONS) {
    const expected = (pos) => (pos <= 3 ? 10 : pos <= 5 ? 5 : 2.5); // grobe Erfahrungswerte in %
    return (queries || [])
        .filter((q) => q.position && q.position < 8 && q.impressions >= min && q.ctr < expected(q.position) / 2)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 5);
}

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

function compare(cur, prev, curPages, prevPages) {
    const out = {
        clicks: { now: cur.clicks, before: prev.clicks, change: pct(cur.clicks, prev.clicks) },
        impressions: { now: cur.impressions, before: prev.impressions, change: pct(cur.impressions, prev.impressions) },
        position: { now: cur.position, before: prev.position }
    };
    out.drop = prev.clicks >= DROP_MIN_CLICKS && cur.clicks <= prev.clicks * (1 - DROP);
    // Seiten mit dem größten Verlust an Klicks
    const before = new Map((prevPages || []).map((p) => [p.key, p]));
    const now = new Map((curPages || []).map((p) => [p.key, p]));
    out.losers = [...before.values()]
        .map((p) => ({ page: p.key, before: p.clicks, now: (now.get(p.key) || { clicks: 0 }).clicks }))
        .filter((p) => p.before - p.now >= 3)
        .sort((a, b) => (b.before - b.now) - (a.before - a.now))
        .slice(0, 5);
    return out;
}

module.exports = { quickWins, lowCtr, compare, MIN_IMPRESSIONS };
