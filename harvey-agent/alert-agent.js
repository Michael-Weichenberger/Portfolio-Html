#!/usr/bin/env node
/* =============================================================================
   KASI · Heiße-Lead-Alarm (WhatsApp/SMS an Sie selbst)

   npm run alert                 neue Anfragen bewerten, bei heißen Leads Hinweis aufs Handy
   (läuft außerdem alle 10 Minuten, solange die Zentrale offen ist)

   Bewertet neue Anfragen aus dem Web-Dashboard und neue Scout-Funde:
   Paket-Anfrage, Auftragswert, Leidensdruck der Website, Telefonnummer.
   Ab 60 Punkten: Hinweis an Ihr Handy (core/notify.js) und in der Zentrale
   ein vorbereiteter WhatsApp-Schnellstart. Den öffnen und senden Sie selbst.

   Rechtlich: WhatsApp/Anruf nur bei Personen, die selbst angefragt und ihre
   Nummer angegeben haben. Scout-Funde (Kaltakquise) bekommen keinen
   WhatsApp-Link, nur Brief oder persönlichen Besuch (§ 7 UWG).
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Cloud = require('./core/cloud.js');
const Notify = require('./core/notify.js');
const Events = require('./core/events.js');
const Run = require('./core/runlog.js');
const Offer = require('../offer-rules.js');

const HOT = Number(process.env.HARVEY_HOT_SCORE) || 60;
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (err) { return null; } };

function scoreInbound(r) {
    const why = [];
    let s = r.kind === 'paket' ? 50 : 25; // Paket-Anfrage aus dem Planer: konkreter Kaufwunsch, mit Telefonnummer schon „heiß“
    why.push(r.kind === 'paket' ? 'Paket-Anfrage' : 'Anfrage über den Website-Test');
    const findings = parse(r.findings) || [];
    if (findings.length) { s += Math.min(30, findings.length * 5); why.push(findings.length + ' Schwachstellen auf der Website'); }
    const sel = parse(r.selection);
    if (sel) {
        try { const q = Offer.quote(Offer.normalize(sel)); if (q.once >= 1000) { s += 15; why.push('Auftragswert ' + Offer.euro(q.once)); } } catch (err) { /* ohne Auswahl */ }
    }
    if (r.phone) { s += 10; why.push('Telefonnummer angegeben'); }
    if (r.message && r.message.length > 80) { s += 5; why.push('ausführliche Nachricht'); }
    return { score: Math.min(100, s), why };
}

function latestScout() {
    try {
        const f = JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', 'scout', 'latest.json'), 'utf8')).file;
        return JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', f), 'utf8'));
    } catch (err) { return null; }
}

async function main() {
    Store.ensure();
    const prev = (Run.all().alert || {}).data || {};
    const seen = new Set(prev.seen || []);
    const hot = (prev.hot || []).filter((h) => Date.now() - Date.parse(h.at) < 7 * 86400000); // eine Woche sichtbar
    const fresh = [];
    let cloudOk = true;
    try {
        const since = prev.checkedAt || new Date(Date.now() - 3 * 86400000).toISOString();
        const rows = await Cloud.query("SELECT id, kind, status, name, url, email, phone, message, selection, findings, created_at FROM leads WHERE kind IN ('anfrage','paket') AND created_at > ? ORDER BY created_at", [since]);
        for (const r of rows) {
            if (seen.has('c:' + r.id)) continue;
            seen.add('c:' + r.id);
            const { score, why } = scoreInbound(r);
            const text = 'Guten Tag, hier ist Michael Weichenberger von MW IT-SERVICES. Danke für Ihre Anfrage zu ' + (r.name || 'Ihrer Website') + '. Passt es Ihnen, wenn ich Sie heute kurz anrufe? Wann erreiche ich Sie am besten?';
            const item = { id: 'c:' + r.id, at: r.created_at, name: r.name, url: r.url, score, why, kind: r.kind, inbound: true,
                tel: r.phone ? 'tel:' + String(r.phone).replace(/[^\d+]/g, '') : null, wa: r.phone ? Notify.waLink(r.phone, text) : null, email: r.email };
            fresh.push(item);
        }
    } catch (err) { cloudOk = false; console.log('! Web-Dashboard nicht abrufbar: ' + err.message); }

    const scout = latestScout();
    if (scout) {
        const known = new Set(Store.load('leads').map((l) => l.domain));
        scout.suggestions.filter((s) => s.pain >= 75 && !known.has(s.domain) && !seen.has('s:' + s.domain)).forEach((s) => {
            seen.add('s:' + s.domain);
            fresh.push({ id: 's:' + s.domain, at: scout.createdAt, name: s.name, url: s.url, score: Math.min(100, s.pain), why: ['Scout: Leidensdruck ' + s.pain, ...(s.weaknesses || []).slice(0, 2).map((w) => w.title)], kind: 'scout', inbound: false, tel: null, wa: null });
        });
    }

    const newHot = fresh.filter((f) => f.score >= HOT);
    for (const h of newHot) {
        const r = await Notify.send('Kasi: heißer Lead (' + h.score + ' Punkte)', h.name + ' · ' + h.why.join(', ') + (h.inbound ? '\nJetzt reagieren: Anruf oder WhatsApp aus der Zentrale.' : '\nKaltakquise: Brief oder Besuch, keine Mail/WhatsApp.'), { priority: h.inbound ? 'high' : 'default', url: h.url });
        h.notified = r.sent;
        Events.record('hot_lead', { name: h.name, label: 'Heißer Lead · ' + h.score + ' Punkte', score: h.score });
        console.log('🔥 ' + h.name + ' · ' + h.score + ' Punkte · ' + h.why.join(', ') + (r.sent.length ? ' · gemeldet per ' + r.sent.join(', ') : Notify.channels().length ? ' · Meldung fehlgeschlagen: ' + r.errors.join('; ') : ' · kein Handy-Kanal eingerichtet'));
    }
    const all = [...newHot, ...hot].slice(0, 30);
    const summary = fresh.length + ' neue Leads bewertet, ' + newHot.length + ' heiß' + (Notify.channels().length ? '' : ' (Handy-Hinweis nicht eingerichtet)');
    console.log(summary);
    Run.done('alert', { ok: cloudOk, summary, data: { seen: [...seen].slice(-3000), hot: all, checkedAt: new Date().toISOString() } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
module.exports = { main, scoreInbound };
