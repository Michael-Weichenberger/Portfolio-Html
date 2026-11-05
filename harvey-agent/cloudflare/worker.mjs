/* =============================================================================
   MW SICHTBARKEITS-CHECK · Cloudflare Worker (öffentlich)
   Führt für den Live-Test auf mw-itservices.de dieselbe Messung aus wie der
   Kasi-Agent (core/analyze.js) und bewertet mit vis-rules.js.

   GET  /analyze?url=huber-maler.de   Report im Format version 3
   POST /lead                         Report-Anfrage speichern (für das Dashboard)
   GET  /report?id=<id>               im Dashboard freigegebener Teaser
   POST /webhook/cal                  Cal.com: Termin gebucht/abgesagt (Secret CAL_WEBHOOK_SECRET)

   Secrets / Variablen / Bindings (siehe wrangler.toml und README):
     PSI_API_KEY      PageSpeed-Schlüssel ohne Website-Beschränkung (Secret)
     ALLOWED_ORIGINS  erlaubte Herkunft, kommagetrennt
     DB               D1-Datenbank harvey-leads
   ============================================================================= */
import VisRules from '../../vis-rules.js';
import core from '../core/analyze.js';
import store from '../core/store.js';
import Offer from '../../offer-rules.js';

const CACHE_SECONDS = 6 * 60 * 60; // gleiche Domain wird 6 Stunden nicht neu gemessen
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$/i;

function corsHeaders(origin, env) {
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = origin && allowed.includes(origin);
    return {
        ok,
        headers: {
            'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin'
        }
    };
}

function json(body, status, headers) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers }
    });
}

function cacheKey(target) {
    return new Request('https://cache.mw-check/v2/' + encodeURIComponent(target.url));
}

/* Messung aus dem Cache: { report, psi, structure } */
async function cached(target) {
    const hit = await caches.default.match(cacheKey(target));
    return hit ? hit.json() : null;
}

async function analyze(target, env, ctx) {
    const site = await core.analyzeSite(target, { psiKey: env.PSI_API_KEY, psiTimeoutMs: 80000 });
    if (!site.structure && !site.lighthouse) return { error: site.unreachable ? 'unreachable' : 'unavailable' };
    const psi = site.lighthouse ? VisRules.metricsFromLighthouse(site.lighthouse) : null;
    const report = VisRules.buildReport({
        url: target.url,
        name: target.name,
        psi,
        structure: site.structure,
        source: psi && site.structure ? 'Google PageSpeed und Strukturanalyse' : psi ? 'Google PageSpeed Insights' : 'Strukturanalyse'
    });
    const entry = { report, psi, structure: site.structure };
    if (psi && site.structure && ctx) {
        ctx.waitUntil(caches.default.put(cacheKey(target), new Response(JSON.stringify(entry), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_SECONDS }
        })));
    }
    return entry;
}

async function limited(request, env) {
    if (!env.RATE_LIMITER) return false;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    return !success;
}

async function handleAnalyze(url, env, ctx, cors) {
    const target = core.normalizeTarget(url.searchParams.get('url'));
    if (!target) return json({ error: 'invalid_url' }, 400, cors.headers);
    const hit = await cached(target);
    if (hit) return json(hit.report, 200, { 'X-Cache': 'HIT', ...cors.headers });
    let entry;
    try {
        entry = await analyze(target, env, ctx);
    } catch (err) {
        return json({ error: 'failed' }, 502, cors.headers);
    }
    if (entry.error) return json({ error: entry.error }, entry.error === 'unreachable' ? 422 : 503, cors.headers);
    return json(entry.report, 200, { 'X-Cache': 'MISS', ...cors.headers });
}

/* Report-Anfrage: E-Mail + Einwilligung + geprüfte Adresse. Die Messung kommt aus
   dem Cache des gerade gelaufenen Tests; fehlt sie, misst das Dashboard nach. */
/* Herkunft aus den Kampagnen-Parametern des Links (utm_*). Nur kurze, harmlose Werte. */
function cleanSource(s) {
    if (!s || typeof s !== 'object') return null;
    const out = {};
    for (const k of ['source', 'medium', 'campaign', 'content']) {
        const v = String(s[k] == null ? '' : s[k]).toLowerCase().trim().slice(0, 60);
        if (/^[a-z0-9._-]+$/.test(v)) out[k] = v;
    }
    return out.source ? out : null;
}

async function handleLead(request, env, cors) {
    if (!env.DB) return json({ error: 'unavailable' }, 503, cors.headers);
    let d;
    try {
        d = await request.json();
    } catch (err) {
        return json({ error: 'invalid_body' }, 400, cors.headers);
    }
    const email = String(d && d.email || '').trim().slice(0, 200);
    if (!d || !EMAIL_RE.test(email)) return json({ error: 'invalid_lead' }, 400, cors.headers);
    if (d.kind === 'paket') return handlePackage(d, email, env, cors);
    if (d.consent !== true) return json({ error: 'invalid_lead' }, 400, cors.headers);
    const target = core.normalizeTarget(d.url);
    if (!target) return json({ error: 'invalid_url' }, 400, cors.headers);

    const id = store.makeId(target.name);
    const hit = await cached(target);
    const ev = store.evaluate('anfrage', target, id, hit);
    await store.insert(env.DB, {
        id, kind: 'anfrage', name: target.name, url: target.url, email, consentAt: new Date().toISOString(),
        report: ev.report, findings: ev.findings, measuredAt: ev.measuredAt, subject: ev.subject, body: ev.body, source: cleanSource(d.source)
    });
    return json({ id }, 201, cors.headers);
}

/* Anfrage aus dem Anfrageformular / Projekt-Planer (vorvertraglich, Art. 6 Abs. 1 lit. b DSGVO).
   Kasi legt sofort einen Angebotsvorschlag an. */
async function handlePackage(d, email, env, cors) {
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const name = str(d.name, 120);
    if (name.length < 2) return json({ error: 'invalid_lead' }, 400, cors.headers);
    const selection = d.selection && typeof d.selection === 'object' ? Offer.normalize(d.selection) : null;
    const entry = { kind: 'paket', name, email, phone: str(d.phone, 40), topic: str(d.topic, 400), message: str(d.message, 1000), selection };
    const id = store.makeId(name);
    const draft = store.draftFor('paket', entry);
    await store.insert(env.DB, { ...entry, id, url: '', subject: draft.subject, body: draft.body, source: cleanSource(d.source) });
    return json({ id }, 201, cors.headers);
}

/* Cal.com-Webhook: gebuchter oder abgesagter Termin → Status „Termin“ im Dashboard.
   Signatur: X-Cal-Signature-256 = HMAC-SHA256(Secret CAL_WEBHOOK_SECRET, Rohdaten) als Hex. */
async function handleCalWebhook(request, env) {
    if (!env.DB || !env.CAL_WEBHOOK_SECRET) return json({ error: 'not_configured' }, 503);
    const raw = await request.text();
    if (raw.length > 100000) return json({ error: 'too_large' }, 413);
    const sig = (request.headers.get('X-Cal-Signature-256') || '').trim().toLowerCase();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CAL_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, '0')).join('');
    let diff = sig.length ^ mac.length;
    for (let i = 0; i < Math.min(sig.length, mac.length); i++) diff |= sig.charCodeAt(i) ^ mac.charCodeAt(i);
    if (diff !== 0) return json({ error: 'bad_signature' }, 401);
    let d;
    try { d = JSON.parse(raw); } catch (err) { return json({ error: 'invalid_body' }, 400); }
    const p = d.payload || {};
    const attendee = (p.attendees || [])[0] || {};
    const trigger = String(d.triggerEvent || '');
    if (!['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'].includes(trigger)) return json({ ok: true, ignored: trigger });
    const id = await store.bookingEvent(env.DB, { email: attendee.email, name: attendee.name, start: p.startTime, title: p.title, cancelled: trigger === 'BOOKING_CANCELLED' });
    return json({ ok: true, id });
}

async function handleReport(url, env, cors) {
    const id = String(url.searchParams.get('id') || '');
    if (!env.DB || !/^[a-z0-9-]{3,90}$/.test(id)) return json({ error: 'not_found' }, 404, cors.headers);
    const report = await store.publicReport(env.DB, id);
    if (!report) return json({ error: 'not_found' }, 404, cors.headers);
    return json(report, 200, { 'Cache-Control': 'public, max-age=300', ...cors.headers });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '';
        const cors = corsHeaders(origin, env);
        const route = request.method + ' ' + url.pathname;

        // Server-zu-Server (Cal.com), eigene Signaturprüfung statt Origin
        if (route === 'POST /webhook/cal') return handleCalWebhook(request, env);
        if (request.method === 'OPTIONS') return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
        if (!['GET /analyze', 'POST /lead', 'GET /report'].includes(route)) return json({ error: 'not_found' }, 404, cors.headers);
        if (!cors.ok) return json({ error: 'origin_not_allowed' }, 403, cors.headers);
        if (route !== 'GET /report' && await limited(request, env)) return json({ error: 'rate_limited' }, 429, cors.headers);

        if (route === 'GET /analyze') return handleAnalyze(url, env, ctx, cors);
        if (route === 'POST /lead') return handleLead(request, env, cors);
        return handleReport(url, env, cors);
    }
};
