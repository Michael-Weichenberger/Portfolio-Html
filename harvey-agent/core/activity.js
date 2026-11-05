/* =============================================================================
   KASI · Live-Aktivität
   Kurzes Protokoll dessen, was die Zentrale im Hintergrund tut (Läufe,
   Prüfungen, Kalender, Versand). Nur im Speicher, nur für den Ticker.
   Dauerhaftes steht weiter in data/events.json.
   ============================================================================= */
'use strict';

const MAX = 300;
const items = [];
let seq = 0;

function log(level, text) {
    items.push({ seq: ++seq, at: new Date().toISOString(), level: level || 'info', text: String(text).slice(0, 220) });
    if (items.length > MAX) items.splice(0, items.length - MAX);
}

function since(n) {
    const from = Number(n) || 0;
    return { seq, items: items.filter((i) => i.seq > from).slice(-80) };
}

module.exports = { log, since };
