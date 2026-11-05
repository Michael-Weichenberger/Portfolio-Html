#!/usr/bin/env node
/* =============================================================================
   KASI WORKER · lokaler Sichtbarkeits-Agent für MW IT-SERVICES

   Misst eine Website (Google PageSpeed + Strukturanalyse aus core/analyze.js)
   und bewertet sie mit der gemeinsamen Signal-Checkliste aus ../vis-rules.js.
   Daraus entstehen:
     1. out/<id>.json   vollständiger Problemcase (intern, nicht veröffentlichen)
     2. out/<id>.md     derselbe Case als lesbares Briefing
     3. reports/<id>.json  Teaser für die Website (nur mit --publish),
        aufrufbar unter https://mw-itservices.de/?check=<id>#sichtbarkeit

   Aufruf:
     node harvey-worker.js huber-maler.de
     node harvey-worker.js huber-maler.de https://www.beispiel.de --publish
     node harvey-worker.js --list domains.txt --publish
     node harvey-worker.js huber-maler.de --json     (nur JSON auf stdout)

   Schlüssel: PSI_API_KEY in harvey-agent/.env oder als Umgebungsvariable.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VisRules = require('../vis-rules.js');
const { normalizeTarget, analyzeSite } = require('./core/analyze.js');
const Drafts = require('./core/drafts.js');

// harvey-agent/.env einlesen (z. B. PSI_API_KEY=...). Liegt in .gitignore, kommt nie ins Repository.
(function loadEnv() {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
}());

const OUT_DIR = path.join(__dirname, 'out');
const REPORT_DIR = path.join(__dirname, '..', 'reports');
const { AREA } = Drafts;
const { fmt } = VisRules;

function makeId(name) {
    // Nicht erratbare ID, damit Teaser-Reports nicht durchprobiert werden können.
    const hash = crypto.randomBytes(4).toString('hex');
    return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60) + '-' + hash;
}

function diagnosisMd(g) {
    if (!g) return [];
    const st = g.stack || {};
    const tech = [st.cms ? st.cms + (st.version ? ' ' + st.version : '') : 'kein bekanntes CMS erkannt', st.theme ? 'Theme ' + st.theme : null, st.builder ? 'Page-Builder ' + st.builder : null,
        st.plugins && st.plugins.length ? 'Plugins (sichtbar): ' + st.plugins.join(', ') : null, st.cachePlugin ? 'Cache: ' + st.cachePlugin : null, st.server ? 'Server: ' + st.server : null].filter(Boolean);
    return [
        ...(g.pain && g.pain.level !== 'ok' ? ['## Schmerzpunkt', '', '**' + g.pain.headline + '**', '', g.pain.text, '', ...(g.pain.cause ? [g.pain.cause, ''] : [])] : []),
        '## Technik', '', '- ' + tech.join('\n- '), '',
        '## Technische Ursachen', '',
        ...(g.causes.length ? ['| Gewicht | Ursache | Beleg | Lösung |', '|---|---|---|---|', ...g.causes.map((c) => '| ' + '●'.repeat(c.sev) + ' | ' + c.title + ' | ' + c.evidence + ' | ' + c.fix + ' |')] : ['Keine technischen Bremsen gefunden.']),
        ''
    ];
}

function toMarkdown(r) {
    const c = r.case;
    const t = r.teaser;
    const rows = r.findings.map((x) => '| ' + '●'.repeat(x.severity) + ' | ' + AREA[x.area] + ' | ' + x.title + ' | ' + x.evidence + ' | ' + x.fix + ' |').join('\n');
    const pts = t.points.map((p) => '- **' + p.title + '**: ' + VisRules.STATUS_TEXT[p.status] + ' (' + p.value + ')' + (p.open ? ' · offen im Teaser' : ''));
    return [
        '# Problemcase: ' + r.target.name,
        '',
        '*Gemessen am ' + new Date(r.measuredAt).toLocaleString('de-DE') + ' · Priorität ' + c.priority + '*',
        '',
        '**' + c.headline + '**',
        '',
        c.summary,
        '',
        '- Signale: **' + (t.total ? t.met + ' von ' + t.total : 'offen') + '** · ' + t.headline,
        ...pts,
        r.psi ? '- PageSpeed: Performance ' + r.psi.performance + '/100, SEO ' + r.psi.seo + '/100' : '- PageSpeed: nicht gemessen (' + r.psiError + ')',
        r.structure ? '- Server-Antwort ' + fmt(r.structure.ttfbMs / 1000, 1) + ' s, HTML ' + r.structure.htmlKB + ' KB, ' + r.structure.words + ' Wörter, ' + r.structure.internalPages + ' Unterseiten' : '- Strukturanalyse: nicht möglich (' + r.structureError + ')',
        '- Teaser-Link: ' + c.teaserLink + (r.published ? '' : ' (noch nicht veröffentlicht, mit --publish erzeugen)'),
        '',
        ...diagnosisMd(r.teaser && r.teaser.diagnosis),
        '## Fehlende Signale',
        '',
        '| Schwere | Bereich | Befund | Beleg | Lösung |',
        '|---|---|---|---|---|',
        rows || '| – | – | Keine Befunde | – | – |',
        '',
        '## Gesprächseinstieg',
        '',
        '> ' + c.callOpener,
        '',
        '## Anschreiben (Brief oder bestehender Kontakt)',
        '',
        '```',
        c.letter,
        '```',
        '',
        '## Rechtlicher Hinweis',
        '',
        c.compliance,
        ''
    ].join('\n');
}

async function processTarget(raw, opts) {
    const base = normalizeTarget(raw);
    if (!base) throw new Error('Keine gültige öffentliche Domain: ' + raw);
    const target = { ...base, id: makeId(base.name) };
    const measuredAt = new Date().toISOString();
    const log = (m) => { if (!opts.json) process.stderr.write('  ' + m + '\n'); };

    log('→ ' + target.name + ': Struktur und PageSpeed werden gemessen …');
    const site = await analyzeSite(target, { psiKey: process.env.PSI_API_KEY });
    if (!site.structure && !site.lighthouse) throw new Error(target.name + ' nicht messbar: ' + (site.structureError || site.psiError));
    if (!site.lighthouse) log('! PageSpeed nicht verfügbar (' + String(site.psiError).slice(0, 80) + ').');
    if (!site.structure) log('! Strukturanalyse nicht möglich (' + String(site.structureError).slice(0, 80) + ').');

    const psi = site.lighthouse ? VisRules.metricsFromLighthouse(site.lighthouse) : null;
    const st = site.structure;
    const teaser = VisRules.buildReport({ id: target.id, url: target.url, name: target.name, measuredAt, psi, structure: st,
        source: psi && st ? 'Google PageSpeed und Strukturanalyse' : psi ? 'Google PageSpeed Insights' : 'Strukturanalyse' });
    const findings = VisRules.findingsFrom({ psi, structure: st });
    const result = {
        target, measuredAt, psi, psiError: site.psiError, structure: st, structureError: site.structureError,
        findings, case: Drafts.buildCase(target, teaser, findings, psi, fmt), teaser, published: false
    };

    if (opts.publish) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(REPORT_DIR, target.id + '.json'), JSON.stringify(teaser, null, 2));
        result.published = true;
    }
    if (!opts.json) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, target.id + '.json'), JSON.stringify(result, null, 2));
        fs.writeFileSync(path.join(OUT_DIR, target.id + '.md'), toMarkdown(result));
        log('✓ ' + (teaser.total ? teaser.met + '/' + teaser.total + ' Signale' : 'unvollständig') + ' · Priorität ' + result.case.priority + ' · out/' + target.id + '.md' + (result.published ? ' · reports/' + target.id + '.json' : ''));
    }
    return result;
}

async function main() {
    const args = process.argv.slice(2);
    const opts = { publish: args.includes('--publish'), json: args.includes('--json') };
    let targets = args.filter((a) => !a.startsWith('--'));
    const li = args.indexOf('--list');
    if (li >= 0) {
        const file = args[li + 1];
        targets = targets.filter((t) => t !== file);
        targets.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
    }
    if (!targets.length) {
        console.error('Aufruf: node harvey-worker.js <domain> [weitere …] [--list datei.txt] [--publish] [--json]');
        process.exit(1);
    }
    if (!process.env.PSI_API_KEY && !opts.json) console.error('Hinweis: PSI_API_KEY fehlt (harvey-agent/.env), PageSpeed wird dann meist abgelehnt.\n');

    const results = [];
    let failed = 0;
    for (const t of targets) {
        try {
            results.push(await processTarget(t, opts));
        } catch (err) {
            failed++;
            console.error('✗ ' + err.message);
        }
    }
    if (opts.json) process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
    else if (results.length > 1) {
        console.error('\nÜbersicht nach Priorität:');
        results.sort((a, b) => (a.teaser.ratio ?? 1) - (b.teaser.ratio ?? 1))
            .forEach((r) => console.error('  ' + r.case.priority.padEnd(8) + r.target.name.padEnd(32) + r.case.headline));
    }
    process.exitCode = failed && !results.length ? 1 : 0;
}

if (require.main === module) main();
module.exports = { processTarget };
