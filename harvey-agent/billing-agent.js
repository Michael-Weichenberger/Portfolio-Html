#!/usr/bin/env node
/* =============================================================================
   KASI BILLING · offene Posten, Mahnwesen, Rechnungsentwürfe

   Sicherheits-Prinzip: Kasi verschickt nichts und bucht nichts eigenständig.
   Er schreibt Vorschläge nach out/billing/<datum>/ und out/rechnungen/.
   Erst Ihre Befehle (--sent, --paid, --issue) verändern die Daten.

   npm run billing                         Tages-Check: offene Posten, Mahnvorschläge, CSV
   npm run billing -- --list               alle Rechnungen
   npm run billing -- --sent RE-2026-001 1 Mahnung Stufe 1 als versendet eintragen
   npm run billing -- --paid RE-2026-001 [--amount 500] [--date 2026-11-04]
   npm run billing -- --draft K-1001       Rechnungsentwurf aus dem gebuchten Paket
   npm run billing -- --draft K-1001 --care 2026-11   Betreuung für einen Monat
   npm run billing -- --monthly [2026-11]  Betreuungs-Entwürfe für alle aktiven Kunden
   npm run billing -- --issue E-…          Entwurf prüfen und als Rechnung stellen
   npm run billing -- --cancel RE-2026-001 Rechnung stornieren
   npm run billing -- --resume RE-2026-001 pausiertes Mahnwesen fortsetzen
   npm run billing -- --import harvey-export.json   Kunden aus dem Dashboard übernehmen
   Option für Tests: --today 2026-12-01
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const B = require('./core/billing.js');
const Outbox = require('./core/outbox.js');

const OUT = path.join(__dirname, 'out');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes('--' + name);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TODAY = opt('today') && DATE_RE.test(opt('today')) ? opt('today') : B.iso(Date.now());
const rel = (p) => path.relative(process.cwd(), p) || p;

function fail(msg) {
    console.error('✗ ' + msg);
    process.exit(1);
}

function loadAll() {
    const created = Store.ensure();
    if (created.length) console.log('Angelegt in data/: ' + created.join(', ') + ' (bitte company.json ausfüllen)\n');
    const company = Store.load('company');
    if (!company.dunning || !company.invoice) fail('data/company.json unvollständig. Vorlage: data-templates/company.example.json');
    return { company, clients: Store.load('clients'), invoices: Store.load('invoices') };
}

function findInvoice(invoices, key) {
    const inv = invoices.find((i) => i.number === key || i.draftId === key);
    if (!inv) fail('Rechnung ' + key + ' nicht gefunden.');
    return inv;
}

function warnings(company) {
    const w = [];
    const age = B.days(company.dunning.baseRate.validFrom, TODAY);
    if (age > 183) w.push('Basiszinssatz in data/company.json ist vom ' + B.de(company.dunning.baseRate.validFrom) + '. Aktuellen Wert prüfen: ' + company.dunning.baseRate.source);
    if (/BITTE EINTRAGEN/.test(JSON.stringify(company))) w.push('In data/company.json fehlen noch Angaben (Anschrift, Steuernummer, IBAN).');
    return w;
}

/* ---------- Tages-Check ---------- */
function check() {
    const { company, clients, invoices } = loadAll();
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    const all = invoices.filter((i) => i.status === 'gestellt').map((i) => B.assess(i, TODAY, company));
    const open = all.filter((a) => a.totals.open > 0.009).sort((a, b) => b.overdueDays - a.overdueDays);
    const proposals = open.filter((a) => a.proposed);
    const drafts = invoices.filter((i) => i.status === 'entwurf');

    const dir = path.join(OUT, 'billing', TODAY);
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (const a of proposals) {
        const c = byId[a.invoice.clientId];
        const d = B.reminderDraft(a.proposed, a, c, company, TODAY);
        const slug = (c ? c.company : a.invoice.clientId).replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
        const f = path.join(dir, 'stufe-' + a.proposed + '_' + a.invoice.number + '_' + slug + '.md');
        const parts = [
            '# Stufe ' + a.proposed + ': ' + d.label + ' · ' + a.invoice.number,
            '',
            '> Entwurf von Kasi, ' + B.de(TODAY) + '. Prüfen, anpassen, selbst senden. Danach eintragen:',
            '> `npm run billing -- --sent ' + a.invoice.number + ' ' + a.proposed + '`',
            '',
            '- An: ' + (c ? c.email || 'E-Mail fehlt in clients.json' : 'Kunde fehlt'),
            '- Offen: ' + B.money(a.totals.open) + ' · fällig seit ' + B.de(a.invoice.dueDate) + ' (' + a.overdueDays + ' Tage)',
            a.verzugDays ? '- Verzug seit ' + B.de(a.verzugSince) + ': Zinsen ' + B.money(a.interest) + ', Pauschale ' + B.money(a.flatFee) : '- Noch kein Verzug',
            '',
            '## E-Mail',
            '',
            '**Betreff:** ' + d.subject,
            '',
            '```text',
            d.body,
            '```'
        ];
        if (a.proposed === 3) parts.push('', '## Brief (Post / Einschreiben, Kopie für den Steuerberater)', '', '```text', B.letterHead(c, company, TODAY) + d.subject + '\n\n' + d.body, '```');
        fs.writeFileSync(f, parts.join('\n') + '\n');
        files.push(f);
        // Entwurf in den Postausgang: Versand erst nach Ihrer Freigabe (npm run send-approval / Dashboard)
        Outbox.add({ type: 'mahnung', key: 'mahnung:' + a.invoice.number + ':' + a.proposed, to: c ? c.email : '', subject: d.subject, body: d.body,
            ref: a.invoice.number, meta: { invoice: a.invoice.number, stage: a.proposed, client: c ? c.company : '' } });
    }

    const csv = path.join(dir, 'offene-posten-' + TODAY + '.csv');
    fs.writeFileSync(csv, B.oposCsv(open, byId, TODAY));

    const sum = (k) => open.reduce((s, a) => s + a.totals[k], 0);
    const overdue = open.filter((a) => a.overdueDays > 0);
    const md = [
        '# Finanz-Check ' + B.de(TODAY),
        '',
        ...warnings(company).map((w) => '> ⚠ ' + w),
        '',
        '| | |', '|---|---|',
        '| Offene Rechnungen | ' + open.length + ' · ' + B.money(sum('open')) + ' |',
        '| davon überfällig | ' + overdue.length + ' · ' + B.money(overdue.reduce((s, a) => s + a.totals.open, 0)) + ' |',
        '| Mahnvorschläge heute | ' + proposals.length + ' |',
        '| Rechnungsentwürfe | ' + drafts.length + (drafts.length ? ' (`--issue <Entwurf>` zum Stellen)' : '') + ' |',
        '',
        '## Offene Posten',
        '',
        '| Rechnung | Kunde | offen | fällig | Tage | Stufe | Vorschlag |',
        '|---|---|---:|---|---:|---:|---|',
        ...open.map((a) => '| ' + a.invoice.number + ' | ' + ((byId[a.invoice.clientId] || {}).company || a.invoice.clientId) + ' | ' + B.money(a.totals.open) + ' | ' + B.de(a.invoice.dueDate) + ' | ' + a.overdueDays + ' | ' + a.stage + ' | ' + (a.proposed ? '**Stufe ' + a.proposed + '**' : a.reason) + ' |'),
        open.length ? '' : '_Keine offenen Posten._',
        drafts.length ? '\n## Entwürfe\n\n' + drafts.map((d) => '- ' + d.draftId + ' · ' + ((byId[d.clientId] || {}).company || d.clientId) + ' · ' + B.money(B.totals(d, company).gross)).join('\n') : '',
        '',
        '## Dateien',
        '',
        ...files.map((f) => '- ' + path.basename(f)),
        '- ' + path.basename(csv) + ' (offene Posten für den Steuerberater, Semikolon-CSV)',
        proposals.length ? '- Mahnentwürfe liegen im Postausgang: `npm run send-approval` oder `npm run dashboard`' : '',
        '',
        '_Hinweis: Mahntexte und Zinsberechnung sind Vorlagen, keine Rechtsberatung. Bei Stufe 3 vor weiteren Schritten den Steuerberater oder Anwalt einbeziehen._'
    ].join('\n');
    const overview = path.join(dir, '00-uebersicht.md');
    fs.writeFileSync(overview, md + '\n');

    console.log('Finanz-Check ' + B.de(TODAY));
    warnings(company).forEach((w) => console.log('⚠ ' + w));
    console.log('  offen: ' + open.length + ' Rechnungen · ' + B.money(sum('open')) + ' · überfällig: ' + overdue.length);
    proposals.forEach((a) => console.log('  → Stufe ' + a.proposed + ' für ' + a.invoice.number + ' (' + a.overdueDays + ' Tage überfällig)'));
    if (!proposals.length) console.log('  keine Mahnung fällig');
    console.log('  Bericht: ' + rel(overview));
}

/* ---------- Änderungen nur auf Ihren Befehl ---------- */
function markSent(number, stage) {
    const { invoices } = loadAll();
    const inv = findInvoice(invoices, number);
    const s = Number(stage);
    if (![1, 2, 3].includes(s)) fail('Stufe muss 1, 2 oder 3 sein.');
    const date = opt('date') && DATE_RE.test(opt('date')) ? opt('date') : TODAY;
    inv.reminders = (inv.reminders || []).filter((r) => r.stage !== s).concat({ stage: s, sentAt: date });
    Store.save('invoices', invoices);
    console.log('✓ ' + inv.number + ': Mahnung Stufe ' + s + ' am ' + B.de(date) + ' eingetragen.');
}

function markPaid(number) {
    const { company, invoices } = loadAll();
    const inv = findInvoice(invoices, number);
    const t = B.totals(inv, company);
    const amount = opt('amount') ? Number(String(opt('amount')).replace(',', '.')) : t.open;
    if (!(amount > 0)) fail('Ungültiger Betrag.');
    const date = opt('date') && DATE_RE.test(opt('date')) ? opt('date') : TODAY;
    inv.payments = (inv.payments || []).concat({ date, amount });
    if (B.totals(inv, company).open <= 0.009) { inv.status = 'bezahlt'; inv.paidAt = date; }
    delete inv.dunningPaused;
    Store.save('invoices', invoices);
    console.log('✓ ' + inv.number + ': Zahlung ' + B.money(amount) + ' am ' + B.de(date) + ' eingetragen' + (inv.status === 'bezahlt' ? ', vollständig bezahlt.' : ', offen: ' + B.money(B.totals(inv, company).open)));
}

function writeInvoiceFile(inv, client, company) {
    const dir = path.join(OUT, 'rechnungen');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, (inv.number || inv.draftId) + '.md');
    const miss = B.missingInvoiceData(inv, client, company);
    fs.writeFileSync(f, (miss.length ? '> ⚠ Vor dem Stellen ergänzen: ' + miss.join(', ') + '\n\n' : '') + B.invoiceDocument(inv, client, company) + '\n');
    return { file: f, missing: miss };
}

function draft(clientId) {
    const { company, clients, invoices } = loadAll();
    const client = clients.find((c) => c.id === clientId);
    if (!client) fail('Kunde ' + clientId + ' nicht in data/clients.json.');
    if (!client.package) fail('Für ' + clientId + ' ist kein Paket hinterlegt (clients.json → package).');
    const month = opt('care');
    const label = month ? new Date(month + '-01T12:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : null;
    // Preis zum Zeitpunkt der Anfrage (clients.json → orderedAt), damit eine Aktion auch nach ihrem Ende gilt
    const positions = B.positionsFromPackage(client.package, month ? 'care' : 'project', label, client.orderedAt ? client.orderedAt + 'T12:00:00+01:00' : undefined);
    // Vereinbarter Sonderpreis (z. B. Black Friday: 199 € in den ersten 6 Monaten): clients.json → careRate { net, until: "2027-04" }
    if (month && client.careRate && client.careRate.net >= 0 && (!client.careRate.until || month <= client.careRate.until)) {
        positions.forEach((p) => { p.net = client.careRate.net; });
    }
    if (!positions.length) fail('Das Paket enthält keine ' + (month ? 'Betreuung' : 'Einmalleistungen') + '.');
    const inv = { draftId: 'E-' + Date.now().toString(36), status: 'entwurf', clientId, positions, serviceDate: label || '', period: month || null,
        vatRate: company.invoice.vatRate, payments: [], reminders: [], createdAt: TODAY };
    invoices.push(inv);
    Store.save('invoices', invoices);
    const { file, missing } = writeInvoiceFile(inv, client, company);
    console.log('✓ Entwurf ' + inv.draftId + ' für ' + client.company + ': ' + B.money(B.totals(inv, company).gross) + ' brutto');
    console.log('  Prüfen: ' + rel(file) + (missing.length ? '\n  ⚠ fehlt: ' + missing.join(', ') : ''));
    console.log('  Stellen: npm run billing -- --issue ' + inv.draftId);
    return inv;
}

function monthly() {
    const { clients, invoices } = loadAll();
    const month = args[args.indexOf('--monthly') + 1] && /^\d{4}-\d{2}$/.test(args[args.indexOf('--monthly') + 1]) ? args[args.indexOf('--monthly') + 1] : TODAY.slice(0, 7);
    const active = clients.filter((c) => c.package && c.package.care && c.package.care !== 'none'
        && (!c.careSince || c.careSince.slice(0, 7) <= month) && (!c.careUntil || c.careUntil.slice(0, 7) >= month));
    let n = 0;
    for (const c of active) {
        if (invoices.some((i) => i.clientId === c.id && i.period === month && i.status !== 'storniert')) { console.log('  · ' + c.company + ': für ' + month + ' schon vorhanden'); continue; }
        args.push('--care', month);
        draft(c.id);
        args.splice(args.length - 2, 2);
        n++;
    }
    console.log(n ? '✓ ' + n + ' Betreuungs-Entwürfe für ' + month : 'Keine neuen Betreuungs-Entwürfe für ' + month + '.');
}

function issue(key) {
    const { company, clients, invoices } = loadAll();
    const inv = findInvoice(invoices, key);
    if (inv.status !== 'entwurf') fail(key + ' ist kein Entwurf (Status: ' + inv.status + ').');
    const client = clients.find((c) => c.id === inv.clientId);
    const date = opt('date') && DATE_RE.test(opt('date')) ? opt('date') : TODAY;
    const miss = B.missingInvoiceData(inv, client, company);
    if (miss.length && !has('force')) fail('Pflichtangaben fehlen: ' + miss.join(', ') + '. Ergänzen oder bewusst mit --force stellen.');
    inv.number = B.nextNumber(invoices, company, date);
    inv.date = date;
    inv.dueDate = B.addDays(date, company.invoice.paymentTermDays);
    inv.status = 'gestellt';
    Store.save('invoices', invoices);
    const { file } = writeInvoiceFile(inv, client, company);
    console.log('✓ Rechnung ' + inv.number + ' gestellt (fällig ' + B.de(inv.dueDate) + '). Dokument: ' + rel(file));
    console.log('  Rechnung bitte als PDF aus Ihrem Buchhaltungs-/Schreibprogramm versenden und archivieren (GoBD: 10 Jahre).');
}

function cancel(number) {
    const { invoices } = loadAll();
    const inv = findInvoice(invoices, number);
    if (inv.status === 'bezahlt') fail('Bezahlte Rechnung: bitte eine Gutschrift/Stornorechnung erstellen.');
    inv.status = inv.status === 'entwurf' ? 'storniert' : 'storniert';
    inv.cancelledAt = TODAY;
    Store.save('invoices', invoices);
    console.log('✓ ' + (inv.number || inv.draftId) + ' storniert.' + (inv.number ? ' Für eine gestellte Rechnung zusätzlich eine Stornorechnung ausstellen.' : ''));
}

function list() {
    const { company, clients, invoices } = loadAll();
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    if (!invoices.length) return console.log('Noch keine Rechnungen. Entwurf anlegen: npm run billing -- --draft <Kundennummer>');
    invoices.forEach((i) => {
        const t = B.totals(i, company);
        console.log([(i.number || i.draftId).padEnd(14), i.status.padEnd(10), ((byId[i.clientId] || {}).company || i.clientId).slice(0, 28).padEnd(28),
            B.money(t.gross).padStart(12), 'offen ' + B.money(t.open).padStart(12), i.dueDate ? 'fällig ' + B.de(i.dueDate) : ''].join('  '));
    });
}

function resume(number) {
    const { invoices } = loadAll();
    const inv = findInvoice(invoices, number);
    delete inv.dunningPaused;
    Store.save('invoices', invoices);
    console.log('✓ Mahnwesen für ' + inv.number + ' läuft wieder.');
}

/* Kunden aus dem Dashboard-Export (Status „Kunde“) übernehmen */
function importDashboard(file) {
    if (!file || !fs.existsSync(file)) fail('Exportdatei nicht gefunden: ' + file);
    const { clients } = loadAll();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const won = (data.leads || []).filter((l) => l.status === 'auftrag');
    let nextId = clients.reduce((m, c) => Math.max(m, Number(String(c.id).replace(/\D/g, '')) || 1000), 1000);
    let added = 0;
    for (const l of won) {
        if (clients.some((c) => c.harveyId === l.id || (l.email && c.email === l.email))) continue;
        const sel = l.selection ? JSON.parse(l.selection) : null;
        const domain = l.url ? l.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
        clients.push({ id: 'K-' + (++nextId), harveyId: l.id, company: l.name, contact: '', salutation: 'Guten Tag', email: l.email || '', phone: l.phone || '',
            street: '', zip: '', city: '', domains: domain ? [domain] : [], package: sel, careSince: l.start_at || (l.won_at || '').slice(0, 10) || null, careUntil: null,
            notes: 'Aus dem Kasi-Dashboard übernommen am ' + B.de(TODAY) + '. Anschrift ergänzen.' });
        added++;
    }
    Store.save('clients', clients);
    console.log('✓ ' + added + ' Kunden übernommen (' + (won.length - added) + ' schon vorhanden). Anschriften in data/clients.json ergänzen.');
}

(function main() {
    try {
        if (has('sent')) return markSent(opt('sent'), args[args.indexOf('--sent') + 2]);
        if (has('paid')) return markPaid(opt('paid'));
        if (has('draft')) return void draft(opt('draft'));
        if (has('monthly')) return monthly();
        if (has('issue')) return issue(opt('issue'));
        if (has('cancel')) return cancel(opt('cancel'));
        if (has('list')) return list();
        if (has('resume')) return resume(opt('resume'));
        if (has('import')) return importDashboard(opt('import'));
        return check();
    } catch (err) {
        fail(err.message);
    }
}());
