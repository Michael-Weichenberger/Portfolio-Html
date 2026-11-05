/* =============================================================================
   KASI · Mail- und Brief-Bausteine
   Eine Stelle für alle Texte, die Kasi vorschlägt. Genutzt vom lokalen Agenten
   (harvey-worker.js) und vom Dashboard (cloudflare/dashboard).

   Eigene Formulierungen: einfach die Texte in BLOCKS anpassen. Platzhalter:
     {name}  Domain des Betriebs      {met} {total}  erfüllte / geprüfte Signale
     {link}  Teaser-Link              {count}        Zahl der fehlenden Signale
   ============================================================================= */
'use strict';

const Offer = require('../../offer-rules.js');

const SITE = 'https://mw-itservices.de';
const AREA = { performance: 'Mobile Ladezeit', local: 'Lokale Suche', ai: 'KI-Sichtbarkeit', https: 'Sicherheit' };

// Buchungslink für Erstgespräche (z. B. Cal.com). Leer lassen = kein Link in den Texten.
// Nach dem Eintragen: npm run cf:deploy und npm run dash:deploy, damit Website-Anfragen ihn auch bekommen.
const BOOKING_URL = '';

const SIGNATURE = [
    ...(BOOKING_URL ? ['Termin direkt in meinem Kalender buchen (15 Minuten, kostenlos):', BOOKING_URL, ''] : []),
    'Viele Grüße',
    'Michael Weichenberger',
    'MW IT-SERVICES',
    'info@mw-itservices.de · mw-itservices.de'
].join('\n');

const BLOCKS = {
    // Antwort auf eine Anfrage über den Website-Test (Person hat eingewilligt)
    anfrage: {
        subject: 'Ihr Sichtbarkeits-Report für {name}',
        greeting: 'Guten Tag,',
        intro: 'vielen Dank für Ihr Interesse. Ich habe {name} gemessen: Die Seite erfüllt {met} von {total} Signalen, die bestimmen, ob Kunden Sie über Google, auf dem Handy und über KI-Assistenten wie ChatGPT finden.',
        introUnmeasured: 'vielen Dank für Ihr Interesse. Ich habe mir {name} angesehen und die wichtigsten Punkte zusammengefasst.',
        findingsLead: 'Diese Punkte bringen am meisten:',
        strengths: 'Gut gelöst sind bereits: {list}.',
        noFindings: 'Ihre Seite ist technisch in einem sehr guten Zustand. Es gibt nur noch Feinheiten.',
        outro: 'Gern gehe ich die Punkte in einem kurzen Gespräch (15 Minuten, kostenlos) mit Ihnen durch und sage Ihnen, was davon sich für Ihren Betrieb wirklich lohnt. Antworten Sie einfach auf diese Mail oder nennen Sie mir zwei, drei Zeiten, die Ihnen passen.'
    },
    // Brief an einen Betrieb ohne vorherigen Kontakt (Post, persönlich, bestehender Kontakt)
    akquise: {
        subject: 'Website {name}: drei Punkte, die Anfragen kosten',
        greeting: 'Guten Tag,',
        intro: 'ich habe mir die Website {name} angesehen und gemessen, wie sie bei Google, auf dem Handy und bei KI-Assistenten wie ChatGPT ankommt. Drei Punkte sind mir aufgefallen:',
        link: 'Das Ergebnis der Messung können Sie selbst ansehen: {link}',
        outro: 'Wenn Sie möchten, gehe ich die Punkte in 15 Minuten mit Ihnen durch, kostenlos und ohne Verpflichtung.'
    },
    // Angebot zu einer Paket-Anfrage aus dem Projekt-Planer
    paket: {
        subject: 'Ihr Angebot von MW IT-SERVICES für {name}',
        greeting: 'Guten Tag,',
        intro: 'vielen Dank für Ihre Anfrage. Gern mache ich Ihnen für {name} folgendes Angebot:',
        fromNote: 'Der Preis für Multipage & Enterprise ist ein Startpreis. Den Endpreis lege ich nach einem kurzen Gespräch über Seitenzahl und Umfang fest.',
        promoNote: 'Black-Friday-Preis bis {until}: {promoMonth} in den ersten {months} Monaten, danach {regularMonth} pro Monat, {term} Monate Laufzeit.',
        vat: 'Alle Preise netto zzgl. 19 % MwSt.',
        outro: 'Im nächsten Schritt klären wir in 15 Minuten Inhalte, Bilder und Ihren Wunschtermin. Antworten Sie einfach auf diese Mail oder rufen Sie mich an, dann bekommen Sie danach das verbindliche Angebot zum Unterschreiben.'
    },
    // Allgemeine Anfrage ohne Planer-Auswahl (Erstgespräch, Demo, Rückruf)
    kontakt: {
        subject: 'Ihre Anfrage: {topic}',
        greeting: 'Guten Tag,',
        intro: 'vielen Dank für Ihre Anfrage zum Thema „{topic}“.',
        outro: 'Gern spreche ich mit Ihnen darüber. Passt Ihnen ein kurzes Telefonat in den nächsten Tagen? Nennen Sie mir einfach zwei, drei Zeiten, oder ich rufe Sie unter {phone} an.'
    },
    compliance: 'Werbe-E-Mails und -Anrufe an Betriebe ohne vorherige Einwilligung sind nach § 7 UWG unzulässig (Telefon B2B nur bei mutmaßlicher Einwilligung). Unbedenklich: Brief per Post, persönlicher Besuch, bestehende Kontakte oder Anfragen über den Check.'
};

function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function teaserLink(id) {
    return SITE + '/?check=' + id + '#sichtbarkeit';
}

function findingLines(findings, n, withFix) {
    // Ohne konkreten Messwert erklärt die Auswirkung den Punkt besser als "Nicht erfüllt: …"
    const why = (x) => (!x.evidence || /^Nicht erfüllt/.test(x.evidence) ? x.impact : x.evidence);
    return findings.slice(0, n).map((x, i) => (i + 1) + '. ' + x.title + ': ' + why(x) + (withFix ? '\n   Lösung: ' + x.fix : ''));
}

/* Mail-Vorschlag als Antwort auf eine Anfrage aus dem Website-Test. */
function replyDraft(opts) {
    const b = BLOCKS.anfrage;
    const report = opts.report || {};
    const findings = opts.findings || [];
    const vars = { name: opts.name, met: report.met, total: report.total, count: findings.length };
    const good = (report.points || []).filter((p) => p.status === 'good').map((p) => p.title);
    const body = [
        b.greeting,
        '',
        fill(report.total ? b.intro : b.introUnmeasured, vars),
        ''
    ];
    if (findings.length) body.push(b.findingsLead, '', ...findingLines(findings, 4, true), '');
    else body.push(b.noFindings, '');
    if (good.length) body.push(fill(b.strengths, { list: good.join(', ') }), '');
    body.push(b.outro, '', SIGNATURE);
    return { subject: fill(b.subject, vars), body: body.join('\n') };
}

/* Angebot aus der Planer-Auswahl (Preise aus offer-rules.js) oder Antwort auf eine allgemeine Anfrage. */
function offerDraft(opts) {
    const name = opts.name || 'Ihren Betrieb';
    if (!opts.selection) {
        const b = BLOCKS.kontakt;
        const vars = { topic: opts.topic || 'Ihr Projekt', phone: opts.phone || 'Ihrer Nummer' };
        const body = [b.greeting, '', fill(b.intro, vars)];
        if (opts.message) body.push('', 'Ihre Nachricht: „' + opts.message + '“');
        body.push('', fill(b.outro, vars), '', SIGNATURE);
        return { subject: fill(b.subject, vars), body: body.join('\n'), quote: null };
    }
    const b = BLOCKS.paket;
    const q = Offer.quote(opts.selection, opts.at);
    const e = Offer.euro;
    const width = Math.max(28, ...q.lines.map((l) => l.label.length + 2));
    const row = (label, value) => label + ' ' + '.'.repeat(Math.max(2, width - label.length)) + ' ' + value;
    const positions = q.lines.map((l) => row(l.label,
        l.month !== undefined ? e(l.month) + ' / Monat'
        : l.included ? 'inklusive'
        : (l.from ? 'ab ' : '') + e(l.once) + ' einmalig'));
    const prefix = q.from ? 'ab ' : '';
    const totals = [row('Summe einmalig', prefix + e(q.once) + ' netto (' + prefix + e(q.onceGross) + ' brutto)')];
    if (q.month) totals.push(row('Monatlich', e(q.month) + ' netto (' + e(q.monthGross) + ' brutto)'));
    const packages = q.lines.map((l) => l.label).join(' + ') || 'Ihr Projekt';
    const body = [b.greeting, '', fill(b.intro, { name }), '', ...positions, '', ...totals, '', b.vat];
    if (q.promo) body.push(fill(b.promoNote, { until: q.promoUntil.toLocaleDateString('de-DE'), promoMonth: e(Offer.PROMO.month),
        months: q.promoMonths, regularMonth: e(q.regularMonth), term: q.term }));
    if (q.from) body.push(b.fromNote);
    if (opts.message) body.push('', 'Zu Ihrer Nachricht („' + opts.message + '“) gehe ich im Gespräch gern im Detail ein.');
    body.push('', b.outro, '', SIGNATURE);
    return { subject: fill(b.subject, { name, packages }), body: body.join('\n'), quote: q };
}

/* Problemcase für die Akquise: Brief, Gesprächseinstieg, Priorität. */
function buildCase(target, report, findings, psi, fmt) {
    const b = BLOCKS.akquise;
    const top = findings.slice(0, 3);
    const critical = findings.filter((x) => x.severity === 3).length;
    const slow = psi && typeof psi.lcp === 'number' && psi.lcp > 2.5;
    const f = fmt || ((n, d) => Number(n).toFixed(d).replace('.', ','));
    const hook = slow
        ? target.name + ' braucht auf dem Handy ' + f(psi.lcp, 1) + ' s, bis der Hauptinhalt steht.'
        : report.total ? target.name + ' erfüllt nur ' + report.met + ' von ' + report.total + ' Sichtbarkeits-Signalen.'
        : target.name + ': Messung unvollständig.';
    const areas = [...new Set(top.map((x) => AREA[x.area]))];
    const link = teaserLink(target.id);
    const vars = { name: target.name, link, met: report.met, total: report.total, count: findings.length };
    const letter = [
        b.greeting, '',
        fill(b.intro, vars), '',
        ...findingLines(top, 3, false), '',
        fill(b.link, vars), '',
        b.outro, '',
        SIGNATURE
    ].join('\n');

    return {
        headline: hook,
        summary: findings.length
            ? hook + ' Insgesamt ' + findings.length + ' fehlende Signale, davon ' + critical + ' kritisch, vor allem bei ' + areas.join(', ') + '.'
            : hook + ' Kaum Hebel, Kontakt nur bei konkretem Anlass.',
        priority: critical >= 2 || (report.ratio !== null && report.ratio < 0.5) ? 'hoch' : findings.length >= 6 ? 'mittel' : 'niedrig',
        areas: Object.fromEntries(Object.keys(AREA).map((k) => [k, findings.filter((x) => x.area === k).length])),
        topFindings: top,
        callOpener: 'Ich habe mir ' + target.name + ' angesehen. ' + (top[0] ? top[0].evidence : '') + ' Darf ich Ihnen kurz zeigen, was das für Anfragen bedeutet?',
        subject: fill(b.subject, vars),
        letter,
        teaserLink: link,
        compliance: BLOCKS.compliance
    };
}

module.exports = { SITE, AREA, BLOCKS, SIGNATURE, BOOKING_URL, fill, teaserLink, replyDraft, offerDraft, buildCase };
