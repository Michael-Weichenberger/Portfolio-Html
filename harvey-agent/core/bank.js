/* =============================================================================
   KASI · Bank-Anbindung über Enable Banking (PSD2, nur lesend)

   Zahlungseingänge kommen direkt vom Geschäftskonto, die Kontoauszug-CSV
   wird überflüssig. Nur Lesezugriff auf Umsätze; Zahlungen auslösen ist
   technisch nicht möglich (kein Zahlungsauslöse-Zugang beantragt).

   Einrichtung (einmalig, kostenlos für eigene Konten):
   1. enablebanking.com → Control Panel → Anwendung anlegen, Umgebung „Production“,
      Redirect-URL eintragen (z. B. https://mw-itservices.de/bank-ok).
      Den privaten Schlüssel (.pem) speichern unter harvey-agent/data/enablebanking.pem.
   2. Im Control Panel das eigene Konto verknüpfen („Link accounts“, Restricted mode).
   3. .env:
        ENABLEBANKING_APP_ID=…               (Application ID)
        ENABLEBANKING_REDIRECT_URL=https://mw-itservices.de/bank-ok
   4. npm run bank -- --connect "Sparkasse Augsburg"
      Link im Browser öffnen, bei der Bank freigeben, die Adresse der Zielseite
      kopieren und mit  npm run bank -- --code "<Adresse>"  abschließen.
   Die Freigabe gilt bis zu 180 Tage, danach meldet Kasi „neu verbinden“.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Store = require('./datastore.js');

const API = 'https://api.enablebanking.com';
const KEY = () => process.env.ENABLEBANKING_KEY_FILE ? path.resolve(Store.ROOT, process.env.ENABLEBANKING_KEY_FILE) : path.join(Store.DATA_DIR, 'enablebanking.pem');

function configured() { return !!(process.env.ENABLEBANKING_APP_ID && fs.existsSync(KEY())); }
function state() { const s = Store.load('bank'); return s && typeof s === 'object' ? s : {}; }
function connected() { const s = state(); return !!(s.sessionId && (!s.validUntil || Date.parse(s.validUntil) > Date.now())); }

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt() {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: process.env.ENABLEBANKING_APP_ID }));
    const body = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(fs.readFileSync(KEY(), 'utf8'));
    return head + '.' + body + '.' + b64url(sig);
}

async function api(p, { method = 'GET', body } = {}) {
    if (!configured()) throw new Error('Bank nicht eingerichtet: ENABLEBANKING_APP_ID in .env und den Schlüssel unter data/enablebanking.pem ablegen.');
    const res = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Enable Banking ' + res.status + ': ' + (j.message || j.error || j.detail || 'Fehler'));
    return j;
}

async function banks(country = 'DE') {
    return ((await api('/aspsps?country=' + country)).aspsps || []).map((a) => a.name);
}

async function connect(bankName) {
    const nonce = crypto.randomBytes(12).toString('hex');
    const validUntil = new Date(Date.now() + 179 * 86400000).toISOString();
    const j = await api('/auth', { method: 'POST', body: {
        access: { valid_until: validUntil }, aspsp: { name: bankName, country: 'DE' }, state: nonce,
        redirect_url: process.env.ENABLEBANKING_REDIRECT_URL || 'https://mw-itservices.de/bank-ok', psu_type: 'business'
    } });
    Store.save('bank', { ...state(), pending: { state: nonce, bank: bankName, validUntil, at: new Date().toISOString() } });
    return j.url;
}

async function finish(codeOrUrl) {
    let code = String(codeOrUrl || '').trim();
    try { const u = new URL(code); code = u.searchParams.get('code') || code; } catch (err) { /* reiner Code */ }
    if (!code) throw new Error('Kein Code gefunden. Bitte die komplette Adresse der Zielseite einfügen.');
    const s = state();
    const j = await api('/sessions', { method: 'POST', body: { code } });
    const accounts = (j.accounts || []).map((a) => ({ uid: a.uid, iban: (a.account_id && a.account_id.iban) || '', name: a.name || a.product || '' }));
    Store.save('bank', { sessionId: j.session_id, bank: s.pending ? s.pending.bank : '', validUntil: (j.access && j.access.valid_until) || (s.pending && s.pending.validUntil) || null, accounts, connectedAt: new Date().toISOString(), lastSync: null });
    return accounts;
}

/* Zahlungseingänge seit dem letzten Abruf (mit 5 Tagen Überlappung; Doppelte filtert der Monitor) */
async function incoming() {
    const s = state();
    if (!connected()) throw new Error(s.sessionId ? 'Bank-Freigabe abgelaufen: npm run bank -- --connect "<Bank>" erneut ausführen.' : 'Bank nicht verbunden.');
    const from = new Date(Date.parse(s.lastSync || new Date(Date.now() - 30 * 86400000).toISOString()) - 5 * 86400000).toISOString().slice(0, 10);
    const txs = [];
    for (const acc of s.accounts || []) {
        let key = '';
        for (let page = 0; page < 20; page++) {
            const j = await api('/accounts/' + encodeURIComponent(acc.uid) + '/transactions?date_from=' + from + (key ? '&continuation_key=' + encodeURIComponent(key) : ''));
            for (const t of j.transactions || []) {
                if (t.credit_debit_indicator !== 'CRDT' || (t.status && t.status !== 'BOOK')) continue;
                txs.push({
                    date: t.booking_date || t.value_date || t.transaction_date,
                    amount: Number((t.transaction_amount || {}).amount || 0),
                    purpose: [].concat(t.remittance_information || []).join(' ').trim(),
                    name: (t.debtor && t.debtor.name) || ''
                });
            }
            key = j.continuation_key;
            if (!key) break;
        }
    }
    Store.save('bank', { ...s, lastSync: new Date().toISOString() });
    return txs.filter((t) => t.amount > 0);
}

function status() {
    const s = state();
    return { configured: configured(), connected: connected(), bank: s.bank || null, validUntil: s.validUntil || null, accounts: (s.accounts || []).map((a) => ({ iban: a.iban ? a.iban.slice(0, 4) + ' … ' + a.iban.slice(-4) : '', name: a.name })), lastSync: s.lastSync || null };
}

module.exports = { configured, connected, banks, connect, finish, incoming, status };
