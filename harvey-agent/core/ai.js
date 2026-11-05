/* =============================================================================
   KASI · KI-Baustein (Claude über das offizielle Anthropic-SDK)

   Nur für Entwürfe, Einordnung und Recherche, nie für finale Aktionen.
   Ohne Schlüssel arbeiten alle Agenten mit Regeln weiter (available() = false).

   .env (gitignored):
     ANTHROPIC_API_KEY=sk-ant-…          console.anthropic.com → API Keys
     HARVEY_MODEL=claude-opus-5-5        Entwürfe, Recherche (Standard)
     HARVEY_MODEL_FAST=claude-haiku-5-5  Einordnung von Mails (günstig)

   Datenschutz: Es gehen nur die Inhalte an Anthropic, die der jeweilige Agent
   braucht (z. B. der Text einer Kundenantwort). Vor dem Einsatz mit echten
   Kundendaten den Vertrag zur Auftragsverarbeitung (DPA) von Anthropic
   abschließen und die Datenschutzerklärung ergänzen.
   ============================================================================= */
'use strict';

let client = null;
const MODEL = () => process.env.HARVEY_MODEL || 'claude-opus-5-5';
const MODEL_FAST = () => process.env.HARVEY_MODEL_FAST || 'claude-haiku-5-5';
// Server-seitige Ausweich-Modelle bei Ablehnung durch Sicherheitsfilter (nur Opus/Sonnet-Familie)
const FALLBACK_OK = (m) => /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/.test(m);

function available() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
    if (!available()) throw new Error('KI nicht eingerichtet: ANTHROPIC_API_KEY in harvey-agent/.env eintragen.');
    if (!client) {
        const SDK = require('@anthropic-ai/sdk');
        const Anthropic = SDK.Anthropic || SDK.default;
        client = new Anthropic({ maxRetries: 2, timeout: 5 * 60000 });
    }
    return client;
}

const SYSTEM = [
    'Du arbeitest für MW IT-SERVICES (Michael Weichenberger), eine kleine Webagentur in Augsburg, die Websites für Handwerksbetriebe baut und betreut.',
    'Schreibe auf Deutsch, in der Sie-Form, sachlich, freundlich und knapp, wie ein erfahrener Handwerker-Betreuer, ohne Werbefloskeln, ohne Emojis.',
    'Erfinde keine Fakten, Preise, Termine oder Zusagen. Was du nicht weißt, lässt du weg oder markierst es mit [BITTE PRÜFEN].',
    'Deine Texte sind Entwürfe; Michael prüft und sendet sie selbst.'
].join(' ');

async function call(params, { fast } = {}) {
    const c = getClient();
    const model = fast ? MODEL_FAST() : MODEL();
    const body = { model, max_tokens: 16000, system: SYSTEM, ...params };
    let res;
    if (FALLBACK_OK(model)) res = await c.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    else res = await c.messages.create(body);
    if (res.stop_reason === 'refusal') throw new Error('Die KI hat die Anfrage abgelehnt' + (res.stop_details && res.stop_details.category ? ' (' + res.stop_details.category + ')' : '') + '.');
    return res;
}

function textOf(res) {
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/* Freitext, z. B. ein Mail-Entwurf */
async function write(prompt, opts) {
    const res = await call({ messages: [{ role: 'user', content: prompt }], output_config: { effort: (opts && opts.effort) || 'medium' } }, opts);
    return textOf(res);
}

/* Strukturierte Antwort nach JSON-Schema (Einordnung, Extraktion) */
async function json(prompt, schema, opts) {
    const res = await call({
        max_tokens: (opts && opts.maxTokens) || 4000,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: (opts && opts.effort) || 'low', format: { type: 'json_schema', schema } }
    }, opts);
    const t = textOf(res);
    try { return JSON.parse(t); } catch (err) { throw new Error('KI-Antwort war kein gültiges JSON.'); }
}

/* Recherche mit Websuche (KI-Sichtbarkeit): Antwort plus gefundene Quellen */
async function search(prompt, { maxUses = 4, location } = {}) {
    const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses };
    if (location) tool.user_location = { type: 'approximate', city: location, country: 'DE', timezone: 'Europe/Berlin' };
    let messages = [{ role: 'user', content: prompt }];
    let res;
    for (let i = 0; i < 4; i++) {
        res = await call({ max_tokens: 16000, messages, tools: [tool], output_config: { effort: 'medium' } });
        if (res.stop_reason !== 'pause_turn') break;
        messages = [...messages, { role: 'assistant', content: res.content }]; // lange Suche fortsetzen
    }
    const sources = [];
    for (const b of res.content) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => r.url && sources.push({ url: r.url, title: r.title || '' }));
        if (b.type === 'text' && Array.isArray(b.citations)) b.citations.forEach((c) => c.url && sources.push({ url: c.url, title: c.title || '' }));
    }
    return { text: textOf(res), sources };
}

module.exports = { available, write, json, search, MODEL, MODEL_FAST };
