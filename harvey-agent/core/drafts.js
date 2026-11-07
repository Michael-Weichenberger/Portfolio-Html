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
    const g = report.diagnosis;
    const top = g && g.causes && g.causes.find((c) => c.area === 'speed');
    if (g && g.pain && g.pain.level !== 'ok') {
        body.push(g.pain.headline + ' ' + g.pain.text, '');
        if (top) body.push('Technisch liegt es vor allem daran: ' + top.title + '. ' + top.evidence + ' Lösung: ' + top.fix, '');
    }
    if (good.length) body.push(fill(b.strengths, { list: good.join(', ') }), '');
    body.push(b.outro, '', SIGNATURE);
    return { subject: fill(b.subject, vars), body: body.join('\n') };
}

/* Aufbau der Website in einem Satz (aus der Diagnose) */
function stackText(st) {
    if (!st) return '';
    const parts = [];
    if (st.cms) parts.push('gebaut mit ' + st.cms + (st.version ? ' ' + st.version : ''));
    if (st.builder) parts.push('Seitenbaukasten ' + st.builder);
    if (st.theme) parts.push('Theme „' + st.theme + '“');
    if (st.plugins && st.plugins.length) parts.push(st.plugins.length + (st.plugins.length === 1 ? ' erkannte Erweiterung (' : ' erkannte Erweiterungen (') + st.plugins.slice(0, 5).join(', ') + (st.plugins.length > 5 ? ' …' : '') + ')');
    if (st.cachePlugin) parts.push('Cache über ' + st.cachePlugin);
    else if (st.cms) parts.push('kein Cache-Plugin erkannt');
    if (st.cdn) parts.push('ausgeliefert über ' + st.cdn);
    if (!st.cms && !st.builder) parts.unshift('kein bekannter Baukasten erkannt (eigene Programmierung oder statische Seite)');
    return parts.join(', ') + '.';
}

/* Abschnitte aus der Tiefenprüfung (core/audit.js): alle Unterseiten, Rich Results, Texte */
function auditLines(a, n) {
    const out = [];
    const list = (arr, max = 5) => arr.slice(0, max).join(', ') + (arr.length > max ? ' und ' + (arr.length - max) + ' weitere' : '');
    const c = a.crawl;
    out.push(n + '. Alle Unterseiten geprüft (' + c.checked + ' Seiten' + (c.more ? ', weitere vorhanden' : '') + ')');
    const lines = [];
    if (c.broken.length) lines.push('Tote Seiten oder kaputte Links (' + c.broken.length + '): ' + list(c.broken.map((b) => b.url + ' (' + b.status + (b.from.length ? ', verlinkt von ' + b.from[0] : '') + ')'), 4) + '. Lösung: Links korrigieren oder die Adresse auf eine passende Seite umleiten.');
    if (c.redirects.length) lines.push('Interne Links über Umleitungen (' + c.redirects.length + '): ' + list(c.redirects, 3) + '. Lösung: direkt auf die Zieladresse verlinken.');
    if (c.noTitle.length) lines.push('Seiten ohne Titel: ' + list(c.noTitle) + '.');
    if (c.noDescription.length) lines.push('Seiten ohne Meta-Beschreibung (' + c.noDescription.length + '): ' + list(c.noDescription) + '.');
    if (c.badDescription.length) lines.push('Beschreibung zu kurz oder zu lang (' + c.badDescription.length + '): ' + list(c.badDescription, 3) + '. Ideal sind 120 bis 160 Zeichen.');
    if (c.noH1.length) lines.push('Seiten ohne Hauptüberschrift (H1): ' + list(c.noH1) + '.');
    if (c.manyH1.length) lines.push('Seiten mit mehreren Hauptüberschriften: ' + list(c.manyH1) + '.');
    if (c.dupTitles.length) lines.push('Gleicher Titel auf mehreren Seiten (' + c.dupTitles.length + '×): „' + c.dupTitles[0].text + '“ auf ' + list(c.dupTitles[0].pages, 3) + '. Lösung: Jede Seite bekommt einen eigenen Titel mit ihrer Leistung.');
    if (c.dupDescriptions.length) lines.push('Gleiche Beschreibung auf mehreren Seiten (' + c.dupDescriptions.length + '×).');
    if (c.noAlt) lines.push(c.noAlt + ' von ' + c.images + ' Bildern ohne Bildbeschreibung (alt). Google und Screenreader wissen nicht, was darauf zu sehen ist.');
    if (c.thin.length) lines.push('Seiten mit wenig Text (unter 250 Wörtern, ' + c.thin.length + ' von ' + c.checked + '): ' + list(c.thin, 4) + '. Lösung: je Leistung erklären, was genau gemacht wird, wo, wie lange es dauert und was es ungefähr kostet.');
    if (c.noindex.length) lines.push('Seiten, die Google nicht aufnehmen soll (noindex): ' + list(c.noindex) + '. Prüfen, ob das gewollt ist.');
    if (!lines.length) lines.push('Keine Probleme gefunden: alle Seiten erreichbar, Titel, Beschreibungen und Überschriften vollständig.');
    lines.forEach((l) => out.push('   – ' + l));
    out.push('');

    // Strukturierte Daten zusammengefasst je Art
    out.push((n + 1) + '. Strukturierte Daten für Google (Rich Results)');
    const byKind = {};
    a.rich.found.forEach((f) => {
        const k = f.kind.split(' (')[0];
        const e = byKind[k] || (byKind[k] = { n: 0, missing: new Set(), rec: new Set() });
        e.n++; f.missing.forEach((m) => e.missing.add(m)); f.recommended.forEach((m) => e.rec.add(m));
    });
    Object.entries(byKind).forEach(([k, e]) => out.push('   ' + (e.missing.size ? '✗ ' : '✓ ') + k + (e.n > 1 ? ' (' + e.n + '×)' : '') + (e.missing.size ? ': es fehlt ' + [...e.missing].join(', ') : '') + (() => { const recs = [...e.rec].filter((x) => !/^Hinweis:/.test(x)); const notes = [...e.rec].filter((x) => /^Hinweis:/.test(x)); return (recs.length ? (e.missing.size ? '; ' : ': ') + 'empfohlen: ' + recs.join(', ') : '') + (notes.length ? '. ' + notes.join(' ').replace(/^Hinweis: /, '') : ''); })()));
    a.rich.absent.forEach((x) => out.push('   ✗ Fehlt: ' + x));
    if (a.rich.errors) out.push('   ✗ ' + a.rich.errors + ' fehlerhafte Datenblöcke, die Google nicht lesen kann.');
    if (!a.rich.found.length && !a.rich.absent.length) out.push('   Keine strukturierten Daten gefunden.');
    out.push('');

    // Texte wie Yoast
    const t = a.text;
    if (t) {
        out.push((n + 2) + '. Texte und Lesbarkeit');
        if (t.readability) out.push('   – Lesbarkeit: ' + t.readability.score + ' Punkte (' + t.readability.level + '), im Schnitt ' + String(t.readability.asl).replace('.', ',') + ' Wörter je Satz' + (t.readability.longShare > 20 ? ', ' + t.readability.longShare + ' % der Sätze sind länger als 20 Wörter' : '') + '.' + (t.readability.score < 45 ? (t.readability.asl < 12 ? ' Die Sätze sind kurz, aber viele lange Fachwörter machen es schwer. Einfachere Wörter oder kurze Erklärungen helfen Kunden und KI-Assistenten.' : ' Kürzere Sätze und einfachere Wörter machen die Texte für Kunden und KI-Assistenten leichter verständlich.') : ''));
        out.push('   – Interne Verlinkung: im Schnitt ' + t.avgLinks + ' Links je Seite zu anderen eigenen Seiten' + (t.fewLinks.length ? '; zu wenige auf ' + list(t.fewLinks, 3) : '') + '.');
        if (t.trade || t.city) {
            const marks = Object.entries(t.placement).map(([where, v]) => where + ' ' + (v.trade === false || v.city === false ? '✗' : '✓')
                + (v.trade === false && v.city === false ? ' (Leistung und Ort fehlen)' : v.trade === false ? ' (Leistung fehlt)' : v.city === false ? ' (Ort fehlt)' : ''));
            out.push('   – Leistung „' + (t.trade || '–') + '“ und Ort „' + (t.city || '–') + '“ auf der Startseite: ' + marks.join(', ') + '.');
        }
        out.push('');
    }
    return out;
}

/* Vollständiger Report als Antwort auf den Website-Check: Überblick je Bereich (SEO, GEO, Ladezeit,
   Sicherheit), Aufbau der Website mit technischen Ursachen und ein unverbindlicher Angebotsvorschlag. */
function reportMail(opts) {
    const R = require('./recommend.js');
    const b = BLOCKS.anfrage;
    const report = opts.report || {};
    const findings = opts.findings || [];
    const name = opts.name || 'Ihre Website';
    const vars = { name, met: report.met, total: report.total, count: findings.length };
    const rec = R.recommend(report, findings, opts.audit);
    const fixOf = (id) => (findings.find((f) => f.id === id) || {}).fix;
    const body = [b.greeting, '', fill(report.total ? b.intro : b.introUnmeasured, vars), ''];

    if (findings.length) body.push('Das Wichtigste zuerst:', '', ...findingLines(findings, 3, true), '');
    body.push('DER CHECK IM ÜBERBLICK', '');
    rec.sections.forEach((s, i) => {
        if (!s.total) return;
        body.push((i + 1) + '. ' + s.title + ': ' + s.met + ' von ' + s.total + ' erfüllt');
        if (s.missing.length) s.missing.forEach((m) => body.push('   – ' + m.label + (fixOf(m.id) ? ': ' + fixOf(m.id) : '')));
        else body.push('   Alles erfüllt.');
        body.push('');
    });
    const g = report.diagnosis;
    if (g) {
        body.push((rec.sections.filter((s) => s.total).length + 1) + '. Aufbau der Website');
        const st = stackText(g.stack);
        if (st) body.push('   ' + st.charAt(0).toUpperCase() + st.slice(1));
        if (g.pain && g.pain.headline) body.push('   ' + g.pain.headline + (g.pain.level !== 'ok' && g.pain.text ? ' ' + g.pain.text : ''));
        (g.causes || []).slice(0, 4).forEach((c) => body.push('   – ' + c.title + ': ' + c.evidence + ' Lösung: ' + c.fix));
        body.push('');
    }
    if (opts.audit) body.push(...auditLines(opts.audit, rec.sections.filter((s) => s.total).length + (g ? 2 : 1)));

    // Unverbindlicher Vorschlag mit Preisen aus dem Preismodell
    const offer = offerDraft({ name, selection: rec.selection, at: opts.at });
    const q = offer.quote;
    body.push('MEIN VORSCHLAG FÜR ' + name.toUpperCase(), '');
    rec.reasons.forEach((r) => body.push('– ' + r));
    body.push('');
    const e = Offer.euro;
    q.lines.forEach((l) => body.push('   ' + l.label + ': ' + (l.month !== undefined ? e(l.month) + ' / Monat' : l.included ? 'inklusive' : (l.from ? 'ab ' : '') + e(l.once) + ' einmalig')));
    body.push('', '   ' + [q.once ? 'Summe einmalig: ' + (q.from ? 'ab ' : '') + e(q.once) + ' netto' : '', q.month ? 'monatlich ' + e(q.month) + ' netto' : ''].filter(Boolean).join(' · '), '   ' + BLOCKS.paket.vat);
    if (q.promo) body.push('   ' + fill(BLOCKS.paket.promoNote, { until: q.promoUntil.toLocaleDateString('de-DE'), promoMonth: e(Offer.PROMO.month), months: q.promoMonths, regularMonth: e(q.regularMonth), term: q.term }));
    body.push('', 'Das ist ein unverbindlicher Vorschlag auf Basis der Messung. Den genauen Umfang und das verbindliche Angebot klären wir in einem kurzen Gespräch.', '');
    body.push(b.outro, '', SIGNATURE);
    return { subject: fill(b.subject, vars), body: body.join('\n'), selection: rec.selection, quote: { once: q.once, month: q.month, from: !!q.from, promo: !!q.promo, lines: q.lines.map((l) => l.label) }, rebuild: rec.rebuild };
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
    const cause = report.diagnosis && report.diagnosis.causes && report.diagnosis.causes.find((c) => c.area === 'speed');
    const letter = [
        b.greeting, '',
        fill(b.intro, vars), '',
        ...findingLines(top, 3, false), '',
        ...(cause && slow ? ['Technisch liegt das vor allem an einem Punkt: ' + cause.title + '. ' + cause.fix, ''] : []),
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
        callOpener: 'Ich habe mir ' + target.name + ' angesehen. ' + (top[0] ? top[0].evidence : '') + (cause ? ' Die Ursache ist technisch: ' + cause.title + '.' : '') + ' Darf ich Ihnen kurz zeigen, was das für Anfragen bedeutet?',
        diagnosis: report.diagnosis || null,
        subject: fill(b.subject, vars),
        letter,
        teaserLink: link,
        compliance: BLOCKS.compliance
    };
}

module.exports = { SITE, AREA, BLOCKS, SIGNATURE, BOOKING_URL, fill, teaserLink, replyDraft, reportMail, stackText, offerDraft, buildCase };
