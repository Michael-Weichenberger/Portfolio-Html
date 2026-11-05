#!/usr/bin/env node
/* =============================================================================
   KASI · Video-Pitch (personalisierter Website-Check als Video)

   npm run video -- --domain huber-maler.de
   npm run video -- --top 3          die drei Scout-Vorschläge mit dem größten Leidensdruck

   Nimmt die Website des Betriebs mit Ihrem lokalen Chrome bzw. Edge auf
   (Desktop und Handy) und blendet die gemessenen Schwachstellen direkt im
   Bild ein: Ladezeit, fehlendes Impressum/Datenschutz, Darstellung am Handy.
   Ergebnis in out/video/<domain>/:
     pitch-desktop.webm, pitch-handy.webm   ohne Ton, zum Hochladen (z. B. Loom, YouTube „nicht gelistet“)
     sprechtext.md                          Text zum Einsprechen und Briefbaustein mit Link

   Rechtlich: Video und Link per Brief (QR/Link) oder beim Besuch übergeben.
   Per Mail nur mit Einwilligung oder bestehendem Kontakt (§ 7 UWG).
   Browser-Pfad optional in .env: HARVEY_BROWSER=C:\…\chrome.exe
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Run = require('./core/runlog.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const OUT = path.join(Store.ROOT, 'out', 'video');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browserPath() {
    const list = [process.env.HARVEY_BROWSER,
        'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
    const p = list.find((x) => fs.existsSync(x));
    if (!p) throw new Error('Kein Chrome oder Edge gefunden. Pfad in .env als HARVEY_BROWSER eintragen.');
    return p;
}

function scoutData(domain) {
    try {
        const f = JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', 'scout', 'latest.json'), 'utf8')).file;
        return JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', f), 'utf8')).suggestions.find((s) => s.domain === domain) || null;
    } catch (err) { return null; }
}

/* Einblendung im Stil von MW IT-SERVICES, im Shadow-DOM (stört die Seite nicht) */
const OVERLAY = ({ title, line, step }) => {
    let host = document.getElementById('mw-pitch');
    if (!host) {
        host = document.createElement('div');
        host.id = 'mw-pitch';
        host.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:2147483647;pointer-events:none';
        document.documentElement.appendChild(host);
        host.attachShadow({ mode: 'open' });
    }
    host.shadowRoot.innerHTML = '<style>.b{margin:0 auto 18px;max-width:min(92vw,760px);background:linear-gradient(180deg,rgba(45,32,24,.96),rgba(22,17,14,.97));color:#F4F0E8;border:1px solid rgba(223,154,103,.55);border-radius:16px;padding:14px 18px;font:500 15px/1.45 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.45);animation:i .5s cubic-bezier(.16,1,.3,1)}.k{font:600 11px/1 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#DF9A67;margin-bottom:6px}.t{font:500 21px/1.2 Palatino,Georgia,serif;margin-bottom:4px}@keyframes i{from{opacity:0;transform:translateY(12px)}}</style>'
        + '<div class="b"><div class="k">MW IT-SERVICES · Website-Check' + (step ? ' · ' + step : '') + '</div><div class="t"></div><div class="l"></div></div>';
    host.shadowRoot.querySelector('.t').textContent = title;
    host.shadowRoot.querySelector('.l').textContent = line;
};
const MARK = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid #DF9A67';
    el.style.outlineOffset = '4px';
    return true;
};

async function scene(page, title, line, step, ms) { await page.evaluate(OVERLAY, { title, line, step }); await sleep(ms || 3200); }
async function scroll(page, steps) {
    for (let i = 0; i < steps; i++) { await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' })); await sleep(900); }
}

async function record(browser, url, dir, mobile, facts) {
    const size = mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile, bypassCSP: true, locale: 'de-DE',
        userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
        recordVideo: { dir, size } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    const loadS = ((Date.now() - t0) / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find((x) => /^(alle )?(akzeptieren|zustimmen|ablehnen|nur notwendige)/i.test((x.textContent || '').trim())); if (b) b.click(); }).catch(() => {});
    if (!mobile) {
        await scene(page, 'Website-Check für ' + facts.name, 'Ich habe mir Ihre Website ' + facts.domain + ' angesehen. Hier sind die Punkte, die Ihnen gerade Anfragen kosten.', '1', 4200);
        await scene(page, 'Ladezeit: ' + loadS + ' Sekunden', facts.lcp ? 'Google misst am Handy ' + facts.lcp + ' s bis der Hauptinhalt steht. Ab 2,5 s springen viele Besucher ab.' : 'Gemessen beim Öffnen gerade eben. Ab 2,5 Sekunden springen viele Besucher ab.', '2');
        await scroll(page, 3);
        for (const w of facts.weaknesses.slice(0, 3)) await scene(page, w, 'Gefunden bei der Messung Ihrer Seite.', '3', 2800);
        const imp = await page.evaluate(MARK, 'a[href*="impressum" i], a[href*="imprint" i]').catch(() => false);
        await scene(page, imp ? 'Impressum ist verlinkt' : 'Kein Impressum-Link gefunden', imp ? 'Gut gelöst, das ist Pflicht für gewerbliche Websites.' : 'Ein fehlendes Impressum ist abmahnfähig (§ 5 DDG). Das lässt sich schnell beheben.', '4');
        const dsg = await page.evaluate(MARK, 'a[href*="datenschutz" i], a[href*="privacy" i]').catch(() => false);
        if (!dsg) await scene(page, 'Keine Datenschutzerklärung verlinkt', 'Pflicht nach DSGVO, sobald Sie z. B. ein Kontaktformular oder Google Maps nutzen.', '4');
        await scene(page, 'Das lässt sich lösen', 'Ich zeige Ihnen in 15 Minuten, was davon sich für Ihren Betrieb wirklich lohnt. Michael Weichenberger · mw-itservices.de', '5', 4500);
    } else {
        await scene(page, 'So sieht Ihre Seite am Handy aus', 'Die meisten Ihrer Besucher kommen mit dem Smartphone.', 'Handy', 3500);
        await scroll(page, 4);
        const tiny = await page.evaluate(() => [...document.querySelectorAll('p, li, a')].slice(0, 200).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).length).catch(() => 0);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4).catch(() => false);
        await scene(page, wide ? 'Seite ist breiter als der Bildschirm' : tiny > 20 ? 'Viel sehr kleine Schrift' : 'Darstellung am Handy', wide ? 'Besucher müssen seitlich wischen, das wirkt unfertig.' : tiny > 20 ? 'Viele Texte sind kleiner als 14 Pixel und schwer lesbar.' : 'Die Seite passt sich an, prüfen Sie Ladezeit und Kontakt-Knopf.', 'Handy');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })).catch(() => {});
        await sleep(1200);
    }
    const video = page.video();
    await ctx.close();
    const file = path.join(dir, mobile ? 'pitch-handy.webm' : 'pitch-desktop.webm');
    if (video) { const p = await video.path(); fs.renameSync(p, file); }
    return { file, loadS };
}

async function pitch(domain) {
    if (!DOMAIN.test(domain)) throw new Error('Keine gültige Domain: ' + domain);
    let s = scoutData(domain);
    if (!s) {
        try {
            const { processTarget } = require('./harvey-worker.js');
            const r = await processTarget(domain, { json: true });
            s = { name: domain, domain, weaknesses: r.findings.map((f) => ({ title: f.title })), psi: r.psi };
        } catch (err) { s = { name: domain, domain, weaknesses: [] }; }
    }
    const facts = { name: s.name || domain, domain, weaknesses: (s.weaknesses || []).map((w) => w.title || w).filter(Boolean), lcp: s.psi && s.psi.lcp ? Number(s.psi.lcp).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : null };
    const dir = path.join(OUT, domain);
    fs.mkdirSync(dir, { recursive: true });
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
    try {
        const d = await record(browser, 'https://' + domain + '/', dir, false, facts);
        const m = await record(browser, 'https://' + domain + '/', dir, true, facts);
        fs.writeFileSync(path.join(dir, 'sprechtext.md'), [
            '# Video-Pitch ' + facts.name, '',
            'Dateien: `pitch-desktop.webm` (ca. 35 s), `pitch-handy.webm` (ca. 15 s). Ohne Ton: in Loom oder am Handy einsprechen, oder so hochladen.', '',
            '## Sprechtext (ca. 60 Sekunden)', '',
            'Guten Tag, hier ist Michael Weichenberger von MW IT-SERVICES aus Augsburg. Ich habe mir Ihre Website ' + domain + ' angesehen und Ihnen kurz aufgenommen, was mir aufgefallen ist.',
            'Beim Öffnen hat die Seite ' + d.loadS + ' Sekunden gebraucht' + (facts.lcp ? ', Google misst am Handy ' + facts.lcp + ' Sekunden' : '') + '. Ab etwa zweieinhalb Sekunden springen viele Besucher ab, bevor sie anrufen.',
            ...facts.weaknesses.slice(0, 3).map((w) => w + '.'),
            'Das ist alles gut lösbar. Wenn Sie mögen, zeige ich Ihnen in 15 Minuten, was davon sich für Ihren Betrieb wirklich lohnt. Meine Nummer und der Link zum Termin stehen im Brief. Danke fürs Zuschauen.', '',
            '## Baustein für den Brief', '',
            'Ich habe Ihnen ein kurzes Video aufgenommen, in dem ich Ihnen an Ihrer eigenen Website zeige, wo Ihnen gerade Anfragen verloren gehen (60 Sekunden):',
            '[BITTE EINTRAGEN: Link zum Video oder QR-Code]', '',
            '_Versand per Brief oder persönlich. Per Mail nur mit Einwilligung (§ 7 UWG)._'
        ].join('\n'));
        console.log('✓ ' + facts.name + ' → out/video/' + domain + '/ (' + path.basename(d.file) + ', ' + path.basename(m.file) + ', sprechtext.md)');
        return { domain, dir: path.relative(Store.ROOT, dir).replace(/\\/g, '/') };
    } finally { await browser.close(); }
}

async function main() {
    Store.ensure();
    let domains = [];
    if (opt('domain')) domains = [String(opt('domain')).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')];
    else if (opt('top')) {
        try {
            const f = JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', 'scout', 'latest.json'), 'utf8')).file;
            domains = JSON.parse(fs.readFileSync(path.join(Store.ROOT, 'out', f), 'utf8')).suggestions.slice(0, Math.min(10, Number(opt('top')) || 3)).map((s) => s.domain);
        } catch (err) { throw new Error('Noch kein Scout-Lauf vorhanden.'); }
    } else throw new Error('Bitte --domain <domain> oder --top <Anzahl> angeben.');
    const done = [];
    for (const d of domains) { try { done.push(await pitch(d)); } catch (err) { console.log('✗ ' + d + ': ' + err.message); } }
    const prev = (Run.all().video || {}).data || {};
    Run.done('video', { summary: done.length + ' Video-Pitches erstellt', data: { videos: [...done.map((v) => ({ ...v, at: new Date().toISOString() })), ...(prev.videos || [])].slice(0, 30) } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
module.exports = { pitch };
