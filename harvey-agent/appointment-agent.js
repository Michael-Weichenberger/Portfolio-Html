#!/usr/bin/env node
/* =============================================================================
   KASI · Termin-Vorbereiter

   npm run termine               Termine der nächsten 2 Tage vorbereiten
   npm run termine -- --days 7   weiter vorausschauen

   Findet zu jedem Kalendertermin den passenden Lead oder Kunden (Teilnehmer-
   E-Mail, Firmenname oder Domain im Titel) und schreibt eine Gesprächsvorlage:
   Website-Befund, Potenzial, drei Gesprächspunkte, passendes Paket.
   Ergebnis: out/termine/<datum>-<name>.md, das Briefing nennt den Hauptpunkt.
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Calendar = require('./core/calendar.js');
const Cloud = require('./core/cloud.js');
const AI = require('./core/ai.js');
const Run = require('./core/runlog.js');
const Offer = require('../offer-rules.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const DAYS = Math.max(1, Math.min(14, Number(opt('days')) || 2));
const OUT = path.join(Store.ROOT, 'out', 'termine');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const base = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].toLowerCase();
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (err) { return null; } };
const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 40) || 'termin';

async function candidates() {
    const list = [];
    try {
        (await Cloud.query('SELECT id, kind, status, name, url, email, phone, topic, message, selection, report, findings FROM leads ORDER BY updated_at DESC LIMIT 500'))
            .forEach((r) => list.push({ src: 'Web-Dashboard', name: r.name, domain: base(r.url), email: (r.email || '').toLowerCase(), phone: r.phone, kind: r.kind, status: r.status,
                topic: r.topic, message: r.message, selection: parse(r.selection), report: parse(r.report), findings: parse(r.findings) || [] }));
    } catch (err) { console.log('! Web-Dashboard nicht abrufbar: ' + err.message); }
    const scout = (() => { try { const f = JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', 'scout', 'latest.json'), 'utf8')).file; return JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', f), 'utf8')); } catch (err) { return null; } })();
    Store.load('leads').forEach((l) => {
        const s = scout && scout.suggestions.find((x) => x.domain === l.domain);
        list.push({ src: 'Akquise', name: l.name, domain: l.domain, email: (l.email || '').toLowerCase(), kind: 'akquise', status: l.status,
            findings: s ? s.weaknesses : [], potential: s ? s.potential : null, report: l.total ? { met: l.met, total: l.total } : null });
    });
    Store.load('clients').forEach((c) => list.push({ src: 'Kunde', name: c.company, domain: (c.domains || [])[0] || '', email: (c.email || '').toLowerCase(), kind: 'kunde', package: c.package }));
    return list;
}

function match(ev, list) {
    const title = norm(ev.title + ' ' + ev.location);
    return list.find((c) => c.email && (ev.attendees || []).includes(c.email))
        || list.find((c) => c.domain && title.includes(norm(c.domain.split('.')[0])) && c.domain.split('.')[0].length > 3)
        || list.find((c) => c.name && norm(c.name).length > 3 && title.includes(norm(c.name)));
}

function points(c) {
    const f = (c.findings || []).map((x) => x.title || x).filter(Boolean);
    const pts = f.slice(0, 3).map((t) => 'Befund: ' + t + ', was kostet das den Betrieb an Anfragen?');
    if (c.message) pts.unshift('Sein Anliegen aus der Anfrage aufgreifen: „' + String(c.message).slice(0, 140) + '“');
    if (!pts.length) pts.push('Ziel klären: mehr Anfragen, besseres Bild bei Google oder Entlastung im Alltag?');
    pts.push('Nächster Schritt festmachen: Angebot bis wann, Starttermin, wer liefert Texte und Fotos.');
    return pts.slice(0, 4);
}

function packageHint(c) {
    if (c.kind === 'kunde') return 'Bestandskunde: Betreuung und Zusatzleistungen besprechen (z. B. Google-Unternehmensprofil, Karriere-Seite).';
    const sel = c.selection || { base: (c.findings || []).length > 3 ? 'multipage' : 'starter', care: 'care' };
    try {
        const q = Offer.quote(Offer.normalize(sel));
        return 'Passend: ' + q.lines.map((l) => l.label).join(' + ') + ' · ' + Offer.euro(q.once) + ' einmalig' + (q.month ? ' + ' + Offer.euro(q.month) + '/Monat' : '') + ' netto';
    } catch (err) { return ''; }
}

async function main() {
    Store.ensure();
    fs.mkdirSync(OUT, { recursive: true });
    const agenda = await Calendar.agenda({ days: DAYS + 1, invoices: [] });
    const now = Date.now();
    const events = agenda.events.filter((e) => !e.allDay && e.kind !== 'harvey' && Date.parse(e.start) > now - 3600000 && Date.parse(e.start) < now + DAYS * 86400000);
    const harveyTermine = agenda.events.filter((e) => e.kind === 'harvey' && /^Termin/.test(e.title) && Date.parse(e.start) > now - 3600000 && Date.parse(e.start) < now + DAYS * 86400000);
    const list = await candidates();
    const preps = [];
    for (const ev of [...events, ...harveyTermine]) {
        const c = match(ev, list);
        if (!c) continue;
        const pts = points(c);
        const pkg = packageHint(c);
        let brief = null;
        if (AI.available()) {
            try {
                brief = await AI.write('Erstelle eine knappe Gesprächsvorlage (Stichpunkte, höchstens 150 Wörter) für ein 15-minütiges Erstgespräch mit einem Handwerksbetrieb. Gliederung: Ziel des Gesprächs, drei Fragen an den Kunden, zwei Argumente, nächster Schritt. Nur diese Daten verwenden:\n'
                    + JSON.stringify({ betrieb: c.name, website: c.domain, quelle: c.src, anliegen: c.message || c.topic || null, befunde: (c.findings || []).slice(0, 6).map((x) => x.title || x), signale: c.report ? (c.report.met + '/' + c.report.total) : null, paket: pkg }));
            } catch (err) { console.log('  ! KI: ' + err.message); }
        }
        const when = new Date(ev.start).toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        const file = path.join(OUT, ev.start.slice(0, 10) + '-' + slug(c.name) + '.md');
        fs.writeFileSync(file, [
            '# ' + c.name + ' · ' + when, '',
            '- Quelle: ' + c.src + (c.status ? ' (' + c.status + ')' : ''),
            c.domain ? '- Website: https://' + c.domain : null,
            c.report && c.report.total ? '- Signale: ' + c.report.met + ' von ' + c.report.total : null,
            c.potential ? '- Potenzial: ' + Offer.euro(c.potential.once) + (c.potential.month ? ' + ' + Offer.euro(c.potential.month) + '/Monat' : '') : null,
            pkg ? '- ' + pkg : null, '',
            '## Gesprächspunkte', ...pts.map((p) => '- ' + p), '',
            brief ? '## Vorlage (KI-Entwurf)\n\n' + brief + '\n' : null
        ].filter((x) => x !== null).join('\n'));
        const headline = (c.findings && c.findings[0]) ? (c.findings[0].title || c.findings[0]) : (c.message ? 'sein Anliegen aus der Anfrage' : 'Ziele klären');
        preps.push({ at: ev.start, title: ev.title, name: c.name, headline, file: path.relative(Store.ROOT, file).replace(/\\/g, '/') });
        console.log('✓ ' + when + ' · ' + c.name + ' → ' + path.relative(Store.ROOT, file));
    }
    const summary = preps.length + (preps.length === 1 ? ' Termin' : ' Termine') + ' vorbereitet (' + events.length + ' im Kalender, nächste ' + DAYS + ' Tage)';
    console.log(summary);
    Run.done('appointments', { summary, data: { preps } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('appointments', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main };
