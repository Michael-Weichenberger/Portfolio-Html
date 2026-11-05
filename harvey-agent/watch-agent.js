#!/usr/bin/env node
/* =============================================================================
   KASI · Website-Wächter für Betreuungskunden

   npm run watch                    täglicher Check aller Kunden-Websites
   npm run watch -- --links         zusätzlich Links der Startseite prüfen (montags automatisch)
   npm run watch -- --report        Betreuungsbericht für den Vormonat entwerfen
   npm run watch -- --report 2026-10
   npm run watch -- --quarter       Quartals-ROI-Bericht für das letzte Quartal entwerfen
   npm run watch -- --quarter 2026-Q3

   Geprüft wird: Erreichbarkeit, Antwortzeit, SSL-Zertifikat (Tage bis Ablauf),
   Domain-Ablauf (RDAP, nicht bei .de), Impressum/Datenschutz verlinkt,
   defekte Links. Bei Ausfall (zweimal in Folge) oder bald ablaufendem
   Zertifikat kommt ein Hinweis aufs Handy (core/notify.js).

   Berichte sind Entwürfe im Postausgang (Typ „Report“), gesendet wird erst
   nach Ihrer Freigabe. Zahlen stammen nur aus Messungen und, falls verbunden,
   aus Google Search Console und dem Unternehmensprofil. Die Wert-Schätzung im
   ROI-Bericht ist als Schätzung gekennzeichnet und nennt ihre Annahmen.
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const tls = require('tls');
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const Drafts = require('./core/drafts.js');
const Notify = require('./core/notify.js');
const Events = require('./core/events.js');
const Run = require('./core/runlog.js');
const Offer = require('../offer-rules.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const has = (n) => args.includes('--' + n);
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'MW-Kasi-Waechter/1.0 (+https://mw-itservices.de)';
const de = (iso) => iso.split('-').reverse().join('.');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const euro = Offer.euro;

/* ---------- Messungen ---------- */
function sslDays(host) {
    return new Promise((resolve) => {
        const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
            const c = s.getPeerCertificate();
            s.end();
            resolve(c && c.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / 86400000) : null);
        });
        s.on('error', () => resolve(null));
        s.on('timeout', () => { s.destroy(); resolve(null); });
    });
}

async function domainExpiry(domain) {
    if (/\.de$/.test(domain)) return { supported: false }; // DENIC kennt kein Ablaufdatum, .de verlängert sich automatisch
    try {
        const r = await fetch('https://rdap.org/domain/' + domain, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) return { supported: false };
        const j = await r.json();
        const ex = (j.events || []).find((e) => e.eventAction === 'expiration');
        return ex ? { supported: true, date: ex.eventDate.slice(0, 10), days: Math.floor((Date.parse(ex.eventDate) - Date.now()) / 86400000) } : { supported: false };
    } catch (err) { return { supported: false }; }
}

async function fetchPage(url) {
    const t0 = Date.now();
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    const html = (res.headers.get('content-type') || '').includes('html') ? (await res.text()).slice(0, 1500000) : '';
    return { status: res.status, ms: Date.now() - t0, finalUrl: res.url, html };
}

function links(html, baseUrl) {
    const host = new URL(baseUrl).host;
    const out = new Set();
    for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
        try {
            const u = new URL(m[1], baseUrl);
            if (/^https?:$/.test(u.protocol) && u.host === host) out.add(u.toString().split('#')[0]);
        } catch (err) { /* ungültig */ }
    }
    return [...out].slice(0, 30);
}

async function brokenLinks(list) {
    const broken = [];
    for (const u of list) {
        try {
            let r = await fetch(u, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
            if (r.status === 405 || r.status === 403) r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
            if (r.status >= 400) broken.push({ url: u, status: r.status });
        } catch (err) { broken.push({ url: u, status: 0 }); }
    }
    return broken;
}

async function checkDomain(domain, withLinks) {
    const url = 'https://' + domain + '/';
    const r = { date: TODAY, at: new Date().toISOString(), ok: false, status: 0, ms: null };
    let html = '';
    try {
        const p = await fetchPage(url);
        Object.assign(r, { ok: p.status < 400, status: p.status, ms: p.ms, https: p.finalUrl.startsWith('https://') });
        html = p.html;
    } catch (err) { r.error = err.name === 'TimeoutError' ? 'Zeitüberschreitung' : 'nicht erreichbar'; }
    r.sslDays = await sslDays(domain);
    if (html) {
        r.impressum = /impressum/i.test(html);
        r.datenschutz = /datenschutz|privacy/i.test(html);
    }
    let linkCheck = null;
    if (withLinks && html) linkCheck = { date: TODAY, checked: links(html, url).length, broken: await brokenLinks(links(html, url)) };
    return { r, linkCheck };
}

function targets() {
    const list = Store.load('clients').flatMap((c) => (c.domains || []).map((d) => ({ domain: String(d).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(), client: c })));
    const own = (Store.load('company').web || 'mw-itservices.de').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!list.some((t) => t.domain === own)) list.push({ domain: own, client: null });
    return list;
}

async function daily() {
    const st = Store.load('watch');
    st.domains = st.domains || {};
    const withLinks = has('links') || new Date().getDay() === 1;
    const notes = [];
    let down = 0;
    for (const t of targets()) {
        const d = st.domains[t.domain] = st.domains[t.domain] || { checks: [] };
        const { r, linkCheck } = await checkDomain(t.domain, withLinks);
        d.checks = d.checks.filter((c) => c.date !== TODAY).concat(r).slice(-400);
        if (linkCheck) d.links = linkCheck;
        if (!d.expiry || d.expiry.checked !== TODAY.slice(0, 7)) d.expiry = { ...(await domainExpiry(t.domain)), checked: TODAY.slice(0, 7) };
        const prev = d.checks[d.checks.length - 2];
        const label = (t.client ? t.client.company + ' · ' : '') + t.domain;
        console.log((r.ok ? '✓ ' : '✗ ') + label + ' · ' + (r.ok ? 'HTTP ' + r.status + ' · ' + r.ms + ' ms' : r.error || 'HTTP ' + r.status) + (r.sslDays !== null ? ' · SSL ' + r.sslDays + ' Tage' : ' · SSL ?')
            + (linkCheck ? ' · ' + linkCheck.broken.length + ' defekte Links' : ''));
        if (!r.ok) {
            down++;
            notes.push(label + ' nicht erreichbar (' + (r.error || 'HTTP ' + r.status) + ')');
            if (prev && !prev.ok && !d.alertedDown) { // zweimal in Folge: Alarm
                d.alertedDown = TODAY;
                Events.record('site_down', { name: label });
                await Notify.send('Kasi: Website down', label + ' ist seit der letzten Prüfung nicht erreichbar.', { priority: 'high', url: 'https://' + t.domain });
            }
        } else d.alertedDown = null;
        if (r.sslDays !== null && r.sslDays < 14) {
            notes.push('SSL-Zertifikat von ' + t.domain + ' läuft in ' + r.sslDays + ' Tagen ab');
            if (d.alertedSsl !== TODAY.slice(0, 7)) { d.alertedSsl = TODAY.slice(0, 7); await Notify.send('Kasi: SSL läuft ab', t.domain + ': Zertifikat noch ' + r.sslDays + ' Tage gültig.'); }
        }
        if (d.expiry && d.expiry.supported && d.expiry.days < 30) notes.push('Domain ' + t.domain + ' läuft am ' + de(d.expiry.date) + ' ab');
        if (r.ok && r.impressum === false) notes.push(t.domain + ': kein Impressum-Link auf der Startseite gefunden');
        if (linkCheck && linkCheck.broken.length) notes.push(t.domain + ': ' + linkCheck.broken.length + ' defekte Links');
    }
    Store.save('watch', st);
    const summary = Object.keys(st.domains).length + (Object.keys(st.domains).length === 1 ? ' Website geprüft, ' : ' Websites geprüft, ') + (down ? down + ' nicht erreichbar' : 'alle erreichbar');
    console.log(summary);
    Run.done('watch', { ok: !down, summary, notes });
}

/* ---------- Zeiträume ---------- */
function monthRange(m) {
    const [y, mo] = m.split('-').map(Number);
    const from = new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return { from, to, label: new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
}
function quarterRange(q) {
    const [y, n] = q.split('-Q').map(Number);
    const from = new Date(Date.UTC(y, (n - 1) * 3, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10);
    return { from, to, label: n + '. Quartal ' + y, genitive: n + '. Quartals ' + y, prev: n === 1 ? (y - 1) + '-Q4' : y + '-Q' + (n - 1) };
}
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const lastQuarter = () => { const d = new Date(); const q = Math.floor(d.getUTCMonth() / 3); return q === 0 ? (d.getUTCFullYear() - 1) + '-Q4' : d.getUTCFullYear() + '-Q' + q; };

function stats(domain, from, to) {
    const st = Store.load('watch');
    const checks = ((st.domains || {})[domain] || { checks: [] }).checks.filter((c) => c.date >= from && c.date <= to);
    const ok = checks.filter((c) => c.ok);
    const ms = ok.map((c) => c.ms).filter(Boolean);
    return { checks: checks.length, ok: ok.length, uptime: pct(ok.length, checks.length), avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
        sslDays: (checks[checks.length - 1] || {}).sslDays, links: ((st.domains || {})[domain] || {}).links || null };
}

async function googleNumbers(domain, from, to) {
    const Google = require('./core/google.js');
    if (!Google.connected()) return null;
    const out = {};
    try {
        const sites = await Google.searchSites();
        const site = sites.find((s) => s === 'sc-domain:' + domain || s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') === domain);
        if (site) out.search = await Google.searchTotals(site, from, to);
    } catch (err) { out.searchError = err.message; }
    try {
        const loc = (await Google.locations()).find((l) => l.website && l.website.includes(domain));
        if (loc) out.profile = await Google.performance(loc, from, to);
    } catch (err) { out.profileError = err.message; }
    return out;
}

async function visibility(domain) {
    try {
        const { processTarget } = require('./harvey-worker.js');
        const r = await processTarget(domain, { json: true });
        return { met: r.teaser.met, total: r.teaser.total, findings: r.findings.slice(0, 3).map((f) => f.title) };
    } catch (err) { return null; }
}

function careClients() {
    return Store.load('clients').filter((c) => c.package && c.package.care && c.package.care !== 'none' && !c.careUntil && c.email && (c.domains || []).length);
}

/* ---------- Monatlicher Betreuungsbericht ---------- */
async function report(month) {
    const range = monthRange(month);
    const st = Store.load('watch');
    st.reports = st.reports || {};
    let n = 0;
    for (const c of careClients()) {
        const domain = c.domains[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const s = stats(domain, range.from, range.to);
        const vis = await visibility(domain);
        const g = await googleNumbers(domain, range.from, range.to);
        const prevVis = (st.reports[domain] || {}).vis;
        const geo = ((Store.load('geo').clients || {})[c.id] || {}).last;
        const lines = [
            'Guten Tag,', '',
            'hier ist Ihr Betreuungsbericht für ' + range.label + ' zur Website ' + domain + '.', '',
            '• Erreichbarkeit: ' + (s.checks ? s.uptime.toLocaleString('de-DE') + ' % (' + s.ok + ' von ' + s.checks + ' täglichen Prüfungen erfolgreich)' : 'in diesem Monat noch keine Prüfungen'),
            s.avgMs ? '• Antwortzeit der Startseite: im Schnitt ' + (s.avgMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Sekunden' : null,
            s.sslDays !== null && s.sslDays !== undefined ? '• Sicherheit: SSL-Zertifikat gültig, noch ' + s.sslDays + ' Tage' : null,
            s.links ? '• Links auf der Startseite: ' + (s.links.broken.length ? s.links.broken.length + ' defekte Links gefunden, wir kümmern uns darum' : 'alle ' + s.links.checked + ' geprüften Links funktionieren') : null,
            vis && vis.total ? '• Sichtbarkeits-Signale: ' + vis.met + ' von ' + vis.total + ' erfüllt' + (prevVis ? ' (Vormonat ' + prevVis.met + ' von ' + prevVis.total + ')' : '') : null,
            g && g.search ? '• Google-Suche: ' + g.search.clicks.toLocaleString('de-DE') + ' Klicks bei ' + g.search.impressions.toLocaleString('de-DE') + ' Einblendungen' : null,
            g && g.profile ? '• Google-Unternehmensprofil: ' + g.profile.calls + ' Anrufe, ' + g.profile.websiteClicks + ' Website-Klicks, ' + g.profile.directions + ' Routenanfragen' : null,
            geo ? '• KI-Assistenten: ' + (geo.mentioned ? 'Ihr Betrieb wurde bei der Frage „' + geo.query + '“ genannt' : 'bei der Frage „' + geo.query + '“ noch nicht genannt, daran arbeiten wir') : null,
            '',
            vis && vis.findings.length ? 'Als Nächstes nehmen wir uns vor: ' + vis.findings.join(', ') + '.' : 'Technisch ist alles in Ordnung, es stehen keine dringenden Arbeiten an.',
            '', 'Wenn Sie Änderungswünsche haben (Öffnungszeiten, neue Fotos, Leistungen), antworten Sie einfach auf diese Mail.', '', Drafts.SIGNATURE
        ].filter((x) => x !== null);
        Outbox.add({ key: 'report:' + c.id + ':' + month, type: 'report', to: c.email, subject: 'Ihr Website-Bericht ' + range.label + ' · ' + domain, body: lines.join('\n'),
            ref: domain, contactAllowed: 'bestehend', meta: { client: c.company, month, kind: 'betreuung' } });
        st.reports[domain] = { month, vis: vis ? { met: vis.met, total: vis.total } : prevVis || null };
        n++;
        console.log('✓ Betreuungsbericht ' + range.label + ' · ' + c.company);
    }
    Store.save('watch', st);
    Run.done('watch-report', { summary: n + (n === 1 ? ' Betreuungsbericht' : ' Betreuungsberichte') + ' für ' + range.label + ' im Postausgang' });
}

/* ---------- Quartals-ROI ---------- */
async function quarter(q) {
    const range = quarterRange(q);
    const prev = quarterRange(range.prev);
    const skipped = [];
    let n = 0;
    for (const c of careClients()) {
        const domain = c.domains[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const s = stats(domain, range.from, range.to);
        const g = await googleNumbers(domain, range.from, range.to);
        if (!g || (!g.search && !g.profile)) {
            // ohne echte Besucher- und Anrufzahlen kein Bericht an den Kunden
            skipped.push(c.company + ': keine Google-Zahlen (Search Console/Unternehmensprofil verbinden und Zugriff des Kunden prüfen)');
            console.log('· ' + c.company + ': übersprungen, keine Google-Zahlen');
            continue;
        }
        const gp = await googleNumbers(domain, prev.from, prev.to);
        // Annahmen je Kunde in clients.json → roi { avgOrder, closeRate, inquiryShare }, sonst vorsichtige Standardwerte
        const a = { avgOrder: 2500, closeRate: 0.25, inquiryShare: 0.05, ...(c.roi || {}) };
        const careMonth = c.careRate ? c.careRate.net : ((Offer.PRICES.care[c.package.care] || {}).month || 0);
        const cost = careMonth * 3;
        const calls = g && g.profile ? g.profile.calls : null;
        const clicks = g && g.search ? g.search.clicks : null;
        const contacts = (calls || 0) + Math.round((clicks || 0) * a.inquiryShare);
        const value = Math.round(contacts * a.closeRate * a.avgOrder);
        const delta = (now, before) => (before ? (now >= before ? '+' : '') + Math.round(((now - before) / before) * 100) + ' % zum Vorquartal' : 'kein Vorquartal');
        const lines = [
            'Guten Tag,', '',
            'zum Ende des ' + range.genitive + ' habe ich zusammengestellt, was Ihre Website für Ihren Betrieb geleistet hat.', '',
            clicks !== null ? '• Besucher über Google: ' + clicks.toLocaleString('de-DE') + ' Klicks (' + delta(clicks, gp && gp.search && gp.search.clicks) + ')' : null,
            g && g.search ? '• So oft wurde Ihr Betrieb in der Google-Suche angezeigt: ' + g.search.impressions.toLocaleString('de-DE') : null,
            calls !== null ? '• Anrufe direkt aus Google: ' + calls + ' (' + delta(calls, gp && gp.profile && gp.profile.calls) + ')' : null,
            g && g.profile ? '• Routenanfragen zu Ihrem Betrieb: ' + g.profile.directions + ' · Website-Klicks aus dem Profil: ' + g.profile.websiteClicks : null,
            '• Erreichbarkeit: ' + (s.checks ? s.uptime.toLocaleString('de-DE') + ' %' : 'noch keine Messwerte') + (s.avgMs ? ' · Ladezeit Startseite im Schnitt ' + (s.avgMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' s' : ''),
            '',
            contacts ? 'Was das wert sein kann (Schätzung): Aus ' + contacts + ' Kontakten (Anrufe plus geschätzt ' + Math.round(a.inquiryShare * 100) + ' % der Website-Besucher, die anfragen) werden bei einer Abschlussquote von ' + Math.round(a.closeRate * 100) + ' % und einem durchschnittlichen Auftrag von ' + euro(a.avgOrder) + ' rund ' + euro(value) + ' Auftragswert. Die Betreuung hat in diesem Quartal ' + euro(cost) + ' netto gekostet.'
                : 'Sobald Google Search Console und Ihr Unternehmensprofil verbunden sind, zeige ich Ihnen hier auch Besucher, Anrufe und den geschätzten Auftragswert.',
            contacts ? 'Die Annahmen passe ich gern an Ihre echten Zahlen an, sagen Sie mir einfach, wie viele Anfragen über die Website kamen und was ein typischer Auftrag bei Ihnen bringt.' : null,
            '', 'Ich freue mich auf das nächste Quartal mit Ihnen.', '', Drafts.SIGNATURE
        ].filter((x) => x !== null);
        Outbox.add({ key: 'roi:' + c.id + ':' + q, type: 'report', to: c.email, subject: 'Ihre Website im ' + range.label + ': Zahlen und Wert', body: lines.join('\n'),
            ref: domain, contactAllowed: 'bestehend', meta: { client: c.company, quarter: q, kind: 'roi', value, cost, contacts } });
        n++;
        console.log('✓ ROI-Bericht ' + range.label + ' · ' + c.company + (contacts ? ' · Schätzung ' + euro(value) + ' bei ' + euro(cost) + ' Kosten' : ' · ohne Google-Zahlen'));
    }
    Run.done('watch-roi', { summary: n + (n === 1 ? ' ROI-Bericht' : ' ROI-Berichte') + ' für ' + range.label + ' im Postausgang' + (skipped.length ? ', ' + skipped.length + ' ohne Google-Zahlen übersprungen' : ''), notes: skipped });
}

async function main() {
    Store.ensure();
    if (has('report')) return report(opt('report') || lastMonth());
    if (has('quarter')) return quarter(opt('quarter') || lastQuarter());
    return daily();
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('watch', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main, checkDomain };
