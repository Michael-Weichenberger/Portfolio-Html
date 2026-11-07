#!/usr/bin/env node
/* =============================================================================
   KASI · Tiefenprüfung einer Website (läuft lokal, nicht im Worker)

   node core/audit.js doerfer-gmbh.de      Ergebnis als Text ausgeben

   1. Crawler (wie Screaming Frog): läuft bis zu 30 Unterseiten ab und findet
      tote Seiten, kaputte interne Links, Umleitungen, fehlende oder doppelte
      Titel und Beschreibungen, fehlende Hauptüberschriften, Bilder ohne
      Beschreibung, sehr dünne Seiten und Seiten, die Google nicht aufnehmen soll.
   2. Rich Results: prüft die strukturierten Daten (JSON-LD) auf die Pflicht-
      und Empfehlungsfelder, die Google für Sterne, FAQ, Firmendaten und
      Brotkrumen braucht.
   3. Texte (wie Yoast): Lesbarkeit nach Amstad (Flesch für Deutsch), lange
      Sätze, interne Verlinkung, Leistung und Ort in Titel, Überschrift,
      Adresse, Beschreibung und erstem Absatz.

   Nur lesende GET-Abrufe auf der geprüften Domain. Ziele, die auf interne
   Adressen zeigen (Heimnetz, Router), werden abgelehnt.
   ============================================================================= */
'use strict';

const dns = require('dns').promises;
const A = require('./analyze.js');

const MAX_PAGES = 30;
const MAX_CHECKS = 70;         // zusätzliche Statusprüfungen für nicht gecrawlte interne Links
const CONCURRENCY = 4;
const SKIP = /\.(pdf|jpe?g|png|webp|avif|gif|svg|ico|zip|rar|docx?|xlsx?|pptx?|mp4|mov|mp3|css|js|xml|txt|json)$/i;

/* ------------------------------------------------ Schutz vor Heimnetz --- */
function privateIp(ip) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(ip)) return true;
    const m = ip.match(/^172\.(\d+)\./); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
    const c = ip.match(/^100\.(\d+)\./); if (c && +c[1] >= 64 && +c[1] <= 127) return true; // Tailscale/CGNAT
    return /^(::1|fc|fd|fe80)/i.test(ip);
}
async function safeHost(host) {
    if (!A.isPublicHost(host)) return false;
    try { const all = await dns.lookup(host, { all: true }); return all.length > 0 && !all.some((a) => privateIp(a.address)); } catch (err) { return false; }
}

/* ------------------------------------------------------------ Helfer --- */
const hostBase = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
function normUrl(href, base) {
    try {
        const u = new URL(href, base);
        if (!/^https?:$/.test(u.protocol)) return null;
        u.hash = '';
        // Parameter (Kampagnen, ?job=…) und index.html zählen nicht als eigene Seite
        u.search = '';
        u.pathname = u.pathname.replace(/\/index\.(html?|php)$/i, '/');
        return u.toString();
    } catch (err) { return null; }
}
const short = (url, origin) => { try { const u = new URL(url); return (u.origin === origin ? '' : u.host) + (u.pathname + u.search || '/'); } catch (err) { return url; } };

function mainText(html) {
    const body = (html.match(/<body\b[\s\S]*<\/body>/i) || [html])[0]
        .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
    return A.stripTags(body.replace(/<\/(p|div|li|h[1-6]|section|article|td|br)>/gi, '. '));
}

function parsePage(url, html) {
    const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
    const title = A.stripTags((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || ['', ''])[1]);
    const meta = (name) => { const t = (head.match(new RegExp('<meta\\b[^>]*name\\s*=\\s*["\']' + name + '["\'][^>]*>', 'i')) || [])[0]; return t ? (A.attrs(t).content || '').trim() : null; };
    const h1s = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map(A.stripTags).filter(Boolean);
    const h2 = (html.match(/<h2\b/gi) || []).length;
    const imgs = (html.match(/<img\b[^>]*>/gi) || []).map(A.attrs);
    const noAlt = imgs.filter((i) => !('alt' in i)).length; // leeres alt bei Schmuckbildern ist richtig
    const links = (html.match(/<a\b[^>]*>/gi) || []).map(A.attrs).map((a) => a.href).filter((h) => h && !/^(#|mailto:|tel:|javascript:|whatsapp:)/i.test(h));
    const firstP = A.stripTags((html.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || ['', ''])[1]);
    const jsonld = [];
    let ldErrors = 0;
    (html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []).forEach((s) => {
        try { jsonld.push(JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/gi, '').trim())); } catch (err) { ldErrors++; }
    });
    const text = mainText(html);
    return {
        url, title, description: meta('description'), robots: (meta('robots') || '').toLowerCase(), h1s, h2, imgs: imgs.length, noAlt,
        links, firstP, jsonld, ldErrors, text, words: text.split(/\s+/).filter((w) => /[a-zäöüß]{2,}/i.test(w)).length,
        canonical: ((head.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [])[0] ? A.attrs(head.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)[0]).href : null)
    };
}

/* ------------------------------------------------------------- Crawler --- */
async function crawl(startUrl) {
    const start = new URL(startUrl);
    const base = hostBase(start.hostname);
    if (!(await safeHost(start.hostname))) throw new Error('Diese Adresse wird nicht geprüft (kein öffentlicher Server).');
    const sameSite = (u) => { try { return hostBase(new URL(u).hostname) === base; } catch (err) { return false; } };
    const queue = [start.toString()];
    const seen = new Set(queue);
    const pages = [];
    const parsed = new Set();       // endgültige Adressen, die schon ausgewertet sind
    const status = new Map();       // URL → { status, final }
    const linkedFrom = new Map();   // URL → Set(Seiten, die darauf verlinken)
    const hostLinks = new Map();    // Link mit anderer Schreibweise der Domain → richtige Adresse
    let canonHost = null;           // Domain, auf der die Seite wirklich läuft (mit oder ohne www)
    const canon = (u) => { if (!canonHost) return u; try { const x = new URL(u); if (x.hostname !== canonHost) { x.hostname = canonHost; return x.toString(); } } catch (err) { /* egal */ } return u; };

    // Sitemap als zusätzliche Quelle für Unterseiten
    try {
        const r = await A.get(start.origin + '/sitemap.xml', { accept: 'application/xml,text/xml' }, 10000);
        if (r.ok) ((await A.readText(r, 2000000)).match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).slice(0, 200).forEach((l) => {
            const u = normUrl(l.replace(/<\/?loc>/gi, '').trim(), start.origin);
            if (u && sameSite(u) && !SKIP.test(new URL(u).pathname) && !seen.has(u)) { seen.add(u); queue.push(u); }
        });
    } catch (err) { /* ohne Sitemap */ }

    async function fetchPage(url) {
        let res;
        try { res = await A.get(url, {}, 15000); } catch (err) { status.set(url, { status: 0, error: err.name === 'AbortError' ? 'Zeitüberschreitung' : 'nicht erreichbar' }); return; }
        const final = normUrl(res.url, url) || url;
        status.set(url, { status: res.status, final, redirected: final !== url });
        if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return;
        if (!sameSite(final)) return; // leitet auf fremde Domain um
        if (!canonHost) canonHost = new URL(final).hostname;
        if (parsed.has(final)) return;
        parsed.add(final);
        const p = parsePage(final, await A.readText(res));
        p.status = res.status;
        p.requested = url;
        pages.push(p);
        p.links.forEach((h) => {
            const raw = normUrl(h, final);
            if (!raw || !sameSite(raw)) return;
            const u = canon(raw);
            if (u !== raw) hostLinks.set(raw, u);
            if (!linkedFrom.has(u)) linkedFrom.set(u, new Set());
            linkedFrom.get(u).add(final);
            if (!seen.has(u) && !SKIP.test(new URL(u).pathname)) { seen.add(u); queue.push(u); }
        });
    }
    while (queue.length && pages.length + [...status.values()].filter((s) => s.status !== 200).length < MAX_PAGES) {
        const batch = queue.splice(0, CONCURRENCY);
        await Promise.all(batch.map(fetchPage));
    }
    // Restliche interne Links nur auf Erreichbarkeit prüfen (kaputte Links finden)
    const rest = [...linkedFrom.keys()].filter((u) => !status.has(u) && !SKIP.test(new URL(u).pathname)).slice(0, MAX_CHECKS);
    for (let i = 0; i < rest.length; i += 6) {
        await Promise.all(rest.slice(i, i + 6).map(async (u) => {
            try { const r = await A.get(u, {}, 10000); status.set(u, { status: r.status, final: normUrl(r.url, u) || u, redirected: (normUrl(r.url, u) || u) !== u }); try { await r.body?.cancel(); } catch (e) { /* egal */ } }
            catch (err) { status.set(u, { status: 0, error: 'nicht erreichbar' }); }
        }));
    }
    return { origin: canonHost ? 'https://' + canonHost : start.origin, pages, status, linkedFrom, hostLinks, moreThanChecked: queue.length > 0 };
}

function crawlIssues(c) {
    const o = c.origin;
    const broken = [...c.status.entries()].filter(([, s]) => s.status === 0 || s.status >= 400)
        .map(([u, s]) => ({ url: short(u, o), status: s.status || s.error, from: [...(c.linkedFrom.get(u) || [])].slice(0, 3).map((x) => short(x, o)) }));
    const redirects = [...c.status.entries()].filter(([u, s]) => s.redirected && c.linkedFrom.has(u) && s.status < 400).map(([u, s]) => short(u, o) + ' → ' + short(s.final, o))
        .concat([...c.hostLinks.entries()].map(([from, to]) => new URL(from).host + new URL(from).pathname + ' → ' + new URL(to).host + new URL(to).pathname));
    const indexable = c.pages.filter((p) => !/noindex/.test(p.robots));
    const group = (key) => {
        const m = new Map();
        indexable.forEach((p) => { const v = (p[key] || '').trim().toLowerCase(); if (v) m.set(v, [...(m.get(v) || []), short(p.url, o)]); });
        return [...m.entries()].filter(([, l]) => l.length > 1).map(([v, l]) => ({ text: v.slice(0, 90), pages: l }));
    };
    return {
        checked: c.pages.length, more: c.moreThanChecked,
        broken, redirects: [...new Set(redirects)].slice(0, 15),
        noTitle: indexable.filter((p) => !p.title).map((p) => short(p.url, o)),
        noDescription: indexable.filter((p) => !p.description).map((p) => short(p.url, o)),
        badDescription: indexable.filter((p) => p.description && (p.description.length < 70 || p.description.length > 165)).map((p) => short(p.url, o) + ' (' + p.description.length + ' Zeichen)'),
        noH1: indexable.filter((p) => !p.h1s.length).map((p) => short(p.url, o)),
        manyH1: indexable.filter((p) => p.h1s.length > 1).map((p) => short(p.url, o) + ' (' + p.h1s.length + ')'),
        dupTitles: group('title'), dupDescriptions: group('description'),
        noAlt: indexable.reduce((n, p) => n + p.noAlt, 0), images: indexable.reduce((n, p) => n + p.imgs, 0),
        thin: indexable.filter((p) => p.words < 250 && !/impressum|datenschutz|privacy|agb|widerruf|cookie|kontakt|contact|404/i.test(p.url)).map((p) => short(p.url, o) + ' (' + p.words + ' Wörter)'),
        noindex: c.pages.filter((p) => /noindex/.test(p.robots)).map((p) => short(p.url, o))
    };
}

/* -------------------------------------------------------- Rich Results --- */
const LOCAL = /LocalBusiness|Contractor|Electrician|Plumber|HousePainter|HVACBusiness|Locksmith|ProfessionalService|HomeAndConstructionBusiness|Store|AutoRepair|Restaurant|Bakery|HairSalon|BeautySalon|Dentist|Physician|LegalService|AccountingService|RealEstateAgent/i;
function flatten(node, out = []) {
    if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
    else if (node && typeof node === 'object') {
        if (node['@type']) out.push(node);
        if (node['@graph']) flatten(node['@graph'], out);
        Object.keys(node).forEach((k) => { if (k !== '@graph' && node[k] && typeof node[k] === 'object') flatten(node[k], out); });
    }
    return out;
}
const typeOf = (n) => [].concat(n['@type']).join(' ');
const has = (v) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length);

function richResults(pages) {
    const found = [];
    const seenKey = new Set();
    let errors = 0;
    pages.forEach((p) => {
        errors += p.ldErrors;
        flatten(p.jsonld).forEach((n) => {
            const t = typeOf(n);
            if (Object.keys(n).every((k) => ['@id', '@type', 'name'].includes(k))) return; // nur Verweis oder Name (z. B. Zertifikatsgeber, Katalogeintrag)
            const key = t + '|' + (n['@id'] || n.name || JSON.stringify(n).slice(0, 80));
            if (seenKey.has(key)) return;
            seenKey.add(key);
            const miss = [], rec = [];
            let kind = null;
            if (LOCAL.test(t)) {
                kind = 'Firmendaten (' + t.replace(/\s+/g, ', ') + ')';
                const a = n.address || {};
                if (!has(n.name)) miss.push('Name');
                if (!has(a.streetAddress)) miss.push('Straße');
                if (!has(a.postalCode)) miss.push('PLZ');
                if (!has(a.addressLocality)) miss.push('Ort');
                if (!has(n.telephone)) rec.push('Telefon');
                if (!has(n.openingHoursSpecification) && !has(n.openingHours)) rec.push('Öffnungszeiten');
                if (!has(n.geo)) rec.push('Geo-Koordinaten');
                if (!has(n.url)) rec.push('Website-Adresse');
                if (!has(n.image) && !has(n.logo)) rec.push('Bild oder Logo');
                if (!has(n.areaServed)) rec.push('Einsatzgebiet');
                if (!has(n.sameAs)) rec.push('Profile (sameAs)');
            } else if (/FAQPage/.test(t)) {
                kind = 'FAQ';
                const q = [].concat(n.mainEntity || []);
                if (!q.length) miss.push('Fragen (mainEntity)');
                const bad = q.filter((x) => !has(x.name) || !x.acceptedAnswer || !has(x.acceptedAnswer.text)).length;
                if (bad) miss.push(bad + ' Fragen ohne Frage oder Antwort');
            } else if (/BreadcrumbList/.test(t)) {
                kind = 'Brotkrumen-Pfad';
                const items = [].concat(n.itemListElement || []);
                if (!items.length) miss.push('Einträge');
                if (items.some((i) => !has(i.position) || !has(i.name))) miss.push('Position oder Name bei Einträgen');
            } else if (/AggregateRating/.test(t) && !/Review/.test(t)) {
                kind = 'Bewertungs-Sterne';
                if (!has(n.ratingValue)) miss.push('Durchschnitt (ratingValue)');
                if (!has(n.reviewCount) && !has(n.ratingCount)) miss.push('Anzahl der Bewertungen');
                rec.push('Hinweis: Eigene Firmenbewertungen auf der eigenen Website zeigt Google meist nicht als Sterne an, für KI-Antworten und Vertrauen helfen sie trotzdem');
            } else if (/^Review$/.test(t)) {
                kind = 'Bewertung';
                if (!n.reviewRating || !has(n.reviewRating.ratingValue)) miss.push('Sterne');
                if (!has(n.author)) miss.push('Verfasser');
            } else if (/Organization/.test(t) && !LOCAL.test(t)) {
                kind = 'Unternehmen';
                if (!has(n.name)) miss.push('Name');
                if (!has(n.logo)) rec.push('Logo');
                if (!has(n.url)) rec.push('Website-Adresse');
            } else if (/^Service$/.test(t)) {
                kind = 'Leistung';
                if (!has(n.name) && !has(n.serviceType)) miss.push('Name der Leistung');
                if (!has(n.provider)) rec.push('Anbieter (provider)');
                if (!has(n.areaServed)) rec.push('Einsatzgebiet');
            }
            if (kind) found.push({ kind, ok: !miss.length, missing: miss, recommended: rec });
        });
    });
    const kinds = new Set(found.map((f) => f.kind.split(' (')[0]));
    const absent = [];
    if (!kinds.has('Firmendaten')) absent.push('Firmendaten (LocalBusiness): Name, Adresse, Telefon, Öffnungszeiten für Google Maps und KI-Antworten');
    if (!kinds.has('FAQ')) absent.push('FAQ (FAQPage): typische Kundenfragen, die Google und KI-Assistenten direkt zitieren können');
    if (!kinds.has('Brotkrumen-Pfad') && pages.length > 3) absent.push('Brotkrumen-Pfad (BreadcrumbList): zeigt in Google den Weg zur Unterseite');
    return { found, absent, errors };
}

/* --------------------------------------------------------------- Texte --- */
const TRADES = ['maler', 'lackierer', 'elektriker', 'elektro', 'schreiner', 'tischler', 'zimmerer', 'zimmerei', 'dachdecker', 'sanitär', 'heizung', 'installateur', 'fliesen', 'fliesenleger', 'bodenleger', 'parkett', 'stuckateur', 'stuck', 'trockenbau', 'gerüstbau', 'garten', 'galabau', 'landschaftsbau', 'metallbau', 'schlosser', 'glaser', 'fenster', 'rollladen', 'kfz', 'werkstatt', 'fahrzeug', 'friseur', 'bäcker', 'metzger', 'reinigung', 'umzug', 'bau', 'renovierung', 'sanierung', 'fassade', 'webdesign', 'website'];
function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-zäöüß]/g, '');
    if (!w) return 0;
    return Math.max(1, (w.match(/(aa|ee|oo|ie|ei|ai|au|eu|äu|[aeiouyäöü])/g) || []).length);
}
function readability(text) {
    const sentences = text.split(/[.!?…]+(?:\s|$)/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
    const words = sentences.flatMap((s) => s.split(/\s+/).filter((w) => /[a-zäöüß]/i.test(w)));
    if (words.length < 80 || !sentences.length) return null;
    const asl = words.length / sentences.length;
    const asw = words.reduce((n, w) => n + syllables(w), 0) / words.length;
    const score = Math.round(180 - asl - 58.5 * asw); // Amstad: Flesch-Formel für Deutsch
    const long = sentences.filter((s) => s.split(/\s+/).length > 20).length;
    return { score, asl: Math.round(asl * 10) / 10, asw: Math.round(asw * 100) / 100, longShare: Math.round(long / sentences.length * 100),
        level: score >= 60 ? 'leicht verständlich' : score >= 45 ? 'gut lesbar' : score >= 30 ? 'eher schwer' : 'schwer' };
}

function textCheck(c, city, areas) {
    const o = c.origin;
    const home = c.pages.find((p) => { try { return new URL(p.url).pathname === '/' || /\/index\.html?$/.test(new URL(p.url).pathname); } catch (err) { return false; } }) || c.pages[0];
    if (!home) return null;
    const all = c.pages.filter((p) => !/noindex/.test(p.robots));
    const read = readability(all.map((p) => p.text).join('. '));
    const internal = all.map((p) => ({ url: short(p.url, o), n: new Set(p.links.map((h) => normUrl(h, p.url)).filter((u) => u && hostBase(new URL(u).hostname) === hostBase(new URL(o).hostname) && u !== p.url)).size }));
    const fewLinks = internal.filter((x) => x.n < 3).map((x) => x.url + ' (' + x.n + ')');
    const lc = (s) => String(s || '').toLowerCase();
    const trade = TRADES.find((t) => lc(home.title).includes(t) || home.h1s.some((h) => lc(h).includes(t))) || TRADES.find((t) => lc(home.text).includes(t)) || null;
    const base = (x) => lc(x).split(/\s+(?:am|an der|an|bei|im|in|ob|unter)\s+/)[0];
    const places = [...new Set([city, ...(areas || [])].filter(Boolean).map(base))];
    const place = (s) => ({ trade: trade ? lc(s).includes(trade) : null, city: places.length ? places.some((x) => lc(s).includes(x)) : null });
    return {
        readability: read, fewLinks, avgLinks: internal.length ? Math.round(internal.reduce((n, x) => n + x.n, 0) / internal.length) : 0,
        trade, city: [city, ...(areas || []).filter((x) => base(x) !== base(city || ''))].filter(Boolean).slice(0, 3).join(' / ') || null,
        placement: { Seitentitel: place(home.title), Hauptüberschrift: place(home.h1s.join(' ')), 'Meta-Beschreibung': place(home.description), 'Erster Absatz': place(home.firstP) },
        homeWords: home.words
    };
}

/* ---------------------------------------------------------- Gesamtlauf --- */
async function audit(target, opts = {}) {
    const t = A.normalizeTarget(target);
    if (!t) throw new Error('Ungültige Adresse');
    const c = await crawl(t.url);
    if (!c.pages.length) throw new Error('Keine Seite abrufbar');
    const rich = richResults(c.pages);
    const ldCity = (() => { for (const p of c.pages) for (const n of flatten(p.jsonld)) if (n.address && n.address.addressLocality) return n.address.addressLocality; return null; })();
    const areas = [...new Set(c.pages.flatMap((p) => flatten(p.jsonld)).filter((n) => n.areaServed).flatMap((n) => [].concat(n.areaServed)).map((x) => (typeof x === 'string' ? x : x && x.name)).filter((x) => x && x.length < 40))].slice(0, 6);
    const city = opts.city || ldCity || ((c.pages[0].text.match(/\b\d{5}\s+([A-ZÄÖÜ][a-zäöüß]+(?:[-\s](?:am|an der|bei|im|in)\s[A-ZÄÖÜ][a-zäöüß]+)?)/) || [])[1]) || null;
    return { url: t.url, at: new Date().toISOString(), crawl: crawlIssues(c), rich, text: textCheck(c, city, areas) };
}

/* Kurzfassung je Bereich: Anzahl Probleme (für Angebot und Kopfzeile) */
function counts(a) {
    if (!a) return null;
    const cr = a.crawl;
    return {
        pages: cr.checked, broken: cr.broken.length,
        meta: cr.noTitle.length + cr.noDescription.length + cr.badDescription.length + cr.noH1.length + cr.dupTitles.length,
        rich: a.rich.found.filter((f) => !f.ok).length + a.rich.absent.length + (a.rich.errors ? 1 : 0),
        text: (a.text && a.text.readability && a.text.readability.score < 45 ? 1 : 0) + (a.text ? a.text.fewLinks.length : 0)
    };
}

if (require.main === module) {
    audit(process.argv[2] || 'mw-itservices.de').then((a) => console.log(JSON.stringify(a, null, 2))).catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
}
module.exports = { audit, counts, readability, richResults, privateIp };
