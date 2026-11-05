/* =============================================================================
   KASI · Postfach lesen (Gmail-Schnittstelle oder IMAP)
   Ist Google mit Gmail-Berechtigung verbunden, liest Kasi über die Gmail-
   Schnittstelle (kein App-Passwort nötig). Sonst per IMAP mit IMAP_USER/IMAP_PASS.
   Nur lesen, nichts wird gelöscht, verschoben oder als gelesen markiert.
   ============================================================================= */
'use strict';

const Google = require('./google.js');

function imapCreds() {
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    return user && pass ? { user, pass } : null;
}

function mode() {
    if (Google.has('gmailRead')) return 'gmail';
    return imapCreds() ? 'imap' : null;
}

const addr = (s) => ((String(s || '').match(/<([^>]+)>/) || [])[1] || String(s || '')).trim().toLowerCase();

/* Mails seit „since“ aus dem Posteingang: [{ id, from, subject, messageId, date }] */
async function recent(since, max = 50) {
    const m = mode();
    if (m === 'gmail') {
        const q = 'in:inbox after:' + Math.floor(since.getTime() / 1000);
        const ids = await Google.gmailList(q, max);
        const out = [];
        for (const id of ids) { const x = await Google.gmailMeta(id); out.push({ ...x, from: addr(x.from) }); }
        return out;
    }
    if (m === 'imap') {
        const { ImapFlow } = require('imapflow');
        const c = imapCreds();
        const client = new ImapFlow({ host: process.env.IMAP_HOST || 'imap.gmail.com', port: Number(process.env.IMAP_PORT) || 993, secure: true, auth: c, logger: false });
        await client.connect();
        const out = [];
        try {
            const lock = await client.getMailboxLock('INBOX');
            try {
                for await (const msg of client.fetch({ since }, { envelope: true, uid: true, internalDate: true })) {
                    out.push({ id: String(msg.uid), from: addr(((msg.envelope.from || [])[0] || {}).address), subject: msg.envelope.subject || '',
                        messageId: msg.envelope.messageId || null, date: new Date(msg.internalDate).toISOString() });
                    if (out.length >= max) break;
                }
            } finally { lock.release(); }
        } finally { await client.logout().catch(() => {}); }
        return out;
    }
    throw new Error('Postfach nicht eingerichtet: Google verbinden oder IMAP_USER/IMAP_PASS in .env.');
}

/* Komplette Mail (RFC 822) für mailparser */
async function source(id) {
    const m = mode();
    if (m === 'gmail') return Google.gmailRaw(id);
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({ host: process.env.IMAP_HOST || 'imap.gmail.com', port: Number(process.env.IMAP_PORT) || 993, secure: true, auth: imapCreds(), logger: false });
    await client.connect();
    try {
        const lock = await client.getMailboxLock('INBOX');
        try { return (await client.fetchOne(String(id), { source: { maxLength: 400000 } }, { uid: true })).source; } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
}

/* Eigene Adresse (um eigene Mails zu überspringen) */
async function own() {
    if (mode() === 'gmail') { try { return String((await Google.gmailProfile()).emailAddress || '').toLowerCase(); } catch (_) { /* weiter */ } }
    return String(process.env.IMAP_USER || process.env.SMTP_USER || 'info@mw-itservices.de').toLowerCase();
}

module.exports = { mode, recent, source, own };
