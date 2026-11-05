#!/usr/bin/env node
/* =============================================================================
   KASI · Buchhaltung (DATEV-Export, Lexware Office)

   npm run buchhaltung                       Buchungssätze für diesen und den
                                             Vormonat vorbereiten (nur Dateien)
   npm run buchhaltung -- --export 2026-10   einen Monat exportieren
   npm run buchhaltung -- --push RE-2026-004 eine gestellte Rechnung an Lexware
                                             Office übertragen (nur nach Ihrem Klick)
   npm run buchhaltung -- --push-all         alle noch nicht übertragenen

   Ergebnis je Monat in out/buchhaltung/<JJJJ-MM>/:
     EXTF_Buchungsstapel.csv   DATEV-Format (Buchungsstapel) für den Steuerberater
     Buchungsliste.csv         dieselben Buchungen lesbar (Excel)
     LIESMICH.md               was drin ist, was fehlt
   Gebucht werden gestellte Rechnungen (Forderung an Erlös) und
   Zahlungseingänge (Bank an Forderung). Offene Posten hakt Kasi über Bank
   oder Kontoauszug ab; die Zahlungen stehen dann im Export.

   Konten in data/company.json → accounting (Standard SKR03):
     { "chart": "SKR03", "revenue": "8400", "bank": "1200", "debtorStart": 10000,
       "datev": { "consultant": 1234567, "client": 12345 } }
   SKR04: revenue 4400, bank 1800. Kleinunternehmer: Erlöskonto mit dem
   Steuerberater festlegen und als "revenueSmall" eintragen.
   Vor der ersten Übergabe mit dem Steuerberater einen Probe-Import machen.

   Lexware Office: LEXWARE_API_KEY in .env (app.lexware.de/addons/public-api).
   Übertragen wird ein Ausgangsbeleg (salesinvoice, Sammelkunde, Kategorie
   „Dienstleistungen“). Nichts geht automatisch raus: --push nur von Hand
   oder über den Knopf in der Zentrale nach Bestätigung.
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const B = require('./core/billing.js');
const Run = require('./core/runlog.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes('--' + n);
const OUT = path.join(__dirname, 'out', 'buchhaltung');
const LEXWARE = 'https://api.lexware.io';
const CATEGORY_SERVICES = '8f8664a0-fd86-11e1-a21f-0800200c9a66'; // Lexware: „Dienstleistungen“ (Einnahme)
const CHARTS = { SKR03: { revenue: '8400', bank: '1200' }, SKR04: { revenue: '4400', bank: '1800' } };

function config(company) {
    const a = company.accounting || {};
    const chart = CHARTS[a.chart] ? a.chart : 'SKR03';
    return {
        chart,
        revenue: String(a.revenue || CHARTS[chart].revenue),
        revenueSmall: a.revenueSmall ? String(a.revenueSmall) : null,
        bank: String(a.bank || CHARTS[chart].bank),
        debtorStart: Number(a.debtorStart) || 10000,
        datev: a.datev || {}
    };
}

const debtor = (cfg, clientId) => String(cfg.debtorStart + Math.max(0, (Number(String(clientId || '').replace(/\D/g, '')) || 1000) - 1000));
const num = (n) => n.toFixed(2).replace('.', ',');
const ddmm = (iso) => iso.slice(8, 10) + iso.slice(5, 7);
const q = (s) => '"' + String(s || '').replace(/"/g, "'") + '"';
const clean = (s, max) => String(s || '').replace(/[;\r\n]/g, ' ').slice(0, max);

/* Buchungssätze eines Monats */
function bookings(month, { company, clients, invoices }) {
    const cfg = config(company);
    const small = company.invoice && company.invoice.smallBusiness;
    const revenue = small ? cfg.revenueSmall : cfg.revenue;
    const rows = [];
    const notes = [];
    const inMonth = (d) => d && String(d).slice(0, 7) === month;
    for (const inv of invoices) {
        if (!inv.number || inv.status === 'entwurf') continue;
        const client = clients.find((c) => c.id === inv.clientId) || {};
        const t = B.totals(inv, company);
        if (inv.status === 'storniert') { if (inMonth(inv.date)) notes.push(inv.number + ' ist storniert: Storno mit dem Steuerberater buchen.'); continue; }
        if (inMonth(inv.date)) {
            if (!revenue) notes.push(inv.number + ': Kleinunternehmer-Erlöskonto fehlt (company.json → accounting.revenueSmall), nicht exportiert.');
            else rows.push({ kind: 'Rechnung', date: inv.date, amount: t.gross, sh: 'S', konto: debtor(cfg, inv.clientId), gegen: revenue, beleg: inv.number, text: clean('Rechnung ' + (client.company || inv.clientId), 60), client: client.company || '' });
        }
        for (const p of inv.payments || []) {
            if (!inMonth(p.date) || !(Number(p.amount) > 0)) continue;
            rows.push({ kind: 'Zahlung', date: String(p.date).slice(0, 10), amount: Number(p.amount), sh: 'S', konto: cfg.bank, gegen: debtor(cfg, inv.clientId), beleg: inv.number, text: clean('Zahlung ' + (client.company || inv.clientId), 60), client: client.company || '' });
        }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return { cfg, rows, notes };
}

function datevFile(month, cfg, rows) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
    const fyStart = y + String(cfg.datev.fiscalYearStart || '0101').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    // Kopfzeile Buchungsstapel (EXTF, Formatversion 13)
    const head = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, stamp, '', '"RE"', '""', '""', cfg.datev.consultant || '', cfg.datev.client || '', fyStart, 4,
        month.replace('-', '') + '01', month.replace('-', '') + String(last).padStart(2, '0'), q('Kasi ' + month), '""', 1, 0, 0, '"EUR"', '', '""', '', '', '', '""', '', '', '""'];
    const cols = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];
    const lines = rows.map((r) => [num(r.amount), q(r.sh), q('EUR'), '', '', '""', r.konto, r.gegen, '""', ddmm(r.date), q(clean(r.beleg, 36)), '""', '', q(r.text)].join(';'));
    // DATEV liest Windows-1252; Umlaute sind in latin1 identisch, das €-Zeichen kommt nicht vor
    return Buffer.from([head.join(';'), cols.map(q).join(';'), ...lines].join('\r\n') + '\r\n', 'latin1');
}

function exportMonth(month, data) {
    const { cfg, rows, notes } = bookings(month, data);
    const dir = path.join(OUT, month);
    fs.mkdirSync(dir, { recursive: true });
    const missingDatev = !cfg.datev.consultant || !cfg.datev.client;
    fs.writeFileSync(path.join(dir, 'EXTF_Buchungsstapel.csv'), datevFile(month, cfg, rows));
    const list = ['Art;Datum;Betrag;Soll;Haben;Beleg;Kunde;Text', ...rows.map((r) => [r.kind, B.de(r.date), num(r.amount), r.konto, r.gegen, r.beleg, clean(r.client, 80), r.text].join(';'))];
    fs.writeFileSync(path.join(dir, 'Buchungsliste.csv'), '﻿' + list.join('\r\n') + '\r\n');
    const sum = (k) => rows.filter((r) => r.kind === k).reduce((a, r) => a + r.amount, 0);
    fs.writeFileSync(path.join(dir, 'LIESMICH.md'), [
        '# Buchhaltung ' + month,
        '',
        '- Rechnungen: ' + rows.filter((r) => r.kind === 'Rechnung').length + ' · ' + B.money(sum('Rechnung')) + ' brutto',
        '- Zahlungseingänge: ' + rows.filter((r) => r.kind === 'Zahlung').length + ' · ' + B.money(sum('Zahlung')),
        '- Kontenrahmen ' + cfg.chart + ': Erlöse ' + (data.company.invoice && data.company.invoice.smallBusiness ? (cfg.revenueSmall || 'FEHLT') : cfg.revenue) + ', Bank ' + cfg.bank + ', Debitoren ab ' + cfg.debtorStart,
        '',
        'Die Debitorennummer ergibt sich aus der Kundennummer (K-1001 → ' + debtor(cfg, 'K-1001') + '). Die Debitoren-Stammdaten legt der Steuerberater an oder bekommt sie als Liste.',
        missingDatev ? '\n> ⚠ Berater- und Mandantennummer fehlen (company.json → accounting.datev). Ohne sie lehnt DATEV den Import ab.' : '',
        ...notes.map((n) => '> ⚠ ' + n),
        '',
        'Vor der ersten Übergabe einen Probe-Import mit dem Steuerberater machen. Belege (Rechnungen) liegen in out/rechnungen/.'
    ].join('\n') + '\n');
    return { month, dir, rows, notes: missingDatev ? notes.concat('DATEV: Berater- und Mandantennummer fehlen (Stammdaten → accounting.datev)') : notes };
}

/* ---------- Lexware Office ---------- */
async function lexware(pathname, body) {
    const res = await fetch(LEXWARE + pathname, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + process.env.LEXWARE_API_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Lexware ' + res.status + ': ' + (j.message || (j.IssueList && j.IssueList.map((x) => x.i18nKey + ' ' + (x.source || '')).join(', ')) || 'Fehler'));
    return j;
}

async function push(numbers) {
    if (!process.env.LEXWARE_API_KEY) throw new Error('LEXWARE_API_KEY fehlt in .env.');
    const data = { company: Store.load('company'), clients: Store.load('clients'), invoices: Store.load('invoices') };
    const todo = data.invoices.filter((i) => i.number && ['gestellt', 'bezahlt'].includes(i.status) && !i.lexware && (!numbers || numbers.includes(i.number)));
    if (numbers && !todo.length) throw new Error('Keine passende gestellte Rechnung (oder schon übertragen): ' + numbers.join(', '));
    let done = 0;
    for (const inv of todo) {
        const t = B.totals(inv, data.company);
        const client = data.clients.find((c) => c.id === inv.clientId) || {};
        const r = await lexware('/v1/vouchers', {
            type: 'salesinvoice', voucherNumber: inv.number, voucherDate: inv.date, dueDate: inv.dueDate || inv.date,
            totalGrossAmount: t.gross, totalTaxAmount: t.vat, taxType: 'gross', useCollectiveContact: true,
            remark: clean((client.company || inv.clientId) + (inv.serviceDate ? ' · ' + inv.serviceDate : ''), 200),
            voucherItems: [{ amount: t.gross, taxAmount: t.vat, taxRatePercent: t.rate, categoryId: CATEGORY_SERVICES }]
        });
        inv.lexware = { id: r.id, at: new Date().toISOString() };
        Store.save('invoices', data.invoices);
        console.log('✓ ' + inv.number + ' an Lexware Office übertragen (' + B.money(t.gross) + ')');
        done++;
        await new Promise((res) => setTimeout(res, 600)); // höchstens 2 Anfragen pro Sekunde
    }
    console.log(done ? done + (done === 1 ? ' Rechnung' : ' Rechnungen') + ' übertragen. Den Rechnungsbeleg (PDF) in Lexware Office anhängen.' : 'Nichts zu übertragen.');
}

async function main() {
    Store.ensure();
    if (has('push') || has('push-all')) return push(has('push') ? [opt('push')] : null);
    const data = { company: Store.load('company'), clients: Store.load('clients'), invoices: Store.load('invoices') };
    const now = new Date();
    const cur = now.toISOString().slice(0, 7);
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const months = opt('export') ? [opt('export')] : [prev, cur];
    if (months.some((m) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m || ''))) throw new Error('Monat als JJJJ-MM, z. B. --export 2026-10');
    const results = months.map((m) => exportMonth(m, data));
    results.forEach((r) => console.log('✓ ' + r.month + ': ' + r.rows.length + ' Buchungen → ' + path.relative(__dirname, r.dir)));
    const pending = data.invoices.filter((i) => i.number && ['gestellt', 'bezahlt'].includes(i.status) && !i.lexware);
    const notes = [...new Set(results.flatMap((r) => r.notes))];
    if (process.env.LEXWARE_API_KEY && pending.length) notes.unshift(pending.length + ' Rechnungen noch nicht in Lexware Office: ' + pending.map((i) => i.number).slice(0, 6).join(', '));
    const total = results.reduce((a, r) => a + r.rows.length, 0);
    const summary = total + ' Buchungen vorbereitet (' + months.join(', ') + ')' + (process.env.LEXWARE_API_KEY ? ', ' + pending.length + ' für Lexware offen' : '');
    console.log(summary);
    notes.forEach((n) => console.log('  · ' + n));
    Run.done('accounting', { summary, notes, data: { months: results.map((r) => ({ month: r.month, count: r.rows.length, dir: path.relative(__dirname, r.dir).replace(/\\/g, '/') })), pending: pending.map((i) => i.number), lexware: !!process.env.LEXWARE_API_KEY } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); if (!has('push') && !has('push-all')) Run.done('accounting', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { bookings, datevFile };
