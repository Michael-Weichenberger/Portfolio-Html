/* =============================================================================
   CORE · Messung einer Website (ohne Abhängigkeiten)
   Läuft in Node 18+ (Kasi-Agent) und im Cloudflare Worker (Live-Test).
   Liefert Rohdaten; bewertet wird ausschließlich in vis-rules.js.
   ============================================================================= */
'use strict';

const UA = 'Mozilla/5.0 (compatible; MW-Sichtbarkeitscheck/2.0; +https://mw-itservices.de)';
const MAX_HTML = 3 * 1024 * 1024;
const LOCAL_TYPES = /LocalBusiness|HomeAndConstructionBusiness|Electrician|Plumber|RoofingContractor|HousePainter|GeneralContractor|HVACBusiness|Locksmith|MovingCompany|AutoRepair|AutomotiveBusiness|Store|ProfessionalService|Dentist|Physician|MedicalBusiness|LegalService|Attorney|Notary|AccountingService|FinancialService|Restaurant|FoodEstablishment|Bakery|BeautySalon|HairSalon|HealthAndBeautyBusiness|LodgingBusiness|RealEstateAgent|EmploymentAgency|TravelAgency|SportsActivityLocation|ChildCare|DryCleaningOrLaundry|EntertainmentBusiness/i;
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

/* ------------------------------------------------------------- Eingabe --- */

function isPublicHost(host) {
    const h = String(host || '').toLowerCase();
    if (!h || h === 'localhost' || /\.(local|localhost|internal|lan|home|test|invalid)$/.test(h)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return false; // keine IP-Adressen
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(h);
}

function normalizeTarget(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
        const u = new URL(s);
        if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
        return { url: u.origin + u.pathname, origin: u.origin, host: u.hostname, name: u.hostname.replace(/^www\./i, '') };
    } catch (err) {
        return null;
    }
}

/* ------------------------------------------------------------- Abrufen --- */

async function get(url, opts = {}, ms = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, {
            redirect: opts.redirect || 'follow',
            method: opts.method || 'GET',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', Accept: opts.accept || 'text/html,application/xhtml+xml,*/*;q=0.8' }
        });
    } finally {
        clearTimeout(t);
    }
}

async function readText(res, limit = MAX_HTML) {
    const text = await res.text();
    return text.length > limit ? text.slice(0, limit) : text;
}

/* --------------------------------------------------------- HTML-Helfer --- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', copy: '©', reg: '®' };
function decode(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
        }
        return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
    });
}
const stripTags = (s) => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function attrs(tag) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const inner = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
    let m;
    while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
    return out;
}
const tags = (html, name) => html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];

/* ------------------------------------------------------- Schema.org --- */

function collectSchema(html) {
    const nodes = [];
    const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    const walk = (n, depth) => {
        if (!n || typeof n !== 'object' || depth > 12) return;
        if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
        nodes.push(n);
        Object.keys(n).forEach((k) => { if (n[k] && typeof n[k] === 'object') walk(n[k], depth + 1); });
    };
    while ((m = re.exec(html))) {
        try { walk(JSON.parse(m[1].trim()), 0); } catch (err) { /* kaputtes JSON-LD zählt nicht */ }
    }
    const typeOf = (n) => [].concat(n['@type'] || []).map(String);
    const types = [...new Set(nodes.flatMap(typeOf))];
    const local = nodes.find((n) => typeOf(n).some((t) => LOCAL_TYPES.test(t)));
    const any = (fn) => nodes.some((n) => { try { return fn(n); } catch (err) { return false; } });
    const sameAs = nodes.flatMap((n) => [].concat(n.sameAs || [])).map(String);
    const addr = local && local.address && (Array.isArray(local.address) ? local.address[0] : local.address);
    return {
        types,
        localBusiness: Boolean(local),
        addressLocality: addr && typeof addr === 'object' ? addr.addressLocality || null : null,
        hasAddress: Boolean(addr),
        hasPhone: Boolean(local && local.telephone),
        hasHours: Boolean(local && (local.openingHours || local.openingHoursSpecification)),
        hasGeo: Boolean((local && local.geo) || any((n) => typeOf(n).includes('GeoCoordinates'))),
        hasArea: Boolean((local && local.areaServed) || any((n) => n.areaServed)),
        hasRating: any((n) => n.aggregateRating || typeOf(n).some((t) => /^(AggregateRating|Review)$/.test(t))),
        hasServices: any((n) => n.hasOfferCatalog || n.makesOffer || typeOf(n).some((t) => /^(Service|OfferCatalog)$/.test(t))),
        hasFaq: types.includes('FAQPage'),
        hasSameAs: sameAs.length > 0,
        sameAsGoogle: sameAs.some((u) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page|business\.google/i.test(u)),
        hasMap: any((n) => n.hasMap)
    };
}

/* --------------------------------------------------- robots / Dateien --- */

function parseRobots(body) {
    const groups = [];
    let cur = null;
    String(body || '').split(/\r?\n/).forEach((line) => {
        const l = line.replace(/#.*/, '').trim();
        const m = l.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
        if (!m) return;
        if (/user-agent/i.test(m[1])) {
            if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
            cur.agents.push(m[2].trim().toLowerCase());
        } else if (cur) cur.rules.push(m[2].trim());
    });
    const blocks = (agent) => groups.some((g) => g.agents.includes(agent.toLowerCase()) && g.rules.includes('/'));
    return { found: true, blocksAll: blocks('*'), blockedAiBots: AI_BOTS.filter((b) => blocks(b)) };
}

async function fetchRobots(origin) {
    try {
        const r = await get(origin + '/robots.txt', { accept: 'text/plain' }, 8000);
        if (!r.ok) return { found: false, blocksAll: false, blockedAiBots: [] };
        return parseRobots(await readText(r, 200000));
    } catch (err) {
        return null; // unbekannt
    }
}

async function fetchLlms(origin) {
    try {
        const r = await get(origin + '/llms.txt', { accept: 'text/plain,text/markdown' }, 8000);
        if (!r.ok) return false;
        const t = (await readText(r, 20000)).trim();
        return t.length > 40 && !/<html|<!doctype/i.test(t.slice(0, 500));
    } catch (err) {
        return null;
    }
}

async function checkHttpRedirect(host) {
    try {
        const r = await get('http://' + host + '/', { redirect: 'manual' }, 8000);
        if (r.status === 0) return null; // opak (Browser), nicht auswertbar
        const loc = r.headers.get('location') || '';
        return r.status >= 300 && r.status < 400 && /^https:\/\//i.test(loc);
    } catch (err) {
        return null;
    }
}

/* ------------------------------------------------------ Strukturanalyse --- */

/* ------------------------------------------------- Technik & Code-Aufbau --- */

const BUILDERS = [
    ['Elementor', /\/plugins\/elementor(-pro)?\/|elementor-frontend|class=["'][^"']*elementor-/i],
    ['Divi', /\/themes\/Divi\/|et_pb_|et-divi/i],
    ['WPBakery', /\/plugins\/js_composer\/|vc_row|wpb_wrapper/i],
    ['Avada (Fusion Builder)', /\/themes\/Avada\/|fusion-builder|fusion-layout/i],
    ['Oxygen', /\/plugins\/oxygen\/|ct-section|oxy-/i],
    ['Beaver Builder', /\/plugins\/bb-plugin\/|fl-builder/i],
    ['Bricks', /\/themes\/bricks\/|brxe-/i],
    ['Enfold', /\/themes\/enfold\/|av_section/i]
];
const CACHE_PLUGINS = /^(wp-rocket|w3-total-cache|wp-super-cache|litespeed-cache|wp-fastest-cache|autoptimize|sg-cachepress|breeze|hummingbird-performance|wp-optimize|perfmatters|flying-press|nitropack|swift-performance)/;
const HEAVY_PLUGINS = { revslider: 'Slider Revolution', layerslider: 'LayerSlider', js_composer: 'WPBakery', jetpack: 'Jetpack', 'essential-addons-for-elementor-lite': 'Essential Addons', 'ultimate-elementor': 'Ultimate Addons', 'elementor-pro': 'Elementor Pro', woocommerce: 'WooCommerce', 'smart-slider-3': 'Smart Slider', 'master-slider': 'Master Slider', 'premium-addons-for-elementor': 'Premium Addons', 'wpforms-lite': 'WPForms', 'contact-form-7': 'Contact Form 7', 'the-events-calendar': 'The Events Calendar' };
const OTHER_CMS = [
    ['Wix', /static\.wixstatic\.com|wix-bolt|x-wix-/i],
    ['Jimdo', /jimdo|jimstatic\.com/i],
    ['Squarespace', /static1\.squarespace\.com|squarespace-cdn/i],
    ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
    ['Webflow', /webflow\.js|data-wf-page/i],
    ['TYPO3', /typo3conf\/|typo3temp\/|content="TYPO3/i],
    ['Joomla', /content="Joomla|\/media\/jui\/|\/components\/com_/i],
    ['Drupal', /content="Drupal|\/sites\/default\/files\//i]
];

function detectTech(html, head, body, headers, finalUrl, raw) {
    const own = new URL(finalUrl).hostname.replace(/^www\./i, '');
    const gen = ((head.match(/<meta[^>]+name=["']generator["'][^>]*>/i) || [])[0] || '').match(/content=["']([^"']+)/i);
    const generator = gen ? gen[1].slice(0, 60) : null;
    const isWp = /\/wp-content\/|\/wp-includes\/|wp-json/i.test(html) || /wordpress/i.test(generator || '');
    let cms = isWp ? 'WordPress' : null;
    if (!cms) { const o = OTHER_CMS.find(([, re]) => re.test(html) || re.test(generator || '')); cms = o ? o[0] : null; }
    const version = isWp && generator ? ((generator.match(/WordPress\s*([\d.]+)/i) || [])[1] || null) : null;
    const plugins = isWp ? [...new Set([...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)].map((m) => m[1].toLowerCase()))].slice(0, 40) : [];
    const theme = isWp ? ((html.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//i) || [])[1] || null) : null;
    const builder = (BUILDERS.find(([, re]) => re.test(html)) || [])[0] || null;

    const scriptTags = tags(html, 'script').map(attrs).filter((a) => a.src || a['data-src']).map((a) => ({ ...a, src: a.src || a['data-src'] }));
    const headScripts = tags(head, 'script').map(attrs).filter((a) => a.src);
    const blocking = headScripts.filter((a) => a.async === undefined && a.defer === undefined && !/module/i.test(a.type || ''));
    const styles = tags(html, 'link').map(attrs).filter((a) => /stylesheet/i.test(a.rel || ''));
    const inlineCssKB = Math.round((html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).reduce((n, s) => n + s.length, 0) / 1024);
    const hostOf = (u) => { try { return new URL(u, finalUrl).hostname.replace(/^www\./i, ''); } catch (_) { return null; } };
    const thirdParty = [...new Set(scriptTags.map((a) => hostOf(a.src)).filter((h) => h && h !== own && !h.endsWith('.' + own)))].slice(0, 12);

    const imgs = tags(body, 'img').map(attrs);
    const srcOf = (a) => a['data-src'] || a['data-lazy-src'] || a.src || '';
    const modernSources = (html.match(/<source\b[^>]*type=["']image\/(webp|avif)["']/gi) || []).length;
    const ext = (s) => ((s.split('?')[0].match(/\.(jpe?g|png|gif|webp|avif|svg)$/i) || [])[1] || '').toLowerCase();
    const legacy = imgs.filter((a) => /^(jpe?g|png|gif)$/.test(ext(srcOf(a)))).length;
    const modern = imgs.filter((a) => /^(webp|avif)$/.test(ext(srcOf(a)))).length + modernSources;
    const lazy = imgs.filter((a) => /lazy/i.test(a.loading || '') || a['data-src'] || a['data-lazy-src']).length;
    const noSize = imgs.filter((a) => !a.width || !a.height).length;

    // Im Cloudflare-Worker stammen Server-, CDN- und Komprimierungs-Header von Cloudflare selbst, nicht vom Webserver
    const inWorker = typeof WebSocketPair !== 'undefined';
    const h = (n) => (inWorker && /^(server|cf-ray|cf-cache-status|content-encoding)$/.test(n) ? null : headers.get(n));
    return {
        cms, version, generator, theme, builder,
        plugins, pluginCount: plugins.length,
        cachePlugin: plugins.find((p) => CACHE_PLUGINS.test(p)) || null,
        heavyPlugins: plugins.filter((p) => HEAVY_PLUGINS[p]).map((p) => HEAVY_PLUGINS[p]),
        scripts: scriptTags.length, blockingScripts: blocking.length, stylesheets: styles.length, inlineCssKB,
        jquery: /jquery(\.min)?\.js/i.test(html),
        thirdParty,
        images: imgs.length, legacyImages: legacy, modernImages: modern, lazyImages: lazy, imagesNoSize: noSize,
        googleFonts: /fonts\.(googleapis|gstatic)\.com/i.test(html),
        compression: (h('content-encoding') || '').toLowerCase() || null,
        cacheControl: h('cache-control') ? String(h('cache-control')).slice(0, 80) : null,
        server: (h('server') || h('x-powered-by') || '').slice(0, 40) || null,
        cdn: h('cf-ray') ? 'Cloudflare' : h('x-amz-cf-id') ? 'CloudFront' : h('x-served-by') && /cache/i.test(h('x-served-by')) ? 'Fastly' : null,
        pageCache: Boolean(h('x-litespeed-cache') || h('x-cache') || h('x-wp-rocket') || h('cf-cache-status') === 'HIT' || /wp-rocket|this website is like a rocket|cache enabler|wp super cache|w3 total cache|litespeed cache/i.test(String(raw || '').slice(-3000)))
    };
}

async function analyzeStructure(target) {
    const started = Date.now();
    const res = await get(target.url, {}, 20000);
    const ttfbMs = Date.now() - started;
    if (!res.ok) throw Object.assign(new Error('Seite antwortet mit HTTP ' + res.status), { kind: 'unreachable' });
    const raw = await readText(res);
    const finalUrl = res.url || target.url;
    const final = new URL(finalUrl);
    const html = raw.replace(/<!--[\s\S]*?-->/g, '');
    const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [html])[0];
    const body = (html.match(/<body\b[\s\S]*<\/body>/i) || [html])[0];
    const textBody = body.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
    const text = stripTags(textBody);

    const metas = tags(head, 'meta').map(attrs);
    const meta = (name) => (metas.find((m) => (m.name || m.property || '').toLowerCase() === name) || {}).content;
    const title = stripTags((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const h1s = (body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map(stripTags);
    const h2Count = (body.match(/<h2\b/gi) || []).length;
    const schema = collectSchema(html);

    const anchors = [];
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = aRe.exec(body))) anchors.push({ href: attrs('<a ' + m[1] + '>').href || '', text: stripTags(m[2]) });
    const hrefs = anchors.map((a) => a.href);
    const linkMatch = (re) => anchors.some((a) => re.test(a.href) || re.test(a.text));

    const hostBase = final.hostname.replace(/^www\./i, '');
    const pages = new Set();
    anchors.forEach((a) => {
        if (!a.href || /^(#|mailto:|tel:|javascript:)/i.test(a.href)) return;
        try {
            const u = new URL(a.href, finalUrl);
            if (u.hostname.replace(/^www\./i, '') !== hostBase) return;
            const p = u.pathname.replace(/\/index\.(html?|php)$/i, '/').replace(/\/+$/, '') || '/';
            if (p === '/' || /impressum|datenschutz|privacy|agb|kontakt|contact|cookie|login|wp-|sitemap|\.(pdf|jpe?g|png|webp|svg|gif|zip|xml)$/i.test(p)) return;
            pages.add(p.toLowerCase());
        } catch (err) { /* ungültiger Link */ }
    });

    const questions = (body.match(/<(h[2-4]|summary|dt|button)\b[^>]*>([\s\S]*?)<\/\1>/gi) || []).map(stripTags).filter((t) => /\?\s*$/.test(t) && t.length > 10);
    const plz = text.match(/\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß]+(?:[-\s](?:am|an der|bei|im|in|ob)?\s?[A-ZÄÖÜ][a-zäöüß]+)?)/);
    const city = schema.addressLocality || (plz && plz[2]) || null;

    const [robots, llmsTxt, httpRedirects, sitemap] = await Promise.all([
        fetchRobots(final.origin),
        fetchLlms(final.origin),
        final.protocol === 'https:' ? checkHttpRedirect(final.hostname) : Promise.resolve(false),
        get(final.origin + '/sitemap.xml', { accept: 'application/xml,text/xml' }, 8000)
            .then(async (r) => r.ok && /<(urlset|sitemapindex)/i.test((await readText(r, 4000)))).catch(() => null)
    ]);

    return {
        status: res.status,
        finalUrl,
        https: final.protocol === 'https:',
        hsts: Boolean(res.headers.get('strict-transport-security')),
        httpRedirects,
        ttfbMs,
        htmlKB: Math.round(raw.length / 1024),
        title,
        description: (meta('description') || '').trim(),
        h1: h1s[0] || '',
        h1Count: h1s.length,
        h2Count,
        viewport: metas.some((mm) => (mm.name || '').toLowerCase() === 'viewport'),
        lang: attrs((html.match(/<html\b[^>]*>/i) || ['<html>'])[0]).lang || null,
        openGraph: Boolean(meta('og:title')),
        words: text ? text.split(' ').filter((w) => /[a-zäöüß]{2,}/i.test(w)).length : 0,
        schemaTypes: schema.types,
        localBusiness: schema.localBusiness,
        schemaHasAddress: schema.hasAddress,
        schemaHasPhone: schema.hasPhone,
        schemaHasHours: schema.hasHours,
        schemaHasGeo: schema.hasGeo,
        schemaHasArea: schema.hasArea,
        schemaHasRating: schema.hasRating,
        schemaHasServices: schema.hasServices,
        schemaHasSameAs: schema.hasSameAs,
        sameAsGoogle: schema.sameAsGoogle,
        hasFaq: schema.hasFaq || questions.length >= 3,
        city,
        addressVisible: Boolean(plz),
        telLinks: hrefs.filter((h) => /^tel:/i.test(h)).length,
        hasMaps: schema.hasMap || hrefs.some((h) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page/i.test(h))
            || /<iframe\b[^>]*(?:src|data-src)\s*=\s*["'][^"']*google\.[a-z.]+\/maps/i.test(body),
        hasImpressum: linkMatch(/impressum/i),
        hasPrivacy: linkMatch(/datenschutz|privacy/i),
        internalPages: pages.size,
        robots,
        llmsTxt,
        sitemap,
        tech: detectTech(html, head, body, res.headers, finalUrl, raw)
    };
}

/* ----------------------------------------------------------- PageSpeed --- */

async function runPageSpeed(url, key, ms = 90000) {
    const params = new URLSearchParams({ url, strategy: 'mobile', locale: 'de' });
    ['performance', 'seo', 'accessibility', 'best-practices'].forEach((c) => params.append('category', c));
    if (key) params.set('key', key);
    const res = await get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + params, { accept: 'application/json' }, ms);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.lighthouseResult) {
        const msg = (data && data.error && data.error.message) || 'HTTP ' + res.status;
        const kind = /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|NO_FCP|NOT_HTML|unable to resolve/i.test(msg) ? 'unreachable' : 'unavailable';
        throw Object.assign(new Error(msg), { kind });
    }
    return data.lighthouseResult;
}

/* Beides parallel; ein Teil darf fehlen, solange einer klappt. */
async function analyzeSite(target, opts = {}) {
    const [st, lr] = await Promise.allSettled([analyzeStructure(target), runPageSpeed(target.url, opts.psiKey, opts.psiTimeoutMs)]);
    return {
        structure: st.status === 'fulfilled' ? st.value : null,
        structureError: st.status === 'rejected' ? String((st.reason && st.reason.message) || st.reason).slice(0, 200) : null,
        lighthouse: lr.status === 'fulfilled' ? lr.value : null,
        psiError: lr.status === 'rejected' ? String((lr.reason && lr.reason.message) || lr.reason).slice(0, 200) : null,
        unreachable: st.status === 'rejected' && lr.status === 'rejected' && [st.reason, lr.reason].some((r) => r && r.kind === 'unreachable')
    };
}

module.exports = { normalizeTarget, isPublicHost, analyzeStructure, runPageSpeed, analyzeSite, parseRobots, get, readText, decode, stripTags, attrs };
