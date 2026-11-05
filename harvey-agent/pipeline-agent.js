#!/usr/bin/env node
/* =============================================================================
   KASI PIPELINE · Domain-Scan für die Akquise-Liste (data/leads.json)

   Misst alle Domains, die neu sind oder deren letzte Messung älter als 30 Tage
   ist, und schreibt eine nach Priorität sortierte Liste mit nächstem Schritt
   nach out/pipeline/<datum>.md. Problemcase und Brief je Domain: out/<id>.md.
   Versendet nichts. Der Kontaktweg richtet sich nach contactAllowed (§ 7 UWG).

   npm run pipeline                         fällige Domains messen
   npm run pipeline -- --add huber-maler.de [--name "Maler Huber"] [--city Augsburg]
   npm run pipeline -- --all                alle Domains neu messen
   npm run pipeline -- --limit 5 --publish  höchstens 5, Teaser-Reports erzeugen
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const { normalizeTarget } = require('./core/analyze.js');
const { processTarget } = require('./harvey-worker.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes('--' + name);
const TODAY = new Date().toISOString().slice(0, 10);
const RESCAN_DAYS = Number(opt('days')) || 30;
const CONTACT = {
    einwilligung: 'E-Mail erlaubt (Einwilligung liegt vor)',
    bestehend: 'Bestehender Kontakt: E-Mail oder Anruf',
    persoenlich: 'Persönlich vorbeischauen, Brief mitnehmen',
    brief: 'Brief per Post (keine Werbe-Mail ohne Einwilligung)'
};
const PRIO = { hoch: 0, mittel: 1, niedrig: 2 };

function add() {
    Store.ensure();
    const leads = Store.load('leads');
    const t = normalizeTarget(opt('add'));
    if (!t) { console.error('✗ Keine gültige öffentliche Domain: ' + opt('add')); process.exit(1); }
    if (leads.some((l) => l.domain === t.name)) return console.log('· ' + t.name + ' steht schon in der Liste.');
    leads.push({ domain: t.name, name: opt('name') || t.name, city: opt('city') || '', trade: opt('trade') || '', status: 'neu', contactAllowed: opt('contact') || 'brief', notes: '', addedAt: TODAY });
    Store.save('leads', leads);
    console.log('✓ ' + t.name + ' aufgenommen. Messen: npm run pipeline');
}

function due(l) {
    if (has('all')) return true;
    if (['kunde', 'abgelegt'].includes(l.status)) return false;
    if (!l.lastScan) return true;
    return (Date.parse(TODAY) - Date.parse(l.lastScan)) / 86400000 >= RESCAN_DAYS;
}

async function run() {
    const created = Store.ensure();
    if (created.length) console.log('Angelegt in data/: ' + created.join(', '));
    const leads = Store.load('leads');
    if (!leads.length) return console.log('data/leads.json ist leer. Domain aufnehmen: npm run pipeline -- --add huber-maler.de');
    if (!process.env.PSI_API_KEY && !fs.existsSync(path.join(__dirname, '.env'))) console.log('Hinweis: PSI_API_KEY fehlt (harvey-agent/.env).');

    const limit = Number(opt('limit')) || Infinity;
    const todo = leads.filter(due).slice(0, limit);
    console.log('Pipeline ' + TODAY + ': ' + todo.length + ' von ' + leads.length + ' Domains werden gemessen …');
    for (const l of todo) {
        try {
            const r = await processTarget(l.domain, { publish: has('publish'), json: false });
            Object.assign(l, {
                lastScan: TODAY, status: l.status === 'neu' ? 'gemessen' : l.status,
                met: r.teaser.met, total: r.teaser.total, priority: r.case.priority, headline: r.case.headline,
                caseFile: 'out/' + r.target.id + '.md', teaserId: r.published ? r.target.id : l.teaserId || null,
                topFindings: r.case.topFindings.map((x) => x.title)
            });
        } catch (err) {
            l.lastError = err.message;
            l.lastScan = TODAY;
            console.error('✗ ' + l.domain + ': ' + err.message);
        }
        Store.save('leads', leads); // nach jeder Domain sichern, falls der Lauf abbricht
    }

    const ranked = leads.filter((l) => l.priority && !['kunde', 'abgelegt'].includes(l.status))
        .sort((a, b) => (PRIO[a.priority] - PRIO[b.priority]) || ((a.met / a.total) - (b.met / b.total)));
    const dir = path.join(__dirname, 'out', 'pipeline');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, TODAY + '.md');
    fs.writeFileSync(file, [
        '# Akquise-Pipeline ' + TODAY.split('-').reverse().join('.'),
        '',
        todo.length + ' Domains gemessen, ' + ranked.length + ' in der Liste. Reihenfolge: Priorität, dann schwächste Seite zuerst.',
        '',
        '| # | Betrieb | Ort | Signale | Priorität | Kontaktweg | Briefing |',
        '|---:|---|---|---:|---|---|---|',
        ...ranked.map((l, i) => '| ' + (i + 1) + ' | ' + l.name + ' (' + l.domain + ') | ' + (l.city || '–') + ' | ' + l.met + '/' + l.total + ' | ' + l.priority + ' | '
            + (CONTACT[l.contactAllowed] || CONTACT.brief) + ' | ' + l.caseFile + (l.teaserId ? ' · Teaser: https://mw-itservices.de/?check=' + l.teaserId : '') + ' |'),
        '',
        '## Nächste Schritte',
        '',
        ...ranked.slice(0, 5).map((l) => '- **' + l.name + '**: ' + l.headline + ' Größte Hebel: ' + (l.topFindings || []).join(', ') + '.'),
        '',
        '_Teaser-Links entstehen nur mit `--publish` und werden erst nach Commit und Push öffentlich. Status in data/leads.json pflegen: neu, gemessen, angeschrieben, termin, kunde, abgelegt._'
    ].join('\n') + '\n');
    console.log('✓ Liste: ' + path.relative(process.cwd(), file));
}

if (has('add')) add();
else run().catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
