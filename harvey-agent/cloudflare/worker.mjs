/* =============================================================================
   MW SICHTBARKEITS-CHECK · Cloudflare Worker
   Führt für den Live-Test auf mw-itservices.de dieselbe Messung aus wie der
   Harvey-Agent (core/analyze.js) und bewertet mit vis-rules.js.

   GET /analyze?url=huber-maler.de  →  Report im Format version 3

   Secrets / Variablen (siehe wrangler.toml und README):
     PSI_API_KEY      PageSpeed-Schlüssel ohne Website-Beschränkung (Secret)
     ALLOWED_ORIGINS  erlaubte Herkunft, kommagetrennt
   ============================================================================= */
import VisRules from '../../vis-rules.js';
import core from '../core/analyze.js';

const CACHE_SECONDS = 6 * 60 * 60; // gleiche Domain wird 6 Stunden nicht neu gemessen

function corsHeaders(origin, env) {
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = origin && allowed.includes(origin);
    return {
        ok,
        headers: {
            'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '';
        const cors = corsHeaders(origin, env);

        if (request.method === 'OPTIONS') return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
        if (request.method !== 'GET' || url.pathname !== '/analyze') return json({ error: 'not_found' }, 404, cors.headers);
        if (!cors.ok) return json({ error: 'origin_not_allowed' }, 403, cors.headers);

        // Optionales Rate-Limit (Binding RATE_LIMITER in wrangler.toml)
        if (env.RATE_LIMITER) {
            const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
            const { success } = await env.RATE_LIMITER.limit({ key: ip });
            if (!success) return json({ error: 'rate_limited' }, 429, cors.headers);
        }

        const target = core.normalizeTarget(url.searchParams.get('url'));
        if (!target) return json({ error: 'invalid_url' }, 400, cors.headers);

        const cache = caches.default;
        const cacheKey = new Request('https://cache.mw-check/' + encodeURIComponent(target.url));
        const hit = await cache.match(cacheKey);
        if (hit) {
            const body = await hit.text();
            return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT', ...cors.headers } });
        }

        let site;
        try {
            site = await core.analyzeSite(target, { psiKey: env.PSI_API_KEY, psiTimeoutMs: 80000 });
        } catch (err) {
            return json({ error: 'failed' }, 502, cors.headers);
        }
        if (!site.structure && !site.lighthouse) {
            return json({ error: site.unreachable ? 'unreachable' : 'unavailable' }, site.unreachable ? 422 : 503, cors.headers);
        }

        const psi = site.lighthouse ? VisRules.metricsFromLighthouse(site.lighthouse) : null;
        const report = VisRules.buildReport({
            url: target.url,
            name: target.name,
            psi,
            structure: site.structure,
            source: psi && site.structure ? 'Google PageSpeed und Strukturanalyse' : psi ? 'Google PageSpeed Insights' : 'Strukturanalyse'
        });
        const body = JSON.stringify(report);
        if (psi && site.structure) {
            ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_SECONDS } })));
        }
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS', ...cors.headers } });
    }
};
