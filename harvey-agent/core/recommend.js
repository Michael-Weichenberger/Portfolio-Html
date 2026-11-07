/* =============================================================================
   KASI · Angebotsvorschlag aus dem Website-Check
   Leitet aus den Befunden eine Auswahl im Preismodell (offer-rules.js) ab.
   Kasi schlägt nur vor: Michael prüft, ändert und gibt frei.

   Regeln (bewusst einfach und nachvollziehbar):
   - Neubau, wenn die Seite auf dem Handy nicht eingerichtet ist, die Ladezeit
     deutlich durchfällt, insgesamt unter 55 % liegt oder ein schwerer Baukasten
     die Ladezeit bremst. Mit 5+ Unterseiten Multipage, sonst Digital Starter.
   - Pflege & Local SEO bei Neubau oder ab 2 Lücken in der lokalen Suche,
     sonst Technik-Wartung.
   - GEO & KI-Sichtbarkeit ab 2 Lücken bei der KI-Suche.
   - Google-Unternehmensprofil, wenn kein Profil/Maps verknüpft ist.
   ============================================================================= */
'use strict';

const Offer = require('../../offer-rules.js');

// Welche Signale in welchen Abschnitt der Mail gehören
const SECTIONS = [
    { key: 'seo', title: 'Google und lokale Suche (SEO)', from: (p, s) => p === 'local' || (p === 'ai' && ['description', 'headings', 'content', 'pages'].includes(s)) },
    { key: 'geo', title: 'KI-Suche wie ChatGPT, Gemini und Perplexity (GEO)', from: (p, s) => p === 'ai' && !['description', 'headings', 'content', 'pages'].includes(s) },
    { key: 'speed', title: 'Ladezeit und Handy', from: (p) => p === 'performance' },
    { key: 'safe', title: 'Sicherheit und Pflichtangaben', from: (p) => p === 'https' }
];

const HEAVY = /elementor|divi|wpbakery|avada|oxygen|beaver|wix|jimdo|squarespace|ionos|website.?baukasten/i;

function sections(report) {
    const out = SECTIONS.map((s) => ({ ...s, signals: [] }));
    (report.points || []).forEach((p) => (p.signals || []).forEach((sig) => {
        const sec = out.find((s) => s.from(p.key, sig.id));
        if (sec) sec.signals.push({ ...sig, group: p.key });
    }));
    return out.map((s) => ({ key: s.key, title: s.title, met: s.signals.filter((x) => x.ok === true).length, total: s.signals.filter((x) => x.ok !== undefined && x.ok !== null).length,
        missing: s.signals.filter((x) => x.ok === false) }));
}

function recommend(report, findings, audit) {
    const missing = new Set((findings || []).map((f) => f.id));
    (report.points || []).forEach((p) => (p.signals || []).forEach((s) => { if (s.ok === false) missing.add(s.id); }));
    const ok = (id) => (report.points || []).some((p) => (p.signals || []).some((s) => s.id === id && s.ok === true));
    const perf = (report.points || []).find((p) => p.key === 'performance') || { met: 0, total: 0 };
    const sec = sections(report);
    const gaps = (k) => (sec.find((s) => s.key === k) || { missing: [] }).missing.length;
    const stack = (report.diagnosis && report.diagnosis.stack) || {};
    const heavy = HEAVY.test([stack.cms, stack.builder, stack.theme].filter(Boolean).join(' '));
    const reasons = [];

    let rebuild = false;
    if (missing.has('viewport')) { rebuild = true; reasons.push('Die Seite ist nicht für Smartphones eingerichtet.'); }
    if (perf.total && perf.met <= Math.floor(perf.total / 2)) { rebuild = true; reasons.push('Die Ladezeit fällt bei ' + (perf.total - perf.met) + ' von ' + perf.total + ' Messwerten durch.'); }
    if (heavy && perf.total && perf.met < perf.total) { rebuild = true; reasons.push('Der Baukasten (' + [stack.builder, stack.cms].filter(Boolean).join(', ') + ') bremst die Seite, Optimieren lohnt sich hier selten.'); }
    if (typeof report.ratio === 'number' && report.ratio < 0.55) { rebuild = true; reasons.push('Insgesamt erfüllt die Seite nur ' + report.met + ' von ' + report.total + ' Signalen.'); }

    const sel = { base: 'none', extras: [], care: 'none' };
    if (rebuild) sel.base = ok('pages') ? 'multipage' : 'starter';
    if (rebuild || gaps('seo') >= 2) { sel.care = 'care'; if (!rebuild) reasons.push(gaps('seo') + ' Lücken bei der lokalen Google-Suche: das gehört in die laufende Pflege.'); }
    else { sel.care = 'tech'; reasons.push('Die Seite ist in gutem Zustand, es reicht die technische Wartung.'); }
    if (gaps('geo') >= 2) { sel.extras.push('geo'); reasons.push(gaps('geo') + ' Lücken bei der KI-Suche.'); }
    if (missing.has('maps')) { sel.extras.push('gbp'); reasons.push('Kein Google-Unternehmensprofil verknüpft.'); }
    if (audit) {
        const c = audit.crawl;
        if (c.broken.length) { reasons.push(c.broken.length + (c.broken.length === 1 ? ' tote Seite oder kaputter Link' : ' tote Seiten oder kaputte Links') + ' gefunden.'); if (sel.care === 'tech' || sel.care === 'none') sel.care = 'care'; }
        if (c.thin.length >= Math.max(3, Math.ceil(c.checked / 2))) reasons.push(c.thin.length + ' von ' + c.checked + ' Seiten haben wenig Text: Die Leistungsseiten brauchen mehr Inhalt, damit Google sie zu Suchen wie „Leistung + Ort“ zeigt.');
        if (audit.rich.absent.some((x) => /^(Firmendaten|FAQ)/.test(x)) && !sel.extras.includes('geo')) { sel.extras.push('geo'); reasons.push('Für Google und KI-Assistenten fehlen strukturierte Daten (' + audit.rich.absent.map((x) => x.split(' (')[0]).join(', ') + ').'); }
    }
    if (!rebuild) reasons.unshift('Kein Neubau nötig: Die Grundlage stimmt, die Lücken lassen sich auf der bestehenden Seite schließen.');

    return { selection: Offer.normalize(sel), rebuild, reasons, sections: sec, stack };
}

module.exports = { recommend, sections, SECTIONS };
