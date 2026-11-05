#!/usr/bin/env node
/* =============================================================================
   KASI · Marketing (Marke, Kampagnen, Herkunft der Anfragen)

   npm run marketing                Auswertung: Anfragen je Kampagne und Seite,
                                    Unterseiten erreichbar?, Bewertungs-Erinnerungen
   npm run marketing -- --creatives Anzeigenbilder im Website-Look rendern
                                    (Beitrag 1080×1350 und Story 1080×1920)

   Daten: data/marketing.json (Marke, Kampagnen, Budget, Ausgaben). Beim ersten
   Lauf mit einer Instagram-Testkampagne zum Black Friday vorbelegt (Entwurf).
   Herkunft: die Website liest utm_* aus dem Link und sendet sie mit der Anfrage
   (Spalte „source“ in D1). Kein Pixel, kein Cookie.

   Kasi schaltet keine Anzeigen. Sie bewerben die Beiträge selbst in der Instagram-App
   und tragen die Ausgaben hier ein; Kasi rechnet die Kosten je Anfrage.
   Bewertungen: nur persönlich oder mit Einwilligung per Mail anfragen
   (BGH, Urteil vom 10.07.2018, VI ZR 225/17: Feedback-Mail ohne Einwilligung = Werbung).
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Cloud = require('./core/cloud.js');
const Run = require('./core/runlog.js');
const Offer = require('../offer-rules.js');

const args = process.argv.slice(2);
const SITE = 'https://mw-itservices.de';
const OUT = path.join(__dirname, 'out', 'marketing');
const PAGES = ['webdesign-augsburg', 'webdesign-muenchen', 'website-fuer-maler', 'website-fuer-handwerksbetriebe'];

const link = (campaign, content, hash) => SITE + '/?utm_source=instagram&utm_medium=paid-social&utm_campaign=' + campaign + (content ? '&utm_content=' + content : '') + (hash || '');

function defaults() {
    const p = Offer.PROMO;
    const until = new Date(p.until).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    return {
        brand: {
            positioning: 'Websites und digitale Büro-Abläufe für Handwerksbetriebe, von einem gelernten Maler und Lackierer, der heute Software entwickelt.',
            promise: 'Mehr Anfragen, weniger Büro. Festpreis, schlüsselfertig, rund 30 Minuten Ihr Aufwand.',
            audience: 'Inhaber und Geschäftsführer von Handwerksbetrieben (2 bis 50 Mitarbeitende) im Raum Augsburg, München und bundesweit per Video-Call.',
            proof: 'Ausbildung Maler und Lackierer · 2.300 UE Softwareentwicklung (Syntax Institut) · Kundenprojekt Dörfer GmbH · eigene Website ohne Baukasten und ohne Tracker',
            tone: 'Sie-Form, klar und handfest, ohne Agentur-Chinesisch. Zahlen nur, wenn belegt.',
            colors: 'Dunkles Holz #16110E / #2D2018, Kupfer #8C4A25 / #B56535 / #DF9A67, Hell #F0C9A6, Schrift Iowan Old Style / Palatino',
            claims: ['Weniger Büro-Chaos. Mehr Top-Aufträge.', 'Digitalisierung, die sich sofort rechnet.', 'Vom Handwerk für das Handwerk.']
        },
        campaigns: [{
            // Nur Instagram (noch keine Facebook-Seite): Beiträge direkt in der Instagram-App bewerben
            id: 'bf26-insta', name: 'Instagram · Black Friday Test', channel: 'instagram', status: 'entwurf',
            start: new Date().toISOString().slice(0, 10), end: String(p.until).slice(0, 10), budgetDay: 15, spend: 0,
            objective: 'In der Instagram-App „Bewerben“ → „Mehr Websitebesuche“. Ohne Pixel, ohne Facebook-Seite.',
            targeting: [
                'Je Anzeige einen eigenen Beitrag posten und diesen bewerben (dann sieht Kasi, welcher wirkt)',
                'Ziel: „Mehr Websitebesuche“, Link: der Link der Anzeige unten (mit Kennung), Button „Mehr dazu“',
                'Zielgruppe „Eigene erstellen“: Orte Langweid am Lech + 40 km (deckt Augsburg ab) und München + 25 km',
                'Alter 25 bis 65, Interessen: Handwerk, Kleinunternehmen, Selbstständigkeit, Unternehmertum',
                'Budget 5 € pro Tag je Beitrag (zusammen 15 €), Laufzeit bis 30.11.',
                'Optional später: Facebook-Seite anlegen, dann im Werbeanzeigenmanager mehr Einstellungen und Facebook dazu'
            ],
            checklist: [
                'Instagram als Unternehmenskonto (Profi-Konto) mit Kategorie und Kontakt-Button',
                'Impressum in der Bio verlinken: mw-itservices.de/impressum.html (Pflicht für geschäftliche Profile)',
                'Zahlungsmethode in Instagram hinterlegen (Einstellungen → Werbeanzeigen-Zahlungen)',
                'Bilder aus „Anzeigenbilder erstellen“ posten: Feed-Bild als Beitrag, Story-Bild als Story',
                'Beim Bewerben den Link unten 1:1 übernehmen, damit Kasi die Anfragen zuordnen kann',
                'Nach 7 Tagen: Kosten hier eintragen, schwächsten Beitrag nicht weiter bewerben'
            ],
            ads: [
                { id: 'check', title: 'Wie viele Anfragen verliert Ihre Website?', points: ['Ladezeit und Handy', 'Google und Google Maps', 'KI-Suche wie ChatGPT'], footer: 'Kostenloser Check in 30 Sekunden',
                    primary: 'Wie viele Anfragen verliert Ihre Website, bevor jemand anruft? Der kostenlose Website-Check zeigt in rund 30 Sekunden, wo Ihr Betrieb online liegen bleibt: Ladezeit, Handy, Google und KI-Suche. Ohne Anmeldung. Von einem Webentwickler, der selbst aus dem Handwerk kommt.',
                    headline: 'Website-Check für Handwerksbetriebe', description: 'Kostenlos, Ergebnis in 30 Sekunden', cta: 'Mehr dazu', url: link('bf26-insta', 'check', '#sichtbarkeit') },
                { id: 'bf', title: 'Black Friday für Handwerksbetriebe', points: ['Website „Digital Starter“ ' + p.once + ' € statt ' + Offer.PRICES.base.starter.once + ' €', 'Pflege & Local SEO ' + p.month + ' € statt ' + Offer.PRICES.care.care.month + ' € (' + p.months + ' Monate)', 'Festpreis, schlüsselfertig'], footer: 'Nur bis ' + until + ' · Preise netto',
                    primary: 'Bis ' + until + ': Website „Digital Starter“ für ' + p.once + ' € statt ' + Offer.PRICES.base.starter.once + ' € und Pflege & Local SEO in den ersten ' + p.months + ' Monaten für ' + p.month + ' € statt ' + Offer.PRICES.care.care.month + ' € im Monat. Schlüsselfertig, Texte und Google-Einrichtung inklusive. Preise netto zzgl. MwSt., Pflege mit ' + p.term + ' Monaten Laufzeit. Im Planer sehen Sie Ihren Preis sofort.',
                    headline: 'Website ab ' + p.once + ' € netto, bis ' + until, description: 'Black-Friday-Paket für Handwerksbetriebe', cta: 'Angebot ansehen', url: link('bf26-insta', 'bf', '#planer') },
                { id: 'handwerk', title: 'Vom Handwerk für das Handwerk', points: ['Gelernter Maler und Lackierer', 'heute Softwareentwickler', 'Websites, die Anfragen bringen'], footer: 'Raum Augsburg, München, bundesweit',
                    primary: 'Ich habe Maler und Lackierer gelernt und entwickle heute Software. Für Handwerksbetriebe im Raum Augsburg und München baue ich Websites, die Anfragen bringen, und digitale Abläufe, die das Büro entlasten. Festpreis, schlüsselfertig, rund 30 Minuten Ihr Aufwand.',
                    headline: 'Websites vom Handwerker für Handwerker', description: 'Festpreis ab ' + Offer.PRICES.base.starter.once + ' € netto', cta: 'Mehr dazu', url: link('bf26-insta', 'handwerk', '') }
            ]
        }]
    };
}

function load() {
    const m = Store.load('marketing');
    if (m && m.brand && m.campaigns) return m;
    const d = defaults();
    Store.save('marketing', d);
    return d;
}

/* Anfragen nach Herkunft aus D1 */
async function sources() {
    const rows = await Cloud.query("SELECT kind, status, source, created_at, value_once, value_month FROM leads WHERE kind IN ('anfrage','paket') ORDER BY created_at DESC LIMIT 2000");
    const by = {};
    for (const r of rows) {
        let s = null;
        try { s = r.source ? JSON.parse(r.source) : null; } catch (_) { s = null; }
        const key = s ? s.source + ' · ' + (s.campaign || '–') : 'direkt / unbekannt';
        const g = by[key] || (by[key] = { key, source: s ? s.source : null, medium: s ? s.medium || null : null, campaign: s ? s.campaign || null : null, leads: 0, paket: 0, termin: 0, auftrag: 0, valueOnce: 0, valueMonth: 0, last: null, content: {} });
        g.leads++;
        if (r.kind === 'paket') g.paket++;
        if (['termin', 'auftrag'].includes(r.status)) g.termin++;
        if (r.status === 'auftrag') { g.auftrag++; g.valueOnce += Number(r.value_once) || 0; g.valueMonth += Number(r.value_month) || 0; }
        if (s && s.content) g.content[s.content] = (g.content[s.content] || 0) + 1;
        if (!g.last || r.created_at > g.last) g.last = r.created_at;
    }
    return Object.values(by).sort((a, b) => b.leads - a.leads);
}

/* Cookielose Zählung der Website (D1-Tabelle visits), letzte 30 Tage */
async function visits() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = await Cloud.query('SELECT day, page, source, event, n FROM visits WHERE day >= ? ORDER BY day', [since]);
    const sum = (filter, key) => { const o = {}; rows.filter(filter).forEach((r) => { o[r[key]] = (o[r[key]] || 0) + r.n; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
    const views = (r) => r.event === 'view';
    const days = {};
    rows.filter(views).forEach((r) => { days[r.day] = (days[r.day] || 0) + r.n; });
    return {
        since, views: rows.filter(views).reduce((n, r) => n + r.n, 0),
        days: Object.entries(days).sort((a, b) => a[0].localeCompare(b[0])),
        pages: sum(views, 'page').slice(0, 12), sources: sum(views, 'source').slice(0, 12),
        events: sum((r) => r.event !== 'view', 'event')
    };
}

/* Google: Search Console und Unternehmensprofil (wenn verbunden) */
async function google() {
    const Google = require('./core/google.js');
    if (!Google.connected()) return { connected: false };
    const out = { connected: true };
    const iso = (d) => d.toISOString().slice(0, 10);
    const to = new Date(Date.now() - 3 * 86400000); // Search Console liegt etwa 2–3 Tage zurück
    const from = new Date(to.getTime() - 27 * 86400000);
    try {
        const sites = await Google.searchSites();
        const site = sites.find((u) => /mw-itservices\.de/.test(u));
        if (site) {
            out.search = { site, from: iso(from), to: iso(to), totals: await Google.searchTotals(site, iso(from), iso(to)),
                queries: await Google.searchBy(site, iso(from), iso(to), 'query', 20), pages: await Google.searchBy(site, iso(from), iso(to), 'page', 15) };
        } else out.searchNote = 'mw-itservices.de ist in der Search Console nicht hinterlegt oder nicht freigegeben.';
    } catch (err) { out.searchNote = err.message; }
    try {
        const loc = await Google.ownLocation();
        const pTo = new Date(Date.now() - 2 * 86400000); const pFrom = new Date(pTo.getTime() - 27 * 86400000);
        out.profile = { title: loc.title, from: iso(pFrom), to: iso(pTo), metrics: await Google.performance(loc, iso(pFrom), iso(pTo)) };
        try {
            const m = (d) => d.toISOString().slice(0, 7);
            out.profile.keywords = await Google.searchKeywords(loc, m(new Date(Date.now() - 95 * 86400000)), m(new Date(Date.now() - 32 * 86400000)));
        } catch (err) { out.profile.keywordsNote = err.message; }
    } catch (err) { out.profileNote = err.message; }
    return out;
}

async function checkPages() {
    const out = [];
    for (const slug of PAGES) {
        const t0 = Date.now();
        try {
            const res = await fetch(SITE + '/' + slug + '/', { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'MW-Kasi-Marketing/1.0' } });
            out.push({ slug, ok: res.ok, status: res.status, ms: Date.now() - t0 });
        } catch (err) { out.push({ slug, ok: false, status: 0, ms: Date.now() - t0 }); }
    }
    return out;
}

/* Bewertung und Referenz: nach dem Livegang persönlich fragen */
function reminders() {
    const DAY = 86400000;
    return Store.load('clients').filter((c) => c.careSince && Date.now() - Date.parse(c.careSince) > 21 * DAY && !c.reviewAskedAt)
        .map((c) => ({ id: c.id, company: c.company, since: c.careSince, reference: c.reference === true }));
}

/* ---------- Anzeigenbilder ---------- */
function browserPath() {
    return [process.env.HARVEY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((x) => fs.existsSync(x));
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function creativeHtml(ad, w, h) {
    const story = h >= w * 1.5; // Story 9:16, Beitrag 4:5
    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${w}px;height:${h}px}
body{background:radial-gradient(120% 70% at 85% 0%,#3A2A1F 0%,#1E1612 45%,#16110E 100%);color:#F4F0E8;font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;display:flex;flex-direction:column;justify-content:space-between;padding:${story ? '270px 96px 380px' : '96px'};box-sizing:border-box;position:relative;overflow:hidden}
body:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(97deg,rgba(240,201,166,.025) 0 2px,transparent 2px 9px)}
.ring{position:absolute;right:-200px;${story ? 'bottom:-400px' : 'top:-200px'};width:640px;height:640px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#F0C9A6 0%,#DF9A67 18%,#B56535 42%,#8C4A25 64%,#2D2018 100%);opacity:.5}
.brand{font:600 28px/1 system-ui,"Segoe UI",sans-serif;letter-spacing:.24em;color:#DF9A67;position:relative}
h1{font-size:${story ? 92 : 78}px;line-height:1.05;margin:0 0 40px;max-width:880px;position:relative;background:linear-gradient(180deg,#F4F0E8 0%,#F0C9A6 100%);-webkit-background-clip:text;color:transparent}
ul{list-style:none;margin:0;padding:0;font:400 ${story ? 40 : 36}px/1.45 system-ui,"Segoe UI",sans-serif;color:#E8DCCD;position:relative}
li{padding-left:56px;position:relative;margin:12px 0}
li:before{content:"";position:absolute;left:0;top:20px;width:28px;height:3px;background:linear-gradient(90deg,#8C4A25,#DF9A67)}
.foot{display:flex;justify-content:space-between;align-items:center;gap:24px;font:600 30px/1.2 system-ui,"Segoe UI",sans-serif;color:#F0C9A6;position:relative;border-top:1px solid rgba(240,201,166,.2);padding-top:36px}
.foot small{font-weight:500;color:#B9A898;font-size:26px}
</style><div class="ring"></div><div class="brand">MW IT-SERVICES</div>
<div><h1>${esc(ad.title)}</h1><ul>${ad.points.map((p) => '<li>' + esc(p) + '</li>').join('')}</ul></div>
<div class="foot"><span>${esc(ad.footer)}</span><small>mw-itservices.de</small></div>`;
}

async function creatives(m) {
    const exe = browserPath();
    if (!exe) throw new Error('Kein Chrome oder Edge gefunden (HARVEY_BROWSER in .env).');
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: exe, headless: true });
    const made = [];
    try {
        for (const c of m.campaigns) {
            const dir = path.join(OUT, c.id);
            fs.mkdirSync(dir, { recursive: true });
            for (const ad of c.ads || []) {
                for (const [fmt, w, h] of [['feed', 1080, 1350], ['story', 1080, 1920]]) {
                    const page = await browser.newPage({ viewport: { width: w, height: h } });
                    await page.setContent(creativeHtml(ad, w, h), { waitUntil: 'load' });
                    const file = path.join(dir, ad.id + '-' + fmt + '.png');
                    await page.screenshot({ path: file, type: 'png' });
                    await page.close();
                    made.push(path.relative(__dirname, file).replace(/\\/g, '/'));
                }
            }
        }
    } finally { await browser.close(); }
    return made;
}

async function main() {
    Store.ensure();
    const m = load();
    if (args.includes('--creatives')) {
        const made = await creatives(m);
        made.forEach((f) => console.log('✓ ' + f));
        const prev = (Run.all().marketing || {});
        Run.done('marketing', { ok: prev.ok !== false, summary: prev.summary || made.length + ' Anzeigenbilder erstellt', notes: prev.notes || [], data: { ...(prev.data || {}), creatives: made, creativesAt: new Date().toISOString() } });
        console.log(made.length + ' Anzeigenbilder in out/marketing/');
        return;
    }
    const notes = [];
    let stats = [];
    let offline = false;
    try { stats = await sources(); } catch (err) { offline = true; notes.push('Web-Dashboard nicht erreichbar: ' + err.message); }
    const pages = await checkPages();
    let visitData = null;
    try { visitData = await visits(); } catch (err) { notes.push('Besuchszählung nicht abrufbar: ' + err.message); }
    let googleData = { connected: false };
    try { googleData = await google(); } catch (err) { notes.push('Google: ' + err.message); }
    if (googleData.searchNote) notes.push('Search Console: ' + googleData.searchNote);
    if (googleData.profileNote) notes.push('Google-Profil: ' + googleData.profileNote);
    pages.filter((p) => !p.ok).forEach((p) => notes.push('Unterseite /' + p.slug + '/ nicht erreichbar (' + (p.status || 'keine Antwort') + ')'));
    const rem = reminders();
    rem.forEach((r) => notes.push('Bewertung persönlich anfragen: ' + r.company + ' (betreut seit ' + r.since + ')'));
    for (const c of m.campaigns) {
        const g = stats.find((s) => s.campaign === c.id);
        c.result = g ? { leads: g.leads, termin: g.termin, auftrag: g.auftrag, costPerLead: c.spend && g.leads ? Math.round(c.spend / g.leads) : null } : { leads: 0, termin: 0, auftrag: 0, costPerLead: null };
    }
    Store.save('marketing', m);
    const total = stats.reduce((a, s) => a + s.leads, 0);
    const tracked = stats.filter((s) => s.source).reduce((a, s) => a + s.leads, 0);
    const summary = offline ? 'Auswertung ohne Web-Dashboard' : (visitData ? visitData.views + ' Seitenaufrufe (30 Tage) · ' : '') + total + ' Anfragen, davon ' + tracked + ' mit Herkunft · ' + pages.filter((p) => p.ok).length + '/' + pages.length + ' Unterseiten erreichbar';
    const prev = ((Run.all().marketing || {}).data) || {};
    Run.done('marketing', { ok: !offline, summary, notes, data: { stats, pages, reminders: rem, visits: visitData, google: googleData, creatives: prev.creatives || [], creativesAt: prev.creativesAt || null } });
    console.log(summary);
    notes.forEach((n) => console.log('  · ' + n));
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('marketing', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { defaults, link };
