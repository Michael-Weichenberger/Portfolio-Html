/* =============================================================================
   OFFER-RULES · Preise und Angebotsberechnung (netto, zzgl. 19 % MwSt.)
   Eine Quelle für den Projekt-Planer (script.js) und Harvey (Angebot im
   Dashboard, harvey-agent/core/drafts.js). Preise und Aktion nur hier ändern.
   ============================================================================= */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OfferRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PRICES = {
        base: {
            starter:   { label: 'Digital Starter', once: 599 },
            multipage: { label: 'Multipage & Enterprise', once: 1490, from: true },
            none:      { label: 'Keine neue Website', once: 0 }
        },
        extra: {
            geo:    { label: 'GEO & KI-Sichtbarkeit', once: 490 },
            office: { label: 'Büro-Digitalisierung', once: 800 },
            career: { label: 'Karriereseite & Bewerberformular', once: 390, includedIn: 'multipage' },
            gbp:    { label: 'Google-Unternehmensprofil', once: 190 }
        },
        care: {
            none: { label: 'Keine Betreuung', month: 0 },
            tech: { label: 'Technik-Wartung', month: 99 },
            care: { label: 'Pflege & Local SEO', month: 250 },
            plus: { label: 'Local SEO Plus', month: 399 }
        }
    };

    // Black-Friday-Aktion: gilt für Digital Starter + Pflege & Local SEO
    const PROMO = {
        until: '2026-11-30T23:59:59+01:00',
        base: 'starter',
        care: 'care',
        once: 479,
        month: 199,
        months: 6,
        term: 12
    };

    const VAT = 0.19;
    const gross = (n) => Math.round(n * (1 + VAT));
    const euro = (n) => new Intl.NumberFormat('de-DE').format(n) + ' €';
    const promoActive = (at) => (at ? new Date(at).getTime() : Date.now()) <= new Date(PROMO.until).getTime();

    /* Auswahl prüfen: unbekannte Werte fallen auf den Standard zurück. */
    function normalize(sel) {
        const s = sel || {};
        return {
            base: PRICES.base[s.base] ? s.base : 'starter',
            extras: Array.isArray(s.extras) ? [...new Set(s.extras.filter((k) => PRICES.extra[k]))] : [],
            care: PRICES.care[s.care] ? s.care : 'none'
        };
    }

    /* Angebot aus einer Auswahl: Positionen, Summen, Aktion. */
    function quote(sel, at) {
        const s = normalize(sel);
        const base = PRICES.base[s.base];
        const care = PRICES.care[s.care];
        const promo = promoActive(at) && s.base === PROMO.base && s.care === PROMO.care;
        const lines = [];
        let once = promo ? PROMO.once : base.once;
        if (s.base !== 'none') lines.push({ key: 'base=' + s.base, label: base.label, once: promo ? PROMO.once : base.once, regular: base.once, from: !!base.from });
        s.extras.forEach((key) => {
            const ex = PRICES.extra[key];
            const included = ex.includedIn === s.base;
            if (!included) once += ex.once;
            lines.push({ key: 'extra=' + key, label: ex.label, once: included ? 0 : ex.once, included });
        });
        const month = promo ? PROMO.month : care.month;
        if (s.care !== 'none') lines.push({ key: 'care=' + s.care, label: care.label, month, regularMonth: care.month });
        return {
            selection: s, lines, once, month, promo, from: !!base.from,
            onceGross: gross(once), monthGross: gross(month),
            regularOnce: promo ? base.once + (once - PROMO.once) : once,
            regularMonth: care.month,
            promoUntil: new Date(PROMO.until), promoMonths: PROMO.months, term: PROMO.term
        };
    }

    /* Kurzfassung für Formular und Mail: "Planer: A + B | einmalig ... | netto ..." */
    function summaryText(q) {
        const prefix = q.from ? 'ab ' : '';
        return 'Planer: ' + q.lines.map((l) => l.label).join(' + ')
            + ' | einmalig ' + prefix + euro(q.once)
            + (q.month ? ' + ' + euro(q.month) + '/Mtl.' : '')
            + (q.promo ? ' (Black-Friday-Preis)' : '')
            + ' | netto zzgl. 19 % MwSt.';
    }

    return { PRICES, PROMO, VAT, gross, euro, promoActive, normalize, quote, summaryText };
}));
