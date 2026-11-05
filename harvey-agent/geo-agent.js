#!/usr/bin/env node
/* =============================================================================
   KASI · KI-Sichtbarkeits-Check (GEO)

   npm run geo                     alle Kunden und MW IT-SERVICES selbst prüfen
   npm run geo -- --client K-1001  nur ein Kunde

   Fragt eine KI-Suche so, wie es ein Kunde tun würde („Elektriker in
   Augsburg, wen kannst du empfehlen?“) und prüft, ob der Betrieb in der
   Antwort oder den Quellen vorkommt. Ergebnis in data/geo.json, der
   Betreuungsbericht zeigt es an.

   Suchanfrage je Kunde in clients.json festlegen:  "geo": { "query": "Maler in Augsburg" }
   sonst leitet Kasi sie aus Gewerk und Ort ab. Braucht ANTHROPIC_API_KEY.
   Kosten: je Anfrage einige Cent (Websuche plus Tokens); monatlich reicht.
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const Store = require('./core/datastore.js');
const AI = require('./core/ai.js');
const Run = require('./core/runlog.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const TRADES = [['maler', 'Maler'], ['elektr', 'Elektriker'], ['zimmer', 'Zimmerei'], ['schrein', 'Schreiner'], ['tischl', 'Tischler'], ['sanit', 'Sanitär- und Heizungsbauer'], ['heizung', 'Heizungsbauer'],
    ['dach', 'Dachdecker'], ['fliesen', 'Fliesenleger'], ['garten', 'Gartenbau'], ['metall', 'Metallbauer'], ['schlosser', 'Schlosser'], ['bau', 'Bauunternehmen'], ['kfz', 'Kfz-Werkstatt'], ['auto', 'Autowerkstatt']];

function queryFor(c, company) {
    if (c.geo && c.geo.query) return c.geo.query;
    const t = (TRADES.find(([k]) => norm(c.trade || c.company).includes(k)) || [null, c.trade || 'Handwerksbetrieb'])[1];
    return t + ' in ' + (c.city || company.city || 'Augsburg');
}

function mentioned(result, c) {
    const text = norm(result.text);
    const domains = (c.domains || []).map((d) => norm(d).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
    const words = norm(c.company).replace(/\b(gmbh|kg|ohg|gbr|e\.?k\.?|ug|inh|und|&|co)\b/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const inSources = result.sources.some((s) => domains.some((d) => norm(s.url).includes(d)));
    const inText = domains.some((d) => text.includes(d)) || (words.length && words.every((w) => text.includes(w)));
    return { mentioned: inSources || inText, inSources, inText };
}

async function check(c, company) {
    const query = queryFor(c, company);
    const r = await AI.search('Ich suche einen ' + query + '. Welche Betriebe kannst du mir empfehlen? Nenne bis zu 8 konkrete Betriebe mit Namen und Website und je einem Satz, warum. Antworte so, wie du es einem Privatkunden antworten würdest.', { maxUses: 4, location: c.city || company.city || 'Augsburg' });
    const m = mentioned(r, c);
    const names = (r.text.match(/\*\*([^*]{3,80})\*\*/g) || []).map((x) => x.replace(/\*\*/g, '').trim()).slice(0, 8);
    return { date: new Date().toISOString().slice(0, 10), query, ...m, competitors: names, sources: r.sources.slice(0, 10).map((s) => s.url) };
}

async function main() {
    Store.ensure();
    if (!AI.available()) {
        console.log('KI-Sichtbarkeit braucht ANTHROPIC_API_KEY in harvey-agent/.env.');
        return Run.done('geo', { ok: false, summary: 'Nicht eingerichtet (ANTHROPIC_API_KEY fehlt)' });
    }
    const company = Store.load('company');
    const geo = Store.load('geo');
    geo.clients = geo.clients || {};
    const own = { id: 'self', company: company.name || 'MW IT-SERVICES', domains: [company.web || 'mw-itservices.de'], city: company.city, geo: { query: 'Webdesign für Handwerker in ' + (company.city || 'Augsburg') } };
    const list = [own, ...Store.load('clients')].filter((c) => !opt('client') || c.id === opt('client'));
    const notes = [];
    let hits = 0;
    for (const c of list) {
        try {
            const r = await check(c, company);
            const g = geo.clients[c.id] = geo.clients[c.id] || { history: [] };
            g.history = g.history.concat(r).slice(-24);
            g.last = r;
            if (r.mentioned) hits++;
            notes.push(c.company + ': ' + (r.mentioned ? 'genannt' : 'nicht genannt') + ' bei „' + r.query + '“');
            console.log((r.mentioned ? '✓ ' : '· ') + c.company + ' · „' + r.query + '“ · ' + (r.mentioned ? 'genannt' + (r.inSources ? ' (als Quelle)' : '') : 'nicht genannt') + (r.competitors.length ? ' · genannt wurden: ' + r.competitors.slice(0, 4).join(', ') : ''));
        } catch (err) { console.log('✗ ' + c.company + ': ' + err.message); notes.push(c.company + ': Fehler ' + err.message); }
    }
    Store.save('geo', geo);
    const summary = hits + ' von ' + list.length + ' Betrieben werden von KI-Assistenten genannt';
    console.log(summary);
    Run.done('geo', { summary, notes });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('geo', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main, mentioned, queryFor };
