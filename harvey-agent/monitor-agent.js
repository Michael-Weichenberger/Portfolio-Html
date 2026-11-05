#!/usr/bin/env node
/* =============================================================================
   KASI MONITOR · erkennt Zahlungen und Antworten, hält die Daten aktuell

   1. Zahlungen: Kontoauszug als CSV (Export aus dem Online-Banking) in
      harvey-agent/data/inbox/ legen oder mit --bank übergeben. Kasi sucht die
      Rechnungsnummer (RE-JJJJ-NNN) im Verwendungszweck, sonst einen eindeutigen
      Betrag, trägt die Zahlung ein und stoppt bei Vollzahlung das Mahnwesen.
   2. Antworten: prüft Ihr Postfach per IMAP (nur Absender und Betreff, keine
      Inhalte). Schreibt ein Kunde mit offener Mahnung, pausiert das Mahnwesen
      für ihn, bis Sie es mit npm run billing -- --resume <Nr> fortsetzen.

   npm run monitor                     einmal prüfen (Postfach + data/inbox/*.csv)
   npm run monitor -- --bank umsatz.csv
   npm run monitor -- --watch 15       alle 15 Minuten prüfen (Fenster offen lassen)
   npm run monitor -- --no-mail        nur Kontoauszüge

   .env: IMAP_HOST (Standard imap.gmail.com), IMAP_USER / IMAP_PASS
         (sonst SMTP_USER / SMTP_PASS), App-Passwort verwenden.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('./harvey-worker.js'); // lädt harvey-agent/.env
const Store = require('./core/datastore.js');
const B = require('./core/billing.js');
const Events = require('./core/events.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes('--' + name);
const INBOX_DIR = path.join(Store.DATA_DIR, 'inbox');
const log = (m) => console.log(new Date().toLocaleTimeString('de-DE') + '  ' + m);

/* ---------- Kontoauszug (CSV) ---------- */
function parseAmount(s) {
    const t = String(s || '').replace(/[^\d,.-]/g, '');
    if (!t) return NaN;
    // 1.234,56 (deutsch) oder 1234.56
    return /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
}

function parseDate(s) {
    const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    const i = String(s || '').match(/\d{4}-\d{2}-\d{2}/);
    return i ? i[0] : null;
}

function splitCsv(line, sep) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === sep && !q) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
}

/* Erkennt die üblichen Spalten deutscher Bank-Exporte (Sparkasse, Volksbank, DKB, ING, N26 …) */
function readBankCsv(file) {
    const text = fs.readFileSync(file, 'latin1').includes('Ã') ? fs.readFileSync(file, 'utf8') : fs.readFileSync(file, 'latin1');
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const sep = (lines.find((l) => /betrag/i.test(l)) || lines[0]).split(';').length > 2 ? ';' : ',';
    const hi = lines.findIndex((l) => /betrag/i.test(l) && /(verwendungszweck|zweck|buchungstext|beschreibung)/i.test(l));
    if (hi < 0) throw new Error(path.basename(file) + ': Spalten „Betrag“ und „Verwendungszweck“ nicht gefunden.');
    const head = splitCsv(lines[hi], sep).map((h) => h.toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const cDate = col(/^(buchungstag|buchungsdatum|datum|valuta|wertstellung)/);
    const cPurpose = col(/verwendungszweck|zweck/) >= 0 ? col(/verwendungszweck|zweck/) : col(/buchungstext|beschreibung/);
    const cAmount = col(/^betrag/);
    const cName = col(/(beguenstigter|begünstigter|auftraggeber|zahlungspflichtiger|name)/);
    return lines.slice(hi + 1).map((l) => splitCsv(l, sep)).filter((c) => c.length > cAmount).map((c) => ({
        date: parseDate(c[cDate]) || new Date().toISOString().slice(0, 10),
        purpose: c[cPurpose] || '',
        name: cName >= 0 ? c[cName] : '',
        amount: parseAmount(c[cAmount])
    })).filter((t) => t.amount > 0);
}

function matchPayments(txs, source) {
    const company = Store.load('company');
    const invoices = Store.load('invoices');
    const state = Store.load('monitor');
    const seen = new Set(state.importedTx || []);
    const outbox = Store.load('outbox');
    let matched = 0;
    let skipped = 0;
    for (const tx of txs) {
        const hash = crypto.createHash('sha1').update([tx.date, tx.amount, tx.purpose, tx.name].join('|')).digest('hex').slice(0, 16);
        if (seen.has(hash)) { skipped++; continue; }
        seen.add(hash);
        const open = invoices.filter((i) => i.status === 'gestellt' && B.totals(i, company).open > 0.009);
        const nums = (tx.purpose.toUpperCase().match(/[A-Z]{1,5}-\d{4}-\d{3,}/g) || []);
        let inv = open.find((i) => nums.includes(i.number));
        let how = 'Rechnungsnummer';
        if (!inv) {
            const byAmount = open.filter((i) => Math.abs(B.totals(i, company).open - tx.amount) < 0.01);
            if (byAmount.length === 1) { inv = byAmount[0]; how = 'Betrag'; }
        }
        if (!inv) {
            Events.record('payment_unmatched', { date: tx.date, amount: tx.amount, purpose: tx.purpose.slice(0, 140), source });
            continue;
        }
        inv.payments = (inv.payments || []).concat({ date: tx.date, amount: tx.amount, source, match: how });
        const rest = B.totals(inv, company).open;
        if (rest <= 0.009) {
            inv.status = 'bezahlt';
            inv.paidAt = tx.date;
            delete inv.dunningPaused;
            // offene Mahnentwürfe für diese Rechnung verwerfen
            outbox.filter((e) => e.type === 'mahnung' && e.meta && e.meta.invoice === inv.number && ['entwurf', 'freigegeben'].includes(e.status))
                .forEach((e) => { e.status = 'verworfen'; e.history.push({ at: new Date().toISOString(), action: 'verworfen: Rechnung bezahlt' }); });
            Events.record('invoice_paid', { invoice: inv.number, amount: tx.amount, date: tx.date, match: how });
            log('✓ ' + inv.number + ' bezahlt (' + B.money(tx.amount) + ', erkannt über ' + how + '), Mahnwesen beendet');
        } else {
            Events.record('payment_matched', { invoice: inv.number, amount: tx.amount, date: tx.date, rest, match: how });
            log('✓ Teilzahlung ' + B.money(tx.amount) + ' auf ' + inv.number + ', offen ' + B.money(rest));
        }
        matched++;
    }
    state.importedTx = [...seen].slice(-5000);
    Store.save('invoices', invoices);
    Store.save('outbox', outbox);
    Store.save('monitor', state);
    return { matched, skipped, total: txs.length };
}

function processBankFiles() {
    const files = [];
    if (opt('bank')) files.push(path.resolve(opt('bank')));
    if (fs.existsSync(INBOX_DIR)) fs.readdirSync(INBOX_DIR).filter((f) => /\.csv$/i.test(f)).forEach((f) => files.push(path.join(INBOX_DIR, f)));
    for (const f of files) {
        try {
            const r = matchPayments(readBankCsv(f), path.basename(f));
            log('Kontoauszug ' + path.basename(f) + ': ' + r.total + ' Eingänge, ' + r.matched + ' zugeordnet' + (r.skipped ? ', ' + r.skipped + ' schon bekannt' : ''));
            if (f.startsWith(INBOX_DIR)) {
                const done = path.join(INBOX_DIR, 'erledigt');
                fs.mkdirSync(done, { recursive: true });
                fs.renameSync(f, path.join(done, new Date().toISOString().slice(0, 10) + '_' + path.basename(f)));
            }
        } catch (err) {
            log('✗ ' + err.message);
        }
    }
    if (!files.length) log('Keine Kontoauszüge in data/inbox/.');
}

/* ---------- Postfach: Antworten erkennen (nur Kopfzeilen) ---------- */
async function checkMailbox() {
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    if (!user || !pass) return log('Postfach-Prüfung übersprungen: IMAP_USER/IMAP_PASS (oder SMTP_USER/SMTP_PASS) fehlen in .env.');
    let ImapFlow;
    try { ({ ImapFlow } = require('imapflow')); } catch (err) { return log('imapflow fehlt: im Ordner harvey-agent „npm install“ ausführen.'); }

    const state = Store.load('monitor');
    const since = state.lastMailCheck ? new Date(state.lastMailCheck) : new Date(Date.now() - 7 * 86400000);
    const clients = Store.load('clients');
    const invoices = Store.load('invoices');
    const leads = Store.load('leads');
    const outbox = Store.load('outbox');
    const company = Store.load('company');
    const own = String(user).toLowerCase();
    // bekannte Adressen: Kunden, Leads mit E-Mail, Empfänger gesendeter Mails
    const known = new Map();
    clients.forEach((c) => c.email && known.set(c.email.toLowerCase(), { kind: 'client', id: c.id, name: c.company }));
    leads.forEach((l) => l.email && known.set(l.email.toLowerCase(), { kind: 'lead', id: l.domain, name: l.name }));
    outbox.filter((e) => e.status === 'gesendet' && e.to).forEach((e) => { if (!known.has(e.to.toLowerCase())) known.set(e.to.toLowerCase(), { kind: 'contact', id: e.ref, name: e.to }); });

    const client = new ImapFlow({ host: process.env.IMAP_HOST || 'imap.gmail.com', port: Number(process.env.IMAP_PORT) || 993, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    let found = 0;
    try {
        const lock = await client.getMailboxLock('INBOX');
        try {
            for await (const msg of client.fetch({ since }, { envelope: true, internalDate: true })) {
                const from = ((msg.envelope.from || [])[0] || {}).address;
                if (!from || from.toLowerCase() === own) continue;
                const who = known.get(from.toLowerCase());
                if (!who) continue;
                const at = new Date(msg.internalDate).toISOString();
                if (state.lastMailCheck && at <= state.lastMailCheck) continue;
                found++;
                Events.record('reply_received', { from, name: who.name, kind: who.kind, ref: who.id, subject: String(msg.envelope.subject || '').slice(0, 140), at });
                log('✉ Antwort von ' + who.name + ': ' + String(msg.envelope.subject || '').slice(0, 60));
                outbox.filter((e) => e.status === 'gesendet' && e.to && e.to.toLowerCase() === from.toLowerCase() && !e.repliedAt).forEach((e) => { e.repliedAt = at; });
                if (who.kind === 'client') {
                    invoices.filter((i) => i.clientId === who.id && i.status === 'gestellt' && (i.reminders || []).length && B.totals(i, company).open > 0.009 && !i.dunningPaused)
                        .forEach((i) => {
                            i.dunningPaused = { reason: 'Kunde hat geantwortet', since: at.slice(0, 10), subject: String(msg.envelope.subject || '').slice(0, 140) };
                            Events.record('dunning_paused', { invoice: i.number, name: who.name });
                            log('  Mahnwesen für ' + i.number + ' pausiert, bitte klären.');
                        });
                }
                if (who.kind === 'lead') {
                    const l = leads.find((x) => x.domain === who.id);
                    if (l && !['termin', 'kunde', 'abgelegt'].includes(l.status)) { l.status = 'antwort'; l.repliedAt = at; }
                }
            }
        } finally {
            lock.release();
        }
    } finally {
        await client.logout().catch(() => {});
    }
    state.lastMailCheck = new Date().toISOString();
    Store.save('monitor', state);
    Store.save('invoices', invoices);
    Store.save('leads', leads);
    Store.save('outbox', outbox);
    log('Postfach geprüft: ' + found + ' Antworten von bekannten Kontakten.');
}

/* ---------- Bank direkt (Enable Banking), falls verbunden ---------- */
async function processBankApi() {
    const Bank = require('./core/bank.js');
    if (!Bank.configured()) return;
    if (!Bank.connected()) return log('! Bank-Freigabe fehlt oder ist abgelaufen: npm run bank -- --connect "<Bank>"');
    try {
        const r = matchPayments(await Bank.incoming(), 'Bank');
        log('Bank: ' + r.total + ' Eingänge, ' + r.matched + ' zugeordnet' + (r.skipped ? ', ' + r.skipped + ' schon bekannt' : ''));
    } catch (err) { log('✗ Bank: ' + err.message); }
}

async function once() {
    Store.ensure();
    fs.mkdirSync(INBOX_DIR, { recursive: true });
    await processBankApi();
    processBankFiles();
    if (!has('no-mail')) await checkMailbox().catch((err) => log('✗ Postfach: ' + err.message));
}

if (require.main === module) (async function main() {
    const minutes = has('watch') ? Math.max(5, Number(opt('watch')) || 15) : 0;
    await once();
    if (!minutes) return;
    log('Überwachung läuft, Prüfung alle ' + minutes + ' Minuten (Strg+C beendet).');
    setInterval(() => { once().catch((err) => log('✗ ' + err.message)); }, minutes * 60000);
}());

module.exports = { readBankCsv, matchPayments, parseAmount };
