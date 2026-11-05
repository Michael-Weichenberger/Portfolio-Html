/* =============================================================================
   VIS-RULES · gemeinsame Bewertung für den Sichtbarkeits-Check
   Eine Quelle für alle Signale, Schwellen und Ampeln der 4 Kernpunkte.
   Genutzt von script.js (Anzeige), harvey-agent/harvey-worker.js (lokal)
   und harvey-agent/cloudflare/worker.mjs (Live-Test).

   Bewertet wird eine strenge Checkliste: Jedes Signal ist erfüllt, nicht erfüllt
   oder unbekannt (nicht messbar). Unbekannte Signale zählen nicht mit.

   Report-Format (version 3), wie es in reports/<id>.json liegt:
   {
     version: 3, id, url, name, measuredAt, source,
     met, total, ratio, headline,
     points: [{ key, title, status, value, text, open, met, total,
                signals: [{ id, label, ok }] }]
   }
   OPEN_COUNT Punkte sind offen (die schwächsten), der Rest bleibt geblurrt.
   ============================================================================= */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VisRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VERSION = 3;
    const OPEN_COUNT = 2;
    const MIN_KNOWN = 3; // so viele Signale braucht ein Kernpunkt, sonst bleibt er "im Report"

    const THRESHOLDS = {
        lcp: 2.5,             // s bis zum Hauptinhalt (Core Web Vital)
        cls: 0.1,             // Layout-Verschiebung (Core Web Vital)
        tbt: 200,             // ms blockierter Hauptthread
        pageWeightMB: 2,
        ttfbMs: 800,
        bestPractices: 90,
        words: 600,
        h2: 3,
        description: [70, 170],
        internalPages: 5,
        // gewichteter Anteil erfüllter Signale je Kernpunkt
        status: { good: 0.85, warn: 0.6 },
        headline: { strong: 0.85, solid: 0.65, losing: 0.45 }
    };

    const ORDER = ['performance', 'local', 'ai', 'https'];
    const TITLES = {
        performance: 'Mobile Ladezeit & Core Web Vitals',
        local: 'Lokale Google-Auffindbarkeit',
        ai: 'KI- & ChatGPT-Readiness',
        https: 'SSL-Verschlüsselung & Sicherheit'
    };
    const RANK = { bad: 3, warn: 2, good: 1, pending: 0 };
    const STATUS_TEXT = { good: 'Gut', warn: 'Verbesserbar', bad: 'Kritisch', pending: 'Im Report' };
    const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

    const isNum = (v) => typeof v === 'number' && isFinite(v);
    const fmt = (n, d) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
    const has = (v) => v !== null && v !== undefined;
    const bool = (v) => (typeof v === 'boolean' ? v : undefined);
    const num = (v, test) => (isNum(v) ? test(v) : undefined);
    const cityBase = (c) => String(c || '').split(/\s+(?:am|an der|an|bei|im|in|ob|unter)\s+/i)[0].toLowerCase();

    /* Signale: test(psi, st) → true | false | undefined (unbekannt).
       psi = metricsFromLighthouse(), st = Strukturanalyse (harvey-agent/core/analyze.js) */
    const SIGNALS = [
        // 1 · Mobile Ladezeit & Core Web Vitals
        { id: 'lcp', group: 'performance', sev: 3, label: 'Hauptinhalt in max. 2,5 s', miss: 'schneller Seitenaufbau (über 2,5 s)',
            test: (p) => num(p && p.lcp, (v) => v <= THRESHOLDS.lcp),
            evidence: (p) => (p && isNum(p.lcp) ? 'Hauptinhalt nach ' + fmt(p.lcp, 1) + ' s, Google empfiehlt max. 2,5 s.' : ''),
            impact: 'Wer unterwegs einen Betrieb sucht, wartet nicht. Die Anfrage geht an den nächsten Treffer.',
            fix: 'Bilder in WebP/AVIF und passender Größe, Skripte und Baukasten-Ballast entfernen, Caching.' },
        { id: 'cls', group: 'performance', sev: 2, label: 'Ruhiger Seitenaufbau (CLS max. 0,1)', miss: 'ruhiger Seitenaufbau',
            test: (p) => num(p && p.cls, (v) => v <= THRESHOLDS.cls),
            evidence: (p) => (p && isNum(p.cls) ? 'Layout-Verschiebung ' + fmt(p.cls, 2) + '.' : ''),
            impact: 'Inhalte springen beim Laden, Besucher tippen daneben.', fix: 'Feste Größen für Bilder, Banner und Schriften.' },
        { id: 'tbt', group: 'performance', sev: 2, label: 'Sofort bedienbar (TBT max. 200 ms)', miss: 'sofortige Bedienbarkeit',
            test: (p) => num(p && p.tbt, (v) => v <= THRESHOLDS.tbt),
            evidence: (p) => (p && isNum(p.tbt) ? 'Seite blockiert ' + Math.round(p.tbt) + ' ms.' : ''),
            impact: 'Die Seite reagiert verzögert auf Tippen und Scrollen.', fix: 'Schwere Skripte, Tracker und Slider reduzieren.' },
        { id: 'weight', group: 'performance', sev: 2, label: 'Seitengewicht unter 2 MB', miss: 'schlanke Startseite (unter 2 MB)',
            test: (p) => num(p && p.pageWeightMB, (v) => v <= THRESHOLDS.pageWeightMB),
            evidence: (p) => (p && isNum(p.pageWeightMB) ? 'Startseite lädt ' + fmt(p.pageWeightMB, 1) + ' MB.' : ''),
            impact: 'Im Mobilfunknetz kostet jedes Megabyte Sekunden.', fix: 'Bilder komprimieren, Videos nur auf Abruf, Schriften reduzieren.' },
        { id: 'ttfb', group: 'performance', sev: 1, label: 'Server antwortet in unter 0,8 s', miss: 'schnelle Server-Antwort',
            test: (p, s) => num(s && s.ttfbMs, (v) => v <= THRESHOLDS.ttfbMs),
            evidence: (p, s) => (s && isNum(s.ttfbMs) ? 'Server-Antwort nach ' + fmt(s.ttfbMs / 1000, 1) + ' s.' : ''),
            impact: 'Schon bevor etwas sichtbar ist, vergeht Zeit.', fix: 'Besseres Hosting, Caching oder statische Auslieferung.' },
        { id: 'viewport', group: 'performance', sev: 3, label: 'Für Smartphones eingerichtet', miss: 'Handy-Darstellung',
            test: (p, s) => (s && has(s.viewport) ? Boolean(s.viewport) : bool(p && p.viewport)),
            impact: 'Google bewertet die mobile Version zuerst. Ohne Viewport müssen Besucher zoomen.', fix: 'Responsives Layout mit Viewport-Angabe.' },

        // 2 · Lokale Google-Auffindbarkeit
        { id: 'schema', group: 'local', sev: 3, label: 'Firmendaten als LocalBusiness-Schema', miss: 'strukturierte Firmendaten',
            test: (p, s) => (s ? Boolean(s.localBusiness) : undefined),
            evidence: (p, s) => (s && !s.localBusiness ? (s.schemaTypes && s.schemaTypes.length ? 'Nur Schema-Typen: ' + s.schemaTypes.slice(0, 3).join(', ') + '.' : 'Kein Schema.org-Eintrag gefunden.') : ''),
            impact: 'Google und Karten-Dienste können Adresse, Einsatzgebiet und Öffnungszeiten nicht sicher zuordnen.',
            fix: 'LocalBusiness-Daten (passender Untertyp) mit Adresse, Telefon, Öffnungszeiten einbinden.' },
        { id: 'schemaComplete', group: 'local', sev: 2, label: 'Adresse, Telefon und Öffnungszeiten im Schema', miss: 'vollständige Firmendaten (Adresse, Telefon, Zeiten)',
            test: (p, s) => (s ? Boolean(s.localBusiness && s.schemaHasAddress && s.schemaHasPhone && s.schemaHasHours) : undefined),
            impact: 'Unvollständige Daten schwächen die Zuordnung in der lokalen Suche.', fix: 'Fehlende Felder ergänzen und mit dem Google-Profil abgleichen.' },
        { id: 'geo', group: 'local', sev: 1, label: 'Geo-Koordinaten hinterlegt', miss: 'Geo-Koordinaten',
            test: (p, s) => (s ? Boolean(s.schemaHasGeo) : undefined),
            impact: 'Karten-Dienste müssen den Standort raten.', fix: 'geo mit Breiten- und Längengrad im Schema.' },
        { id: 'area', group: 'local', sev: 2, label: 'Einsatzgebiet angegeben', miss: 'Einsatzgebiet (areaServed)',
            test: (p, s) => (s ? Boolean(s.schemaHasArea) : undefined),
            impact: 'Google weiß nicht, für welche Orte der Betrieb relevant ist.', fix: 'areaServed mit allen Orten und Landkreisen im Einzugsgebiet.' },
        { id: 'cityTitle', group: 'local', sev: 2, label: 'Ort im Seitentitel', miss: 'Ort im Seitentitel',
            test: (p, s) => (s && s.city ? (s.title || '').toLowerCase().includes(cityBase(s.city)) : undefined),
            evidence: (p, s) => (s ? 'Seitentitel: „' + (s.title || 'leer') + '“.' : ''),
            impact: 'Suchen wie „Leistung + Ort“ finden die Seite schwerer.', fix: 'Leistung und Ort in den Seitentitel.' },
        { id: 'cityH1', group: 'local', sev: 1, label: 'Ort in der Hauptüberschrift', miss: 'Ort in der Hauptüberschrift',
            test: (p, s) => (s && s.city ? (s.h1 || '').toLowerCase().includes(cityBase(s.city)) : undefined),
            impact: 'Der Ortsbezug ist für Besucher und Google nicht auf den ersten Blick klar.', fix: 'Ort in die H1, z. B. „Malerbetrieb in Augsburg“.' },
        { id: 'tel', group: 'local', sev: 2, label: 'Anruf per Fingertipp', miss: 'klickbare Telefonnummer',
            test: (p, s) => (s ? s.telLinks > 0 : undefined),
            impact: 'Mobile Besucher müssen die Nummer abtippen. Ein Teil ruft dann gar nicht an.', fix: 'Telefonnummer als tel:-Link, gut sichtbar im Kopfbereich.' },
        { id: 'maps', group: 'local', sev: 2, label: 'Google-Profil oder Maps verknüpft', miss: 'Verknüpfung zum Google-Profil',
            test: (p, s) => (s ? Boolean(s.hasMaps || s.sameAsGoogle) : undefined),
            impact: 'Website und Google-Profil stützen sich nicht gegenseitig.', fix: 'Link zum Google-Unternehmensprofil und zur Route, Profil-URL in sameAs.' },
        { id: 'reviews', group: 'local', sev: 2, label: 'Bewertungen strukturiert eingebunden', miss: 'eingebundene Kundenbewertungen',
            test: (p, s) => (s ? Boolean(s.schemaHasRating) : undefined),
            impact: 'Vertrauenssignale fehlen in Suche und KI-Antworten.', fix: 'Echte Bewertungen zeigen und als Review/AggregateRating auszeichnen.' },
        { id: 'nap', group: 'local', sev: 2, label: 'Adresse mit PLZ auf der Seite', miss: 'sichtbare Adresse mit PLZ',
            test: (p, s) => (s ? Boolean(s.addressVisible) : undefined),
            impact: 'Ohne sichtbare Adresse fehlt der Ortsbezug für Besucher und Google.', fix: 'Adresse mit PLZ im Kopf- oder Fußbereich jeder Seite.' },

        // 3 · KI- & ChatGPT-Readiness (GEO)
        { id: 'bots', group: 'ai', sev: 3, label: 'KI-Crawler zugelassen', miss: 'Zugang für KI-Crawler',
            test: (p, s) => (s && s.robots ? !s.robots.blocksAll && !(s.robots.blockedAiBots || []).length : undefined),
            evidence: (p, s) => (s && s.robots && (s.robots.blockedAiBots || []).length ? 'robots.txt sperrt: ' + s.robots.blockedAiBots.join(', ') + '.' : ''),
            impact: 'ChatGPT, Perplexity & Co. können den Betrieb nicht aus der eigenen Website kennen.', fix: 'Gewünschte KI-Crawler in der robots.txt zulassen.' },
        { id: 'faq', group: 'ai', sev: 2, label: 'FAQ zu typischen Kundenfragen', miss: 'FAQ mit Kundenfragen',
            test: (p, s) => (s ? Boolean(s.hasFaq) : undefined),
            impact: 'KI-Assistenten beantworten Fragen am liebsten mit Quellen, die genau diese Frage beantworten.', fix: 'FAQ mit echten Kundenfragen, als FAQPage ausgezeichnet.' },
        { id: 'services', group: 'ai', sev: 2, label: 'Leistungen strukturiert ausgezeichnet', miss: 'strukturierte Leistungen',
            test: (p, s) => (s ? Boolean(s.schemaHasServices) : undefined),
            impact: 'Maschinen erkennen nicht eindeutig, welche Leistungen angeboten werden.', fix: 'Service bzw. OfferCatalog im Schema für jede Kernleistung.' },
        { id: 'content', group: 'ai', sev: 2, label: 'Mindestens 600 Wörter Inhalt', miss: 'genug Inhalt (600+ Wörter)',
            test: (p, s) => num(s && s.words, (v) => v >= THRESHOLDS.words),
            evidence: (p, s) => (s && isNum(s.words) ? 'Rund ' + s.words + ' Wörter auf der Startseite.' : ''),
            impact: 'Ohne Inhalte zu Leistungen und Region gibt es nichts, worauf Google oder KI verweisen können.', fix: 'Leistungen, Region, Ablauf, Preise und Referenzen als echten Text.' },
        { id: 'headings', group: 'ai', sev: 1, label: 'Klare Gliederung (1 H1, mind. 3 H2)', miss: 'klare Gliederung',
            test: (p, s) => (s && isNum(s.h1Count) ? s.h1Count === 1 && s.h2Count >= THRESHOLDS.h2 : undefined),
            evidence: (p, s) => (s && isNum(s.h1Count) ? s.h1Count + ' H1 und ' + s.h2Count + ' H2 gefunden.' : ''),
            impact: 'Die Seite sagt Maschinen nicht eindeutig, worum es in welchem Abschnitt geht.', fix: 'Eine H1 mit Leistung und Ort, je Thema eine H2.' },
        { id: 'description', group: 'ai', sev: 2, label: 'Aussagekräftige Meta-Beschreibung', miss: 'aussagekräftige Meta-Beschreibung',
            test: (p, s) => (s && has(s.description) ? s.description.length >= THRESHOLDS.description[0] && s.description.length <= THRESHOLDS.description[1] : bool(p && p.metaDescription)),
            evidence: (p, s) => (s && has(s.description) ? (s.description ? 'Meta-Beschreibung mit ' + s.description.length + ' Zeichen.' : 'Keine Meta-Beschreibung.') : ''),
            impact: 'Google und KI formulieren selbst, was der Betrieb macht, oft unpassend.', fix: 'Leistung, Ort und Nutzen in 120 bis 160 Zeichen.' },
        { id: 'pages', group: 'ai', sev: 2, label: 'Eigene Unterseiten für Leistungen', miss: 'eigene Leistungsseiten',
            test: (p, s) => num(s && s.internalPages, (v) => v >= THRESHOLDS.internalPages),
            evidence: (p, s) => (s && isNum(s.internalPages) ? s.internalPages + ' inhaltliche Unterseiten verlinkt.' : ''),
            impact: 'Eine einzelne Seite kann nicht für jede Leistung und jeden Ort ranken oder zitiert werden.', fix: 'Je Kernleistung (und ggf. Ort) eine eigene Seite.' },
        { id: 'sameAs', group: 'ai', sev: 1, label: 'Profile verknüpft (sameAs)', miss: 'verknüpfte Profile (sameAs)',
            test: (p, s) => (s ? Boolean(s.schemaHasSameAs) : undefined),
            impact: 'KI-Systeme können Website, Google-Profil und Social Media nicht als dasselbe Unternehmen erkennen.', fix: 'sameAs mit Google-Profil, Branchenbüchern und Social Media.' },
        { id: 'llms', group: 'ai', sev: 1, label: 'KI-Leitfaden llms.txt', miss: 'llms.txt für KI-Assistenten',
            test: (p, s) => (s ? Boolean(s.llmsTxt) : undefined),
            impact: 'KI-Assistenten fehlt eine kompakte, verlässliche Zusammenfassung des Betriebs.', fix: 'llms.txt mit Leistungen, Region und Kontakt im Hauptverzeichnis.' },

        // 4 · SSL-Verschlüsselung & Sicherheit
        { id: 'https', group: 'https', sev: 3, label: 'Verschlüsselt über HTTPS', miss: 'HTTPS-Verschlüsselung',
            test: (p, s) => (s && has(s.https) ? Boolean(s.https) : bool(p && p.https)),
            impact: 'Browser zeigen „Nicht sicher“. Das kostet Vertrauen, gerade bei Formularen.', fix: 'SSL-Zertifikat einrichten.' },
        { id: 'redirect', group: 'https', sev: 2, label: 'HTTP leitet auf HTTPS um', miss: 'Weiterleitung von HTTP auf HTTPS',
            test: (p, s) => bool(s && s.httpRedirects),
            impact: 'Ein Teil der Besucher landet auf der unverschlüsselten Version.', fix: 'Dauerhafte 301-Weiterleitung auf HTTPS.' },
        { id: 'hsts', group: 'https', sev: 1, label: 'HSTS-Schutz aktiv', miss: 'HSTS-Schutz',
            test: (p, s) => (s && s.https ? Boolean(s.hsts) : undefined),
            impact: 'Browser erzwingen die verschlüsselte Verbindung nicht.', fix: 'Strict-Transport-Security-Header setzen.' },
        { id: 'impressum', group: 'https', sev: 2, label: 'Impressum verlinkt', miss: 'verlinktes Impressum',
            test: (p, s) => (s ? Boolean(s.hasImpressum) : undefined),
            impact: 'Rechtliches Risiko und weniger Vertrauen.', fix: 'Impressum von jeder Seite aus verlinken.' },
        { id: 'privacy', group: 'https', sev: 2, label: 'Datenschutzerklärung verlinkt', miss: 'verlinkte Datenschutzerklärung',
            test: (p, s) => (s ? Boolean(s.hasPrivacy) : undefined),
            impact: 'Abmahnrisiko, gerade mit Kontaktformular.', fix: 'Datenschutzerklärung von jeder Seite aus verlinken.' },
        { id: 'bp', group: 'https', sev: 1, label: 'Keine Browser-Warnungen (Best Practices ab 90)', miss: 'saubere Best Practices',
            test: (p) => num(p && p.bestPractices, (v) => v >= THRESHOLDS.bestPractices),
            evidence: (p) => (p && isNum(p.bestPractices) ? 'Best Practices ' + p.bestPractices + '/100.' : ''),
            impact: 'Veraltete Bibliotheken oder Konsolenfehler schwächen Sicherheit und Vertrauen.', fix: 'Bibliotheken aktualisieren, Fehler beheben.' }
    ];

    /* Lighthouse-Ergebnis (PageSpeed) → flache Messwerte */
    function metricsFromLighthouse(lr) {
        const A = (lr && lr.audits) || {};
        const C = (lr && lr.categories) || {};
        const pct = (c) => (C[c] && isNum(C[c].score) ? Math.round(C[c].score * 100) : null);
        const val = (id) => (A[id] && isNum(A[id].numericValue) ? A[id].numericValue : null);
        const pass = (id) => (A[id] && isNum(A[id].score) ? A[id].score === 1 : null);
        const finalUrl = (lr && (lr.finalDisplayedUrl || lr.finalUrl)) || '';
        const lcp = val('largest-contentful-paint');
        const weight = val('total-byte-weight');
        return {
            performance: pct('performance'),
            seo: pct('seo'),
            accessibility: pct('accessibility'),
            bestPractices: pct('best-practices'),
            lcp: lcp === null ? null : lcp / 1000,
            cls: val('cumulative-layout-shift'),
            tbt: val('total-blocking-time'),
            pageWeightMB: weight === null ? null : weight / 1048576,
            https: pass('is-on-https') !== null ? pass('is-on-https') : (finalUrl ? /^https:/i.test(finalUrl) : null),
            viewport: pass('viewport'),
            metaDescription: pass('meta-description'),
            finalUrl,
            fcp: val('first-contentful-paint') === null ? null : val('first-contentful-paint') / 1000,
            opps: opportunities(A)
        };
    }

    /* Einspar-Hinweise aus Lighthouse, kompakt: score, ms (Ersparnis LCP/FCP/TBT), kb (Ersparnis Bytes), n (Einträge) */
    const OPP_IDS = ['render-blocking-resources', 'render-blocking-insight', 'modern-image-formats', 'uses-optimized-images', 'uses-responsive-images',
        'image-delivery-insight', 'offscreen-images', 'unused-javascript', 'unused-css-rules', 'legacy-javascript-insight', 'duplicated-javascript-insight',
        'uses-text-compression', 'server-response-time', 'document-latency-insight', 'uses-long-cache-ttl', 'cache-insight', 'third-party-summary',
        'third-parties-insight', 'dom-size', 'dom-size-insight', 'bootup-time', 'mainthread-work-breakdown', 'font-display', 'font-display-insight',
        'lcp-discovery-insight', 'cls-culprits-insight'];
    function opportunities(A) {
        const out = {};
        OPP_IDS.forEach((id) => {
            const a = A[id];
            if (!a) return;
            const d = a.details || {};
            const ms = Math.max(0, isNum(d.overallSavingsMs) ? d.overallSavingsMs : 0, ...Object.values(a.metricSavings || {}).filter(isNum));
            let bytes = isNum(d.overallSavingsBytes) ? d.overallSavingsBytes : 0;
            if (!bytes && id === 'image-delivery-insight' && isNum(a.numericValue)) bytes = a.numericValue;
            out[id] = { score: isNum(a.score) ? Math.round(a.score * 100) / 100 : null, ms: Math.round(ms), kb: Math.round(bytes / 1024),
                num: isNum(a.numericValue) ? Math.round(a.numericValue) : null, n: Array.isArray(d.items) ? d.items.length : 0 };
        });
        return out;
    }

    /* ------------------------------------------------------------ Diagnose ---
       Technische Ursachen hinter den Messwerten, mit Beleg und Lösung, plus
       der Schmerzpunkt als Text für Report und Gespräch. Nur was gemessen ist. */
    function diagnose(psi, st) {
        const t = (st && st.tech) || {};
        const o = (psi && psi.opps) || {};
        const pick = (...ids) => ids.map((id) => o[id]).find((x) => x && x.score !== null && x.score < 0.9);
        const sec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
        const causes = [];
        const add = (c) => causes.push(c);
        const slow = psi && isNum(psi.lcp) && psi.lcp > THRESHOLDS.lcp;

        // System und Baukasten
        const stack = { cms: t.cms || null, version: t.version || null, theme: t.theme || null, builder: t.builder || null,
            plugins: (t.plugins || []).slice(0, 20), cachePlugin: t.cachePlugin || null, server: t.server || null, cdn: t.cdn || null };
        if (t.builder && (slow || (psi && isNum(psi.tbt) && psi.tbt > THRESHOLDS.tbt))) {
            add({ id: 'builder', sev: 3, area: 'speed', title: 'Page-Builder ' + t.builder + ' lädt viel Code',
                evidence: t.builder + ' erkannt' + (t.jquery ? ', dazu jQuery' : '') + (t.inlineCssKB > 40 ? ', ' + t.inlineCssKB + ' KB Inline-CSS' : '') + '. Solche Baukästen laden Skripte und Stile für alle Module, auch die, die die Seite gar nicht nutzt.',
                fix: 'Nicht genutzte ' + t.builder + '-Module und Widgets abschalten, Assets nur auf den Seiten laden, wo sie gebraucht werden. Auf Dauer: schlankes Theme statt Baukasten.' });
        }
        if (t.cms === 'WordPress' && (t.heavyPlugins || []).length) {
            add({ id: 'heavy-plugins', sev: 2, area: 'speed', title: 'Schwere Plugins: ' + t.heavyPlugins.slice(0, 3).join(', '),
                evidence: 'Mindestens ' + t.pluginCount + ' Plugins im Quelltext sichtbar, darunter ' + t.heavyPlugins.join(', ') + '.',
                fix: 'Plugins prüfen und ersetzen oder entfernen, die auf jeder Seite Code laden. Slider und Effekt-Pakete sind die häufigsten Bremsen.' });
        } else if (t.cms === 'WordPress' && t.pluginCount >= 15) {
            add({ id: 'many-plugins', sev: 2, area: 'speed', title: 'Viele Plugins (mindestens ' + t.pluginCount + ')',
                evidence: t.pluginCount + ' Plugins laden sichtbar Dateien auf der Startseite.',
                fix: 'Plugins ausmisten: Jedes, das nur selten gebraucht wird, kostet bei jedem Seitenaufruf Ladezeit.' });
        }
        const srv = (o['server-response-time'] && o['server-response-time'].num) || (st && st.ttfbMs) || null;
        if (t.cms === 'WordPress' && !t.cachePlugin && !t.pageCache && srv && srv > 600) {
            add({ id: 'no-cache', sev: 3, area: 'speed', title: 'Kein Seiten-Cache erkennbar',
                evidence: 'Der Server braucht ' + sec(srv) + ' für die erste Antwort, ein Cache-Plugin ist nicht zu sehen.',
                fix: 'Seiten-Cache einrichten (z. B. LiteSpeed Cache oder WP Rocket, je nach Hosting). Damit baut WordPress die Seite nicht bei jedem Aufruf neu.' });
        } else if (srv && srv > 800) {
            add({ id: 'server', sev: 2, area: 'speed', title: 'Langsame Server-Antwort',
                evidence: 'Erste Antwort nach ' + sec(srv) + ' (gut sind unter 0,8 s).',
                fix: 'Hosting und Cache prüfen: schnellerer Tarif, PHP-Version aktualisieren, Seiten-Cache oder CDN.' });
        }

        // Ladezeit-Ursachen aus PageSpeed
        const rb = pick('render-blocking-insight', 'render-blocking-resources');
        if ((rb && rb.ms >= 150) || t.blockingScripts >= 3) {
            add({ id: 'render-blocking', sev: rb && rb.ms >= 500 ? 3 : 2, area: 'speed', title: 'Skripte und Styles blockieren die Anzeige',
                evidence: (rb && rb.ms ? 'Etwa ' + sec(rb.ms) + ' Verzögerung' + (rb.n ? ' durch ' + rb.n + ' Dateien' : '') : t.blockingScripts + ' Skripte im Kopf der Seite ohne async/defer') + ', bevor überhaupt etwas zu sehen ist.',
                fix: 'JavaScript mit defer laden, nur das nötige CSS direkt einbinden (Critical CSS), den Rest nachladen.' });
        }
        const js = pick('unused-javascript');
        const main = o['mainthread-work-breakdown'];
        if ((js && js.kb >= 100) || (psi && isNum(psi.tbt) && psi.tbt > 600)) {
            add({ id: 'javascript', sev: psi && psi.tbt > 600 ? 3 : 2, area: 'speed', title: 'Zu viel JavaScript',
                evidence: [js && js.kb ? 'rund ' + js.kb + ' KB ungenutzter Code' : null, psi && isNum(psi.tbt) ? 'Handy ist ' + sec(psi.tbt) + ' blockiert' : null, main && main.num ? sec(main.num) + ' Rechenzeit im Browser' : null].filter(Boolean).join(', ') + '.',
                fix: 'Ungenutzte Skripte entfernen oder erst bei Bedarf laden (z. B. Slider, Animationen, Tracking), jQuery-Abhängigkeiten reduzieren.' });
        }
        const css = pick('unused-css-rules');
        if (css && css.kb >= 40) {
            add({ id: 'css', sev: 1, area: 'speed', title: 'Ungenutztes CSS',
                evidence: 'Rund ' + css.kb + ' KB Stil-Code werden geladen, aber auf der Seite nicht gebraucht.',
                fix: 'CSS je Seite aufteilen oder ungenutzte Regeln entfernen.' });
        }
        const img = pick('image-delivery-insight', 'modern-image-formats', 'uses-optimized-images', 'uses-responsive-images');
        const legacyShare = t.images ? t.legacyImages / t.images : 0;
        if ((img && img.kb >= 80) || (t.images >= 4 && legacyShare >= 0.5)) {
            add({ id: 'images', sev: img && img.kb >= 300 ? 3 : 2, area: 'speed', title: 'Bilder nicht optimiert (WebP/AVIF, Größe)',
                evidence: [img && img.kb ? 'rund ' + img.kb + ' KB einsparbar' : null, t.images ? t.legacyImages + ' von ' + t.images + ' Bildern als JPG/PNG/GIF' : null].filter(Boolean).join(', ') + '.',
                fix: 'Bilder als WebP oder AVIF in passender Größe ausliefern, mit srcset für das Handy. Das Hauptbild nicht verzögert laden.' });
        }
        const lcpd = o['lcp-discovery-insight'];
        if (slow && lcpd && lcpd.score !== null && lcpd.score < 0.9) {
            add({ id: 'lcp-element', sev: 2, area: 'speed', title: 'Hauptbild wird zu spät geladen',
                evidence: 'Das größte Element oben auf der Seite wird nicht vorrangig geladen (Lazy Loading oder fehlende Priorität).',
                fix: 'Für das Hauptbild „loading=lazy“ entfernen und fetchpriority="high" setzen.' });
        }
        const comp = pick('uses-text-compression');
        if (comp) { // nur nach Google-Messung: im Cloudflare-Worker fehlt der Header, weil die Antwort schon entpackt ist
            add({ id: 'compression', sev: 2, area: 'speed', title: 'Keine Komprimierung (gzip/Brotli)',
                evidence: comp.kb ? 'Rund ' + comp.kb + ' KB ließen sich durch Komprimierung sparen.' : 'Der Server liefert Dateien unkomprimiert aus.',
                fix: 'Brotli- oder gzip-Komprimierung beim Hosting einschalten.' });
        }
        const cache = pick('cache-insight', 'uses-long-cache-ttl');
        if (cache && cache.n >= 5) {
            add({ id: 'browser-cache', sev: 1, area: 'speed', title: 'Browser-Cache zu kurz',
                evidence: cache.n + ' Dateien werden bei jedem Besuch neu geladen.',
                fix: 'Lange Cache-Zeiten für Bilder, CSS und JavaScript setzen.' });
        }
        const tp = pick('third-parties-insight', 'third-party-summary');
        if ((tp && tp.ms >= 250) || (t.thirdParty || []).length >= 5) {
            add({ id: 'third-party', sev: 2, area: 'speed', title: 'Fremd-Skripte bremsen',
                evidence: ((t.thirdParty || []).length ? 'Skripte von ' + t.thirdParty.slice(0, 4).join(', ') + (t.thirdParty.length > 4 ? ' und weiteren' : '') : 'Skripte anderer Anbieter') + (tp && tp.ms ? ', etwa ' + sec(tp.ms) + ' Verzögerung' : '') + '.',
                fix: 'Nicht nötige Einbindungen entfernen, den Rest erst nach Einwilligung oder Klick laden.' });
        }
        const dom = o['dom-size-insight'] || o['dom-size'];
        if (dom && dom.num > 1500) {
            add({ id: 'dom', sev: 1, area: 'speed', title: 'Sehr verschachtelter Seitenaufbau',
                evidence: dom.num + ' HTML-Elemente auf der Startseite' + (t.builder ? ', typisch für ' + t.builder : '') + '.',
                fix: 'Abschnitte vereinfachen, verschachtelte Container zusammenfassen.' });
        }
        const cls = o['cls-culprits-insight'];
        if (psi && isNum(psi.cls) && psi.cls > THRESHOLDS.cls) {
            add({ id: 'cls', sev: 2, area: 'speed', title: 'Inhalte springen beim Laden',
                evidence: 'Layout-Verschiebung ' + psi.cls.toFixed(2).replace('.', ',') + (t.imagesNoSize ? ', ' + t.imagesNoSize + ' Bilder ohne feste Größe' : '') + (cls && cls.n ? ', ' + cls.n + ' Verursacher' : '') + '.',
                fix: 'Bildern und Werbeflächen feste Maße geben, Schriften mit font-display laden.' });
        }
        // Rechtliches mit Technik-Bezug
        if (t.googleFonts) {
            add({ id: 'google-fonts', sev: 2, area: 'recht', title: 'Google Fonts werden von Google-Servern geladen',
                evidence: 'Die Seite lädt Schriften direkt von fonts.googleapis.com. Dabei geht die IP-Adresse jedes Besuchers an Google.',
                fix: 'Schriften lokal einbinden. Das LG München I (Urteil vom 20.01.2022, 3 O 17493/20) hat das dynamische Einbinden ohne Einwilligung als Datenschutzverstoß gewertet.' });
        }
        causes.sort((a, b) => b.sev - a.sev);
        return { stack, causes: causes.slice(0, 8), pain: painText(psi, causes) };
    }

    /* Schmerzpunkt: was die Ladezeit für Anfragen bedeutet. Keine erfundenen Rankings. */
    function painText(psi, causes) {
        if (!psi || !isNum(psi.lcp)) return null;
        const s = psi.lcp.toFixed(1).replace('.', ',');
        const top = causes.filter((c) => c.area === 'speed')[0];
        if (psi.lcp <= THRESHOLDS.lcp) {
            return { level: 'ok', headline: 'Schnell genug: Hauptinhalt nach ' + s + ' s.',
                text: 'Die Ladezeit liegt im grünen Bereich (Google empfiehlt höchstens 2,5 s). Der Hebel für mehr Anfragen liegt hier eher bei lokaler Suche und Inhalten.', cause: null };
        }
        return {
            level: psi.lcp > 4 ? 'bad' : 'warn',
            headline: 'Auf dem Handy dauert es ' + s + ' s, bis Ihre Seite steht. Google empfiehlt höchstens 2,5 s.',
            text: 'Wer unterwegs einen Betrieb sucht, wartet nicht: Laut einer Google-Studie steigt die Wahrscheinlichkeit, dass Besucher abspringen, um 32 %, wenn die Ladezeit von 1 auf 3 Sekunden steigt, bei 5 Sekunden um 90 %. '
                + 'Dazu bewertet Google die Ladezeit auf dem Handy selbst mit (Core Web Vitals). Bei sonst ähnlichen Seiten kann das in der lokalen Suche entscheiden, ob Sie unter den ersten drei Treffern stehen oder ein Mitbewerber.',
            cause: top ? 'Hauptursache: ' + top.title + '.' : null
        };
    }

    function evaluateSignals(psi, st) {
        return SIGNALS.map((s) => {
            let ok;
            try { ok = s.test(psi || null, st || null); } catch (err) { ok = undefined; }
            ok = typeof ok === 'boolean' ? ok : undefined;
            let evidence = '';
            if (ok === false && s.evidence) { try { evidence = s.evidence(psi || null, st || null) || ''; } catch (err) { evidence = ''; } }
            return { id: s.id, group: s.group, sev: s.sev, label: s.label, miss: s.miss, ok, evidence, impact: s.impact, fix: s.fix };
        });
    }

    function groupPoint(key, results) {
        const known = results.filter((r) => r.group === key && r.ok !== undefined);
        const signals = known.map((r) => ({ id: r.id, label: r.label, ok: r.ok }));
        if (known.length < MIN_KNOWN) {
            return { key, title: TITLES[key], status: 'pending', value: 'im Report', met: null, total: null, signals,
                text: 'Diesen Punkt prüfe ich vollständig im persönlichen Report.' };
        }
        const met = known.filter((r) => r.ok).length;
        const weightAll = known.reduce((a, r) => a + r.sev, 0);
        const weightOk = known.filter((r) => r.ok).reduce((a, r) => a + r.sev, 0);
        const ratio = weightOk / weightAll;
        let status = ratio >= THRESHOLDS.status.good ? 'good' : ratio >= THRESHOLDS.status.warn ? 'warn' : 'bad';
        if (status === 'good' && known.some((r) => !r.ok && r.sev === 3)) status = 'warn'; // ein kritisches Signal fehlt
        const missing = known.filter((r) => !r.ok).sort((a, b) => b.sev - a.sev);
        // Bei der Ladezeit führt der konkrete Messwert, das Signal wird dann nicht noch einmal genannt.
        const lead = key === 'performance' ? missing.find((r) => r.evidence) : null;
        const rest = lead ? missing.filter((r) => r !== lead) : missing;
        let text = rest.length
            ? 'Es fehlt: ' + rest.slice(0, 3).map((r) => r.miss).join(', ') + (rest.length > 3 ? ' und ' + (rest.length - 3) + ' weitere.' : '.')
            : missing.length ? '' : 'Alle ' + known.length + ' Signale erfüllt.';
        if (lead) text = (lead.evidence + ' ' + text).trim();
        return { key, title: TITLES[key], status, value: met + ' von ' + known.length, met, total: known.length, ratio, signals, text };
    }

    /* Offene Punkte: die schwächsten gemessenen Punkte, bei Gleichstand nach ORDER. */
    function pickOpen(points) {
        return points
            .map((p, i) => ({ p, i }))
            .filter((x) => x.p.status !== 'pending')
            .sort((a, b) => RANK[b.p.status] - RANK[a.p.status] || (a.p.ratio || 0) - (b.p.ratio || 0) || a.i - b.i)
            .slice(0, OPEN_COUNT)
            .map((x) => x.p.key);
    }

    function headlineFor(ratio, measured) {
        const t = THRESHOLDS.headline;
        if (!measured) return 'Messung gerade nicht möglich.';
        return ratio >= t.strong ? 'Starke Grundlage.'
            : ratio >= t.solid ? 'Solide, aber Anfragen bleiben liegen.'
            : ratio >= t.losing ? 'Hier gehen Anfragen verloren.'
            : 'Deutlicher Handlungsbedarf.';
    }

    function buildReport(opts) {
        const results = evaluateSignals(opts.psi, opts.structure);
        const points = ORDER.map((k) => groupPoint(k, results));
        const counted = points.filter((p) => p.status !== 'pending');
        const known = results.filter((r) => r.ok !== undefined && counted.some((p) => p.key === r.group));
        const met = known.filter((r) => r.ok).length;
        const wAll = known.reduce((a, r) => a + r.sev, 0);
        const wOk = known.filter((r) => r.ok).reduce((a, r) => a + r.sev, 0);
        const ratio = wAll ? wOk / wAll : null;
        const openKeys = pickOpen(points);
        return {
            version: VERSION,
            id: opts.id || null,
            url: opts.url,
            name: opts.name,
            measuredAt: opts.measuredAt || new Date().toISOString(),
            source: opts.source || (opts.structure ? 'Google PageSpeed und Strukturanalyse' : 'Google PageSpeed Insights (Smartphone)'),
            met: known.length ? met : null,
            total: known.length || null,
            ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
            headline: headlineFor(ratio, known.length > 0),
            points: points.map((p) => ({ key: p.key, title: p.title, status: p.status, value: p.value, text: p.text,
                open: openKeys.includes(p.key), met: p.met, total: p.total, signals: p.signals })),
            diagnosis: (opts.psi || opts.structure) ? diagnose(opts.psi, opts.structure) : null
        };
    }

    /* Fehlende Signale als Befunde (für den Problemcase im Harvey-Agent). */
    function findingsFrom(opts) {
        return evaluateSignals(opts.psi, opts.structure)
            .filter((r) => r.ok === false)
            .sort((a, b) => b.sev - a.sev || ORDER.indexOf(a.group) - ORDER.indexOf(b.group))
            .map((r) => ({ id: r.id, area: r.group, severity: r.sev, title: r.miss.charAt(0).toUpperCase() + r.miss.slice(1),
                evidence: r.evidence || 'Nicht erfüllt: ' + r.label + '.', impact: r.impact, fix: r.fix }));
    }

    /* Prüft ein geladenes Report-JSON und gibt eine bereinigte Kopie zurück (oder null). */
    function sanitizeReport(d) {
        if (!d || d.version !== VERSION || !Array.isArray(d.points)) return null;
        const str = (v, n) => String(v == null ? '' : v).slice(0, n);
        const int = (v) => (isNum(v) ? Math.max(0, Math.round(v)) : null);
        const byKey = {};
        d.points.forEach((p) => { if (p && ORDER.includes(p.key) && !byKey[p.key]) byKey[p.key] = p; });
        const points = ORDER.map((k) => {
            const p = byKey[k] || { key: k, status: 'pending' };
            const status = RANK[p.status] !== undefined ? p.status : 'pending';
            return { key: k, title: TITLES[k], status, value: str(p.value || 'im Report', 30), text: str(p.text, 320),
                met: int(p.met), total: int(p.total), open: false,
                signals: (Array.isArray(p.signals) ? p.signals : []).slice(0, 14).map((s) => ({ id: str(s.id, 20), label: str(s.label, 80), ok: s.ok === true })) };
        });
        let openKeys = points.filter((p) => byKey[p.key] && byKey[p.key].open === true && p.status !== 'pending').map((p) => p.key).slice(0, OPEN_COUNT);
        if (!openKeys.length) openKeys = pickOpen(points);
        points.forEach((p) => { p.open = openKeys.includes(p.key); });
        const met = int(d.met);
        const total = int(d.total);
        return {
            version: VERSION,
            id: str(d.id, 90),
            url: str(d.url, 200),
            name: str(d.name, 120),
            measuredAt: str(d.measuredAt, 40),
            source: str(d.source, 80),
            met: total ? Math.min(met || 0, total) : null,
            total: total || null,
            ratio: isNum(d.ratio) ? Math.max(0, Math.min(1, d.ratio)) : null,
            headline: str(d.headline, 80) || headlineFor(null, false),
            points,
            diagnosis: cleanDiagnosis(d.diagnosis, str)
        };
    }

    function cleanDiagnosis(g, str) {
        if (!g || typeof g !== 'object') return null;
        const st = g.stack || {};
        const causes = (Array.isArray(g.causes) ? g.causes : []).slice(0, 8).map((c) => ({ id: str(c.id, 30), sev: isNum(c.sev) ? Math.max(1, Math.min(3, c.sev)) : 1, area: str(c.area, 10),
            title: str(c.title, 120), evidence: str(c.evidence, 400), fix: str(c.fix, 400) }));
        const p = g.pain && typeof g.pain === 'object' ? { level: str(g.pain.level, 6), headline: str(g.pain.headline, 160), text: str(g.pain.text, 600), cause: str(g.pain.cause, 160) } : null;
        return { stack: { cms: str(st.cms, 30) || null, version: str(st.version, 20) || null, theme: str(st.theme, 60) || null, builder: str(st.builder, 40) || null,
            plugins: (Array.isArray(st.plugins) ? st.plugins : []).slice(0, 20).map((x) => str(x, 60)), cachePlugin: str(st.cachePlugin, 60) || null }, causes, pain: p };
    }

    return { VERSION, OPEN_COUNT, THRESHOLDS, TITLES, ORDER, STATUS_TEXT, AI_BOTS, SIGNALS, fmt,
        metricsFromLighthouse, evaluateSignals, buildReport, findingsFrom, sanitizeReport, diagnose };
}));
