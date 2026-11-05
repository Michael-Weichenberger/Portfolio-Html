/* =============================================================================
   KASI DASHBOARD · Cloudflare Worker (privat, hinter Cloudflare Access)
   Liefert die Oberfläche aus public/ und die API für Anfragen und Akquise.

   Jede Anfrage braucht ein gültiges Cloudflare-Access-Token. Ohne die Variablen
   ACCESS_TEAM_DOMAIN und ACCESS_AUD bleibt das Dashboard gesperrt.
   Nur für lokale Tests (wrangler dev): DEV_NO_AUTH=1 in .dev.vars.

   API (alle Antworten JSON, schreibende Aufrufe brauchen Header X-Harvey: 1)
     GET    /api/config                Status, Arten, Projektschritte, Preise, Zähler
     GET    /api/overview              Kennzahlen, Wiedervorlagen, Projekte, Verlauf
     GET    /api/export                alle Daten als JSON (Sicherung, DSGVO-Auskunft)
     GET    /api/leads?kind=&status=&view=due|kunden&q=
     GET    /api/leads/:id
     PATCH  /api/leads/:id             status, notes, subject, body, email, phone, published, sentAt,
                                       followUp, valueOnce, valueMonth, startAt, checklist
     POST   /api/leads/:id/measure     neu messen (aktualisiert Report und Befunde)
     POST   /api/leads/:id/draft       Vorschlag aus den Bausteinen neu erstellen
     POST   /api/leads/:id/offer       { selection } Angebot mit neuer Auswahl erstellen (Paket-Anfragen)
     DELETE /api/leads/:id
     POST   /api/prospects             { url } messen und als Akquise anlegen
     POST   /api/quote                 { selection } Summen für die Angebots-Vorschau
   ============================================================================= */
import VisRules from '../../../vis-rules.js';
import core from '../../core/analyze.js';
import store from '../../core/store.js';
import Offer from '../../../offer-rules.js';

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store'
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
}

/* ---------- Cloudflare Access: JWT prüfen (RS256, Schlüssel der Team-Domain) ---------- */
let certCache = { at: 0, keys: [] };

function b64url(s) {
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

async function accessKeys(team) {
    if (Date.now() - certCache.at < 3600e3 && certCache.keys.length) return certCache.keys;
    const res = await fetch(team + '/cdn-cgi/access/certs');
    if (!res.ok) throw new Error('certs ' + res.status);
    const { keys } = await res.json();
    certCache = { at: Date.now(), keys };
    return keys;
}

async function verifyAccess(request, env) {
    if (env.DEV_NO_AUTH === '1') return { email: 'dev@localhost' };
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
    const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    const token = request.headers.get('Cf-Access-Jwt-Assertion') || (cookie && cookie[1]);
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
        const payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
        if (header.alg !== 'RS256') return null;
        const team = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
        const jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
        if (!jwk) return null;
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        const nowS = Date.now() / 1000;
        if (!ok || !aud.includes(env.ACCESS_AUD) || payload.iss !== team || !(payload.exp > nowS)) return null;
        return { email: payload.email || '' };
    } catch (err) {
        return null;
    }
}

/* ---------- Messung ---------- */
async function measure(target, env) {
    const site = await core.analyzeSite(target, { psiKey: env.PSI_API_KEY, psiTimeoutMs: 90000 });
    if (!site.structure && !site.lighthouse) return { error: site.unreachable ? 'unreachable' : 'unavailable' };
    return { psi: site.lighthouse ? VisRules.metricsFromLighthouse(site.lighthouse) : null, structure: site.structure };
}

/* ---------- API ---------- */
async function api(request, env, url) {
    const db = env.DB;
    const method = request.method;
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    if (method !== 'GET' && request.headers.get('X-Harvey') !== '1') return json({ error: 'forbidden' }, 403);
    const body = method === 'POST' || method === 'PATCH' ? await request.json().catch(() => ({})) : null;

    if (parts[0] === 'config' && method === 'GET') {
        return json({ statuses: store.STATUSES, kinds: store.KINDS, steps: store.PROJECT_STEPS, counts: await store.counts(db), titles: VisRules.TITLES, statusText: VisRules.STATUS_TEXT,
            prices: Offer.PRICES, promo: { ...Offer.PROMO, active: Offer.promoActive() } });
    }
    if (parts[0] === 'overview' && method === 'GET') return json(await store.overview(db));
    if (parts[0] === 'export' && method === 'GET') {
        const data = await store.exportAll(db);
        return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="harvey-export-' + data.exportedAt.slice(0, 10) + '.json"', ...SECURITY_HEADERS } });
    }
    if (parts[0] === 'leads' && parts.length === 1 && method === 'GET') {
        return json(await store.list(db, { kind: url.searchParams.get('kind'), status: url.searchParams.get('status'),
            view: url.searchParams.get('view'), q: url.searchParams.get('q') }));
    }
    if (parts[0] === 'quote' && method === 'POST') {
        return json(Offer.quote(body.selection));
    }
    if (parts[0] === 'prospects' && parts.length === 1 && method === 'POST') {
        const target = core.normalizeTarget(body.url);
        if (!target) return json({ error: 'invalid_url', message: 'Keine gültige öffentliche Domain.' }, 400);
        const m = await measure(target, env);
        if (m.error) return json({ error: m.error, message: m.error === 'unreachable' ? target.name + ' ist nicht erreichbar.' : 'Messung gerade nicht möglich, bitte später erneut.' }, 422);
        const id = store.makeId(target.name);
        const ev = store.evaluate('akquise', target, id, m);
        await store.insert(db, { id, kind: 'akquise', name: target.name, url: target.url, report: ev.report, findings: ev.findings,
            measuredAt: ev.measuredAt, subject: ev.subject, body: ev.body });
        return json(await store.get(db, id), 201);
    }
    if (parts[0] !== 'leads' || !parts[1] || !/^[a-z0-9-]{3,90}$/.test(parts[1])) return json({ error: 'not_found' }, 404);

    const id = parts[1];
    const lead = await store.get(db, id);
    if (!lead) return json({ error: 'not_found' }, 404);
    const action = parts[2];

    if (!action && method === 'GET') return json(lead);
    if (!action && method === 'PATCH') {
        const { logDraft, report, findings, selection, ...patch } = body || {};
        return json(await store.update(db, id, patch, lead));
    }
    if (!action && method === 'DELETE') { await store.remove(db, id); return json({ ok: true }); }
    if (action === 'measure' && method === 'POST') {
        const target = core.normalizeTarget(lead.url);
        const m = target ? await measure(target, env) : { error: 'invalid_url' };
        if (m.error) return json({ error: m.error, message: 'Messung nicht möglich (' + m.error + ').' }, 422);
        const ev = store.evaluate(lead.kind, { url: lead.url, name: lead.name }, id, m);
        const patch = { report: ev.report, findings: ev.findings, measuredAt: ev.measuredAt };
        if (!lead.body || body.redraft) Object.assign(patch, { subject: ev.subject, body: ev.body });
        return json(await store.update(db, id, patch, lead));
    }
    if (action === 'draft' && method === 'POST') {
        const d = store.draftFor(lead.kind, { ...lead, id });
        return json(await store.update(db, id, { subject: d.subject, body: d.body, logDraft: true }, lead));
    }
    if (action === 'offer' && method === 'POST' && lead.kind === 'paket') {
        const selection = body.selection ? Offer.normalize(body.selection) : null;
        const d = store.draftFor('paket', { ...lead, selection });
        return json(await store.update(db, id, { selection, subject: d.subject, body: d.body }, lead));
    }
    return json({ error: 'not_found' }, 404);
}

const LOCKED_PAGE = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kasi gesperrt</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#F7F5F0;color:#1A1A1A;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:34rem"><h1 style="font-size:1.4rem">Kasi ist gesperrt</h1>
<p>Das Dashboard öffnet sich nur nach Anmeldung über Cloudflare Access. Ist Access für diesen Worker noch nicht eingerichtet, folgen Sie der Anleitung in <code>harvey-agent/README.md</code>.</p></main></body></html>`;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const user = await verifyAccess(request, env);
        if (!user) {
            if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
            return new Response(LOCKED_PAGE, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
        }
        if (url.pathname.startsWith('/api/')) {
            try {
                return await api(request, env, url);
            } catch (err) {
                console.error(err);
                return json({ error: 'failed', message: 'Interner Fehler.' }, 500);
            }
        }
        const res = await env.ASSETS.fetch(request);
        const out = new Response(res.body, res);
        Object.entries(SECURITY_HEADERS).forEach(([k, v]) => out.headers.set(k, v));
        out.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        return out;
    }
};
