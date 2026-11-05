#!/usr/bin/env node
/* =============================================================================
   KASI SCOUT · sucht Betriebe, misst ihre Websites, schlägt die besten vor

   Quelle: OpenStreetMap (Branchen-Tags mit Website) oder eine eigene Liste.
   Gemessen wird mit derselben Prüfung wie der Live-Check (core/analyze.js +
   vis-rules.js). Ergebnis: out/scout/<datum>/ (Markdown + leads-suggestions.json).
   Versendet nichts. Übernehmen in die Akquise-Liste nur mit --accept.

   npm run scout                                   Augsburg, alle Branchen, 12 Messungen
   npm run scout -- --city München --trades maler,elektriker --limit 20
   npm run scout -- --file betriebe.csv            eigene Liste: name;domain;ort;branche
   npm run scout -- --min-pain 50                  nur starker Leidensdruck
   npm run scout -- --accept huber-maler.de [--contact persoenlich]
   npm run scout -- --trades-list                  verfügbare Branchen
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const VisRules = require('../vis-rules.js');
const Store = require('./core/datastore.js');
const Scout = require('./core/scout.js');
const Outbox = require('./core/outbox.js');
const { normalizeTarget, analyzeSite } = require('./core/analyze.js');
require('./harvey-worker.js'); // lädt harvey-agent/.env (PSI_API_KEY)

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes('--' + name);
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(__dirname, 'out', 'scout', TODAY);
const RESCAN_DAYS = 30;

function list(v, fallback) { return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : fallback; }

function readCsv(file) {
    const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return rows.map((l) => l.split(/[;,\t]/).map((s) => s.trim())).filter((c) => c[1] && !/^domain$/i.test(c[1]))
        .map(([name, website, city, trade]) => ({ name: name || website, website, city: city || '', trade: Scout.TRADES[trade] ? trade : null, source: path.basename(file) }));
}

async function pool(items, n, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
    }));
    return out;
}

async function scout() {
    Store.ensure();
    const leads = Store.load('leads');
    const clients = Store.load('clients');
    const cache = Store.load('scout');
    const known = new Set([...leads.map((l) => l.domain), ...clients.flatMap((c) => c.domains || [])]);
    const cities = list(opt('city'), ['Augsburg']);
    const trades = list(opt('trades'), Object.keys(Scout.TRADES)).filter((t) => Scout.TRADES[t]);
    const limit = Number(opt('limit')) || 12;
    const minPain = Number(opt('min-pain')) || 35;
    if (!process.env.PSI_API_KEY) console.log('Hinweis: PSI_API_KEY fehlt in harvey-agent/.env, die Ladezeit wird dann nicht gemessen.');

    // 1. Kandidaten
    let found = [];
    if (opt('file')) found = readCsv(opt('file'));
    else {
        for (const city of cities) {
            process.stdout.write('Suche in ' + city + ' (' + trades.length + ' Branchen, OpenStreetMap) … ');
            const r = await Scout.findBusinesses(city, trades, 100000, (host, why) => process.stdout.write('\n  ' + why + ', versuche nächsten Server … '));
            console.log(r.length + ' Betriebe mit Website');
            found.push(...r);
        }
    }
    const seen = new Set();
    const candidates = [];
    for (const b of found) {
        const t = normalizeTarget(b.website);
        if (!t || seen.has(t.name) || known.has(t.name)) continue;
        seen.add(t.name);
        const c = cache[t.name];
        if (c && !has('fresh') && (Date.parse(TODAY) - Date.parse(c.date)) / 86400000 < RESCAN_DAYS) continue;
        candidates.push({ ...b, target: t });
    }
    const todo = candidates.slice(0, limit);
    console.log(candidates.length + ' neue Kandidaten, ' + todo.length + ' werden gemessen (je bis zu einer Minute) …');

    // 2. Messen und bewerten
    let done = 0;
    const step = () => '  [' + (++done) + '/' + todo.length + '] ';
    const results = await pool(todo, Number(opt('concurrency')) || 2, async (b) => {
        try {
            const site = await analyzeSite(b.target, { psiKey: process.env.PSI_API_KEY, psiTimeoutMs: 90000 });
            if (!site.structure && !site.lighthouse) throw new Error(site.structureError || site.psiError || 'nicht erreichbar');
            const psi = site.lighthouse ? VisRules.metricsFromLighthouse(site.lighthouse) : null;
            const report = VisRules.buildReport({ url: b.target.url, name: b.target.name, psi, structure: site.structure });
            const findings = VisRules.findingsFrom({ psi, structure: site.structure });
            const pain = Scout.painScore(report);
            cache[b.target.name] = { date: TODAY, pain, met: report.met, total: report.total };
            process.stdout.write(step() + (pain >= minPain ? '●' : '·') + ' ' + b.target.name + ' ' + report.met + '/' + report.total + ' · Druck ' + pain + '\n');
            return { b, report, findings, pain };
        } catch (err) {
            cache[b.target.name] = { date: TODAY, error: String(err.message).slice(0, 120) };
            process.stdout.write(step() + '✗ ' + b.target.name + ': ' + String(err.message).slice(0, 80) + '\n');
            return null;
        }
    });
    Store.save('scout', cache);

    // 3. Vorschläge: größter Leidensdruck und Umsatzpotenzial zuerst
    const channel = opt('contact') || 'brief';
    // nur vollständige Messungen (mind. 15 geprüfte Signale) vorschlagen
    const suggestions = results.filter((r) => r && r.pain !== null && r.report.total >= 15 && r.pain >= minPain).map((r) => {
        const pot = Scout.potential(r.report, r.findings);
        const critical = r.findings.filter((f) => f.severity === 3).map((f) => f.title);
        return {
            name: r.b.name, domain: r.b.target.name, url: r.b.target.url, trade: r.b.trade ? Scout.TRADES[r.b.trade].label : '',
            address: [r.b.street, [r.b.zip, r.b.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: r.b.phone, source: r.b.source,
            signals: { met: r.report.met, total: r.report.total }, pain: r.pain,
            points: r.report.points.map((p) => ({ title: p.title, status: p.status, value: p.value })),
            critical, weaknesses: r.findings.slice(0, 6).map((f) => ({ title: f.title, evidence: f.evidence, fix: f.fix })),
            potential: pot, rank: Math.round(r.pain * 0.7 + Math.min(100, pot.yearValue / 60) * 0.3),
            approach: { brief: Scout.approach(r.b, r.report, r.findings, 'brief'), persoenlich: Scout.approach(r.b, r.report, r.findings, 'persoenlich'), bestehend: Scout.approach(r.b, r.report, r.findings, 'bestehend') },
            recommended: channel
        };
    }).sort((a, b) => b.rank - a.rank);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonFile = path.join(OUT_DIR, 'leads-suggestions.json');
    fs.writeFileSync(jsonFile, JSON.stringify({ createdAt: new Date().toISOString(), cities, trades, minPain, attribution: '© OpenStreetMap-Mitwirkende (ODbL)', suggestions }, null, 2));
    fs.writeFileSync(path.join(__dirname, 'out', 'scout', 'latest.json'), JSON.stringify({ file: path.relative(path.join(__dirname, 'out'), jsonFile) }));

    const e = (n) => VisRules.fmt(n, 0) + ' €';
    const md = [
        '# Kundenvorschläge ' + TODAY.split('-').reverse().join('.'),
        '',
        'Gesucht: ' + (opt('file') ? path.basename(opt('file')) : cities.join(', ') + ' · ' + trades.length + ' Branchen') + ' · gemessen: ' + results.filter(Boolean).length + ' · Vorschläge (Druck ≥ ' + minPain + '): ' + suggestions.length,
        '',
        '| # | Betrieb | Branche | Signale | Druck | Potenzial (netto) | Kritisch |',
        '|---:|---|---|---:|---:|---|---|',
        ...suggestions.map((s, i) => '| ' + (i + 1) + ' | ' + s.name + ' (' + s.domain + ') | ' + (s.trade || '–') + ' | ' + s.signals.met + '/' + s.signals.total + ' | ' + s.pain
            + ' | ' + e(s.potential.once) + (s.potential.month ? ' + ' + e(s.potential.month) + '/Mtl.' : '') + ' | ' + (s.critical.join(', ') || '–') + ' |'),
        '',
        ...suggestions.flatMap((s, i) => [
            '## ' + (i + 1) + '. ' + s.name,
            '',
            '- Website: ' + s.url + (s.address ? ' · ' + s.address : '') + (s.phone ? ' · ' + s.phone : ''),
            '- Ampeln: ' + s.points.map((p) => p.title + ' ' + VisRules.STATUS_TEXT[p.status]).join(' · '),
            '- Passt: ' + (s.potential.packages.join(' + ') || '–') + ' (' + s.potential.why.join(', ') + ')',
            '',
            '**Schwachstellen**',
            '',
            ...s.weaknesses.map((w) => '- ' + w.title + ': ' + w.evidence + ' → ' + w.fix),
            '',
            '**Ansatz: ' + s.approach[s.recommended].channel + '**',
            '',
            '> ' + s.approach[s.recommended].note,
            '',
            '```text',
            s.approach[s.recommended].opener,
            '',
            s.approach[s.recommended].text,
            '```',
            '',
            'Übernehmen: `npm run scout -- --accept ' + s.domain + '`',
            ''
        ]),
        '_Daten: © OpenStreetMap-Mitwirkende (ODbL). Kontakt nur nach Ihrer Prüfung; ohne Einwilligung keine Werbe-Mails oder -Anrufe (§ 7 UWG)._'
    ].join('\n');
    const mdFile = path.join(OUT_DIR, '00-vorschlaege.md');
    fs.writeFileSync(mdFile, md + '\n');
    console.log('✓ ' + suggestions.length + ' Vorschläge: ' + path.relative(process.cwd(), mdFile));
}

/* Vorschlag in die Akquise-Liste übernehmen (Ihre Freigabe) */
function accept(domain) {
    const latest = path.join(__dirname, 'out', 'scout', 'latest.json');
    if (!fs.existsSync(latest)) throw new Error('Noch kein Scout-Lauf vorhanden.');
    const file = path.join(__dirname, 'out', JSON.parse(fs.readFileSync(latest, 'utf8')).file);
    const s = JSON.parse(fs.readFileSync(file, 'utf8')).suggestions.find((x) => x.domain === domain);
    if (!s) throw new Error(domain + ' ist nicht in den letzten Vorschlägen.');
    const leads = Store.load('leads');
    if (leads.some((l) => l.domain === domain)) return console.log('· ' + domain + ' steht schon in der Akquise-Liste.');
    const contact = opt('contact') || 'brief';
    leads.push({ domain, name: s.name, city: s.address, trade: s.trade, phone: s.phone, status: 'neu', contactAllowed: contact,
        pain: s.pain, potential: { once: s.potential.once, month: s.potential.month }, source: s.source, addedAt: TODAY, notes: '' });
    Store.save('leads', leads);
    // E-Mail nur bei bestehendem Kontakt oder Einwilligung in den Postausgang
    if (['bestehend', 'einwilligung'].includes(contact) && opt('email')) {
        const a = s.approach.bestehend;
        Outbox.add({ type: 'akquise', to: opt('email'), subject: a.opener, body: a.text, ref: domain, contactAllowed: contact });
        console.log('  Entwurf liegt im Postausgang: npm run send-approval');
    }
    console.log('✓ ' + s.name + ' übernommen (Kontaktweg: ' + contact + '). Detail-Analyse und Brief: npm run pipeline');
}

(async function main() {
    try {
        if (has('trades-list')) return Object.entries(Scout.TRADES).forEach(([k, t]) => console.log(k.padEnd(16) + t.label));
        if (has('accept')) return accept(opt('accept'));
        await scout();
    } catch (err) {
        console.error('✗ ' + err.message);
        process.exitCode = 1;
    }
}());
