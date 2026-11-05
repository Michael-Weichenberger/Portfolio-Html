/* =============================================================================
   KASI · Stand der Agenten (data/agents.json)
   Jeder Agent meldet hier nach seinem Lauf Zeit, Ergebnis und offene Punkte.
   Die Zentrale zeigt das unter „Agenten“, das Briefing liest die Hinweise vor.
   ============================================================================= */
'use strict';

const Store = require('./datastore.js');

function all() { const s = Store.load('agents'); return s && typeof s === 'object' ? s : {}; }

function done(id, { ok = true, summary = '', notes = [], data } = {}) {
    const s = all();
    s[id] = { lastRun: new Date().toISOString(), ok, summary: String(summary).slice(0, 300), notes: notes.slice(0, 20).map((n) => String(n).slice(0, 240)), ...(data !== undefined ? { data } : {}) };
    Store.save('agents', s);
    return s[id];
}

module.exports = { all, done };
