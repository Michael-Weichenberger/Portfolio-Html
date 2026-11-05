/* =============================================================================
   KASI · Rechnungen, offene Posten und Mahnwesen (B2B)
   Reine Logik ohne Dateizugriff, genutzt von billing-agent.js.

   Rechtlicher Rahmen (Stand der Texte, keine Rechtsberatung):
   - Verzug: durch Mahnung nach Fälligkeit (§ 286 Abs. 1 BGB) oder spätestens
     30 Tage nach Fälligkeit und Zugang der Rechnung (§ 286 Abs. 3 BGB).
   - Verzugszinsen B2B: 9 Prozentpunkte über dem Basiszinssatz (§ 288 Abs. 2 BGB),
     Basiszinssatz in data/company.json halbjährlich prüfen (1.1. / 1.7.).
   - Verzugspauschale B2B: 40 € (§ 288 Abs. 5 BGB).
   - Rechnungsangaben nach § 14 Abs. 4 UStG.
   ============================================================================= */
'use strict';

const Offer = require('../../offer-rules.js');

const DAY = 86400000;
const STATUS = ['entwurf', 'gestellt', 'bezahlt', 'storniert'];

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const parseDay = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00Z');
const days = (from, to) => Math.round((parseDay(to) - parseDay(from)) / DAY);
const addDays = (s, n) => iso(parseDay(s).getTime() + n * DAY);
const round2 = (n) => Math.round(n * 100) / 100;
const de = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '–');
const money = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);

/* ---------- Beträge ---------- */
function totals(inv, company) {
    const small = company && company.invoice && company.invoice.smallBusiness;
    const rate = small ? 0 : (typeof inv.vatRate === 'number' ? inv.vatRate : (company && company.invoice ? company.invoice.vatRate : 19));
    const net = round2((inv.positions || []).reduce((a, p) => a + (Number(p.qty) || 1) * (Number(p.net) || 0), 0));
    const vat = round2(net * rate / 100);
    const gross = round2(net + vat);
    const paid = round2((inv.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0));
    return { net, rate, vat, gross, paid, open: round2(Math.max(0, gross - paid)) };
}

/* ---------- Bewertung einer Rechnung zum Stichtag ---------- */
function assess(inv, today, company) {
    const cfg = company.dunning;
    const t = totals(inv, company);
    const base = { invoice: inv, totals: t, stage: 0, proposed: null, overdueDays: 0, ageDays: 0, verzugSince: null, interest: 0, flatFee: 0, reason: '' };
    if (inv.status !== 'gestellt') return { ...base, reason: inv.status };
    if (t.open <= 0.009) return { ...base, reason: 'bezahlt' };

    const ageDays = days(inv.date, today);
    const overdueDays = days(inv.dueDate, today);
    const reminders = (inv.reminders || []).slice().sort((a, b) => a.stage - b.stage);
    const last = reminders[reminders.length - 1];
    const lastStage = last ? last.stage : 0;

    // Verzug: erste Mahnung nach Fälligkeit (+1 Tag) oder 30 Tage nach Fälligkeit/Zugang
    const firstAfterDue = reminders.find((r) => r.sentAt && r.sentAt > inv.dueDate);
    const candidates = [addDays(inv.dueDate > addDays(inv.date, cfg.receiptDays) ? inv.dueDate : addDays(inv.date, cfg.receiptDays), 31)];
    if (firstAfterDue) candidates.push(addDays(firstAfterDue.sentAt, 1));
    const verzugSince = candidates.sort()[0];
    const verzugDays = Math.max(0, days(verzugSince, today) + 1);
    const ratePct = cfg.baseRate.percent + cfg.interestPointsB2B;
    const interest = verzugDays > 0 && today >= verzugSince ? round2(t.open * ratePct / 100 * verzugDays / 365) : 0;

    // Welche Stufe ist erreicht (Tage seit Rechnungsdatum), welche ist als Nächstes dran?
    let reached = 0;
    if (overdueDays > 0) cfg.stageDays.forEach((d, i) => { if (ageDays >= d) reached = i + 1; });
    if (overdueDays > 0 && reached === 0) reached = 0; // fällig, aber Stufe 1 noch nicht erreicht
    let proposed = null;
    let reason = '';
    if (inv.dunningPaused) {
        reason = 'pausiert: ' + inv.dunningPaused.reason + ' (' + de(inv.dunningPaused.since) + ')';
    } else if (reached > lastStage) {
        const gapOk = !last || !last.sentAt || days(last.sentAt, today) >= cfg.minDaysBetweenReminders;
        if (gapOk) proposed = Math.min(reached, lastStage + 1);
        else reason = 'letzte Mahnung erst vor ' + days(last.sentAt, today) + ' Tagen';
    } else if (overdueDays <= 0) reason = 'noch nicht fällig';
    else if (lastStage >= cfg.stageDays.length) reason = 'alle Stufen versendet – Steuerberater / Inkasso / Mahnbescheid prüfen';
    else reason = 'nächste Stufe ab Tag ' + cfg.stageDays[lastStage];

    return { ...base, stage: lastStage, proposed, reason, overdueDays: Math.max(0, overdueDays), ageDays, verzugSince, verzugDays: today >= verzugSince ? verzugDays : 0,
        interest, interestRate: ratePct, flatFee: today >= verzugSince ? cfg.flatFeeB2B : 0, lastSentAt: last ? last.sentAt : null };
}

/* ---------- Mahntexte (partnerschaftlich, klar, rechtssicher) ---------- */
const STAGES = {
    1: {
        label: 'Freundliche Erinnerung',
        subject: 'Kurze Erinnerung: Rechnung {number}',
        body: [
            '{salutation},',
            '',
            'im Tagesgeschäft und auf der Baustelle rutscht so etwas schnell durch, deshalb eine kurze Erinnerung: Die Rechnung {number} vom {date} über {gross} war am {dueDate} fällig. Bei mir ist bisher {paidText} eingegangen.',
            '',
            'Ich freue mich, wenn Sie den offenen Betrag von {open} in den nächsten Tagen überweisen:',
            '{bank}',
            'Verwendungszweck: {number}',
            '',
            'Falls die Zahlung schon unterwegs ist, betrachten Sie diese Mail einfach als erledigt. Und wenn an der Rechnung etwas nicht stimmt oder gerade ein Engpass da ist, rufen Sie mich gern an. Wir finden eine Lösung.',
            '',
            'Viele Grüße',
            '{owner}',
            '{company}'
        ]
    },
    2: {
        label: 'Zahlungsaufforderung',
        subject: 'Zahlungsaufforderung: Rechnung {number}, Ziel {deadline}',
        body: [
            '{salutation},',
            '',
            'leider ist der Betrag aus meiner Rechnung {number} vom {date} trotz meiner Erinnerung vom {lastSentAt} noch offen. Offen sind {open}.',
            '',
            'Bitte überweisen Sie den Betrag verbindlich bis zum {deadline} auf folgendes Konto:',
            '{bank}',
            'Verwendungszweck: {number}',
            '',
            'Mir ist eine gute Zusammenarbeit wichtig, deshalb sprechen Sie mich bitte direkt an, falls es Unklarheiten zur Leistung gibt oder Sie eine Ratenzahlung brauchen. Ohne Rückmeldung bis zum {deadline} muss ich die gesetzlichen Verzugsfolgen geltend machen.',
            '',
            'Viele Grüße',
            '{owner}',
            '{company}'
        ]
    },
    3: {
        label: 'Letzte Mahnung mit Verzugshinweis',
        subject: 'Letzte Mahnung: Rechnung {number}',
        body: [
            '{salutation},',
            '',
            'die Rechnung {number} vom {date} über {gross} ist trotz Erinnerung und Zahlungsaufforderung (zuletzt am {lastSentAt}) weiterhin offen. Sie befinden sich seit dem {verzugSince} in Zahlungsverzug (§ 286 BGB).',
            '',
            'Aufstellung zum {today}:',
            '  Offener Rechnungsbetrag        {open}',
            '  Verzugszinsen ({interestRate} % p. a., {verzugDays} Tage)   {interest}',
            '  Verzugspauschale (§ 288 Abs. 5 BGB)   {flatFee}',
            '  Gesamt                         {totalDue}',
            '',
            'Die Verzugszinsen betragen nach § 288 Abs. 2 BGB 9 Prozentpunkte über dem Basiszinssatz ({baseRate} %). Bitte überweisen Sie den Gesamtbetrag bis spätestens {deadline}:',
            '{bank}',
            'Verwendungszweck: {number}',
            '',
            'Geht der offene Rechnungsbetrag bis zum {deadline} vollständig ein, verzichte ich auf die Zinsen und die Pauschale. Andernfalls übergebe ich die Forderung ohne weitere Ankündigung zur Beitreibung (gerichtliches Mahnverfahren bzw. Inkasso); die dadurch entstehenden Kosten gehen zu Ihren Lasten.',
            '',
            'Ich würde das gern vermeiden. Ein kurzer Anruf genügt, wenn wir eine Lösung finden sollen.',
            '',
            'Mit freundlichen Grüßen',
            '{owner}',
            '{company}'
        ]
    }
};

function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function bankLines(company) {
    const b = company.bank || {};
    return ['  Kontoinhaber: ' + (b.holder || company.owner), '  IBAN: ' + (b.iban || 'BITTE IN data/company.json EINTRAGEN'), b.bic ? '  BIC: ' + b.bic + (b.bankName ? ' (' + b.bankName + ')' : '') : null]
        .filter(Boolean).join('\n');
}

function reminderDraft(stage, a, client, company, today) {
    const s = STAGES[stage];
    const inv = a.invoice;
    const deadline = addDays(today, company.dunning.newDeadlineDays);
    const vars = {
        salutation: (client && client.salutation) || 'Guten Tag',
        number: inv.number, date: de(inv.date), dueDate: de(inv.dueDate), today: de(today),
        gross: money(a.totals.gross), open: money(a.totals.open),
        paidText: a.totals.paid > 0 ? 'eine Teilzahlung über ' + money(a.totals.paid) : 'noch keine Zahlung',
        bank: bankLines(company), owner: company.owner, company: company.name,
        deadline: de(deadline), lastSentAt: de(a.lastSentAt),
        verzugSince: de(a.verzugSince), verzugDays: a.verzugDays,
        interestRate: String(a.interestRate).replace('.', ','), baseRate: String(company.dunning.baseRate.percent).replace('.', ','),
        interest: money(a.interest), flatFee: money(a.flatFee), totalDue: money(round2(a.totals.open + a.interest + a.flatFee))
    };
    const body = s.body.map((l) => fill(l, vars)).join('\n');
    return { stage, label: s.label, subject: fill(s.subject, vars), body, deadline };
}

/* Briefkopf für Stufe 3 (Post oder PDF über den Steuerberater) */
function letterHead(client, company, today) {
    const sender = [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    const to = client ? [client.company, client.contact, client.street, [client.zip, client.city].filter(Boolean).join(' ')].filter(Boolean) : ['(Empfänger fehlt)'];
    return [sender, '', ...to, '', (company.city || '') + (company.city ? ', ' : '') + de(today), ''].join('\n');
}

/* ---------- Rechnungen ---------- */
function nextNumber(invoices, company, date) {
    const year = String(date).slice(0, 4);
    const prefix = (company.invoice && company.invoice.prefix) || 'RE';
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    const max = invoices.reduce((m, i) => { const x = re.exec(i.number || ''); return x ? Math.max(m, Number(x[1])) : m; }, 0);
    return prefix + '-' + year + '-' + String(max + 1).padStart(3, '0');
}

/* Positionen aus dem gebuchten Paket (Preise aus offer-rules.js).
   mode: 'project' = Einmalleistungen, 'care' = Betreuung für einen Monat */
function positionsFromPackage(pkg, mode, monthLabel, at) {
    const q = Offer.quote(pkg, at);
    if (mode === 'care') {
        return q.lines.filter((l) => l.month !== undefined && l.month > 0)
            .map((l) => ({ text: l.label + ' – ' + monthLabel, qty: 1, unit: 'Monat', net: l.regularMonth })); // Aktionspreise über clients.json → careRate
    }
    return q.lines.filter((l) => l.month === undefined && !l.included && l.once > 0)
        .map((l) => ({ text: l.label + (l.from ? ' (Umfang laut Angebot)' : ''), qty: 1, unit: 'Pauschal', net: l.once }));
}

function invoiceDocument(inv, client, company) {
    const t = totals(inv, company);
    const lines = (inv.positions || []).map((p, i) => (i + 1) + '. ' + p.text + ' | ' + (p.qty || 1) + ' ' + (p.unit || '') + ' | ' + money((p.qty || 1) * p.net));
    const small = company.invoice && company.invoice.smallBusiness;
    return [
        '# Rechnung ' + (inv.number || '(Nummer wird beim Stellen vergeben)'),
        '',
        letterHead(client, company, inv.date || iso(Date.now())),
        '| | |', '|---|---|',
        '| Rechnungsnummer | ' + (inv.number || 'Entwurf') + ' |',
        '| Rechnungsdatum | ' + de(inv.date) + ' |',
        '| Leistungszeitraum | ' + (inv.serviceDate || 'BITTE EINTRAGEN') + ' |',
        '| Kundennummer | ' + (client ? client.id : '–') + ' |',
        '| Steuernummer / USt-IdNr. | ' + (company.vatId || company.taxNumber) + ' |',
        '',
        '## Leistungen',
        '',
        ...lines,
        '',
        'Summe netto: ' + money(t.net),
        small ? company.invoice.smallBusinessNote : 'zzgl. ' + t.rate + ' % USt: ' + money(t.vat),
        '**Gesamtbetrag: ' + money(t.gross) + '**',
        '',
        'Zahlbar ohne Abzug bis ' + de(inv.dueDate) + ' auf:',
        bankLines(company),
        'Verwendungszweck: ' + (inv.number || 'Rechnungsnummer'),
        '',
        'Vielen Dank für Ihren Auftrag.',
        '',
        company.owner + ' · ' + company.name + ' · ' + company.email + (company.phone ? ' · ' + company.phone : '') + ' · ' + company.web
    ].join('\n');
}

/* Fehlende Pflichtangaben (§ 14 Abs. 4 UStG) – vor dem Stellen prüfen */
function missingInvoiceData(inv, client, company) {
    const miss = [];
    const ph = (v) => !v || /BITTE EINTRAGEN/.test(String(v));
    if (ph(company.street) || ph(company.city)) miss.push('eigene Anschrift (company.json)');
    if (ph(company.taxNumber) && ph(company.vatId)) miss.push('Steuernummer oder USt-IdNr. (company.json)');
    if (!company.bank || ph(company.bank.iban)) miss.push('IBAN (company.json)');
    if (!client) miss.push('Kunde ' + inv.clientId + ' fehlt in clients.json');
    else if (!client.street || !client.city) miss.push('Anschrift des Kunden ' + client.id);
    if (!inv.serviceDate) miss.push('Leistungszeitraum der Rechnung');
    if (!(inv.positions || []).length) miss.push('Positionen');
    return miss;
}

/* ---------- Offene-Posten-Liste für den Steuerberater (CSV, Semikolon, deutsches Zahlenformat) ---------- */
function oposCsv(rows, clientsById, today) {
    const num = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
    const esc = (v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Belegdatum', 'Belegnummer', 'Kundennummer', 'Kunde', 'Betrag brutto', 'davon USt', 'bezahlt', 'offen', 'faellig am', 'Tage ueberfaellig', 'Mahnstufe', 'Verzug seit', 'Verzugszinsen', 'Pauschale', 'Stichtag'];
    const body = rows.map((a) => {
        const inv = a.invoice;
        const c = clientsById[inv.clientId];
        return [de(inv.date), inv.number, inv.clientId, c ? c.company : '', num(a.totals.gross), num(a.totals.vat), num(a.totals.paid), num(a.totals.open),
            de(inv.dueDate), a.overdueDays, a.stage, a.verzugDays ? de(a.verzugSince) : '', num(a.interest), num(a.flatFee), de(today)].map(esc).join(';');
    });
    return '﻿' + [head.join(';'), ...body].join('\r\n') + '\r\n';
}

module.exports = { STATUS, STAGES, iso, de, days, addDays, money, totals, assess, reminderDraft, letterHead, nextNumber, positionsFromPackage, invoiceDocument, missingInvoiceData, oposCsv };
