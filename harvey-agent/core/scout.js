/* =============================================================================
   KASI SCOUT · Betriebe finden, bewerten, Akquise-Ansatz vorschlagen
   Quelle: OpenStreetMap (Overpass API, frei nutzbar, © OpenStreetMap-Mitwirkende,
   ODbL). Keine Google-Suche: automatisches Auslesen verstößt gegen deren Bedingungen.

   Leidensdruck (0–100): gewichteter Anteil fehlender Signale + Aufschlag für
   kritische Kernpunkte. Potenzial: passende Pakete aus offer-rules.js.
   ============================================================================= */
'use strict';

const Offer = require('../../offer-rules.js');
const Drafts = require('./drafts.js');

// Branchen → OSM-Tags. Erweitern: einfach eine Zeile ergänzen.
const TRADES = {
    maler:        { label: 'Maler & Lackierer', tags: [['craft', 'painter']] },
    elektriker:   { label: 'Elektriker', tags: [['craft', 'electrician']] },
    zimmerer:     { label: 'Zimmerei', tags: [['craft', 'carpenter']] },
    schreiner:    { label: 'Schreinerei', tags: [['craft', 'joiner'], ['craft', 'cabinet_maker']] },
    sanitaer:     { label: 'Sanitär & Heizung', tags: [['craft', 'plumber'], ['craft', 'hvac'], ['craft', 'heating_engineer']] },
    dachdecker:   { label: 'Dachdecker', tags: [['craft', 'roofer']] },
    fliesenleger: { label: 'Fliesenleger', tags: [['craft', 'tiler']] },
    metallbau:    { label: 'Metallbau & Schlosserei', tags: [['craft', 'metal_construction'], ['craft', 'locksmith']] },
    glaser:       { label: 'Glaserei', tags: [['craft', 'glaziery']] },
    garten:       { label: 'Garten- & Landschaftsbau', tags: [['craft', 'gardener']] },
    bau:          { label: 'Bauunternehmen', tags: [['craft', 'builder'], ['office', 'construction_company']] },
    kfz:          { label: 'Kfz-Werkstatt', tags: [['shop', 'car_repair']] },
    steinmetz:    { label: 'Steinmetz', tags: [['craft', 'stonemason']] },
    raumausstatter: { label: 'Raumausstatter & Bodenleger', tags: [['craft', 'upholsterer'], ['craft', 'floorer']] }
};

// Öffentliche Overpass-Server; fällt einer aus (502/504/429), wird der nächste versucht
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const USER_AGENT = 'MW-Kasi-Scout/1.0 (+https://mw-itservices.de)';

function overpassQuery(city, tradeKeys) {
    const sel = tradeKeys.flatMap((k) => TRADES[k].tags)
        .map(([key, value]) => `  nwr["${key}"="${value}"]["website"](area.a);\n  nwr["${key}"="${value}"]["contact:website"](area.a);`).join('\n');
    const safeCity = String(city).replace(/["\\]/g, '');
    return `[out:json][timeout:90];
area["name"="${safeCity}"]["boundary"="administrative"]->.a;
(
${sel}
);
out tags center 400;`;
}

function tradeOf(tags) {
    for (const [k, t] of Object.entries(TRADES)) if (t.tags.some(([key, value]) => tags[key] === value)) return k;
    return null;
}

/* Betriebe aus OpenStreetMap holen (mit Website) */
async function findBusinesses(city, tradeKeys, ms = 100000, onRetry) {
    const errors = [];
    for (const server of OVERPASS) {
        const host = new URL(server).host;
        try { return await fetchOverpass(server, city, tradeKeys, ms); } catch (err) {
            const timeout = err.name === 'AbortError';
            errors.push(host + ': ' + (timeout ? 'keine Antwort' : err.message));
            if (!err.retry && !timeout && !/fetch failed/.test(err.message)) throw err;
            if (onRetry && server !== OVERPASS[OVERPASS.length - 1]) onRetry(host, errors[errors.length - 1]);
        }
    }
    throw new Error('OpenStreetMap gerade nicht erreichbar (' + errors.join('; ') + '). Bitte in ein paar Minuten erneut versuchen.');
}

async function fetchOverpass(server, city, tradeKeys, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(server, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Accept: 'application/json' },
            body: 'data=' + encodeURIComponent(overpassQuery(city, tradeKeys)),
            signal: ctrl.signal
        });
        if (!res.ok) { const e = new Error('Antwort ' + res.status + (res.status === 429 ? ' (zu viele Anfragen)' : '')); e.retry = res.status === 429 || res.status >= 500; throw e; }
        const data = await res.json();
        return (data.elements || []).map((e) => {
            const t = e.tags || {};
            return {
                name: t.name || t.operator || '',
                website: t.website || t['contact:website'] || '',
                trade: tradeOf(t),
                street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
                zip: t['addr:postcode'] || '',
                city: t['addr:city'] || city,
                phone: t.phone || t['contact:phone'] || '',
                source: 'OpenStreetMap ' + e.type + '/' + e.id
            };
        }).filter((b) => b.name && b.website);
    } finally {
        clearTimeout(timer);
    }
}

/* Leidensdruck 0–100 aus dem Report (vis-rules) */
function painScore(report) {
    if (!report || !report.total) return null;
    const base = (1 - (report.ratio || 0)) * 80;
    const bad = report.points.filter((p) => p.status === 'bad').length * 7;
    const warn = report.points.filter((p) => p.status === 'warn').length * 2;
    return Math.min(100, Math.round(base + bad + warn));
}

/* Passende Leistungen und geschätzter Auftragswert (Listenpreise, netto) */
function potential(report, findings) {
    const by = (area) => findings.filter((f) => f.area === area);
    const status = Object.fromEntries((report ? report.points : []).map((p) => [p.key, p.status]));
    const perfBad = status.performance === 'bad' || by('performance').some((f) => f.id === 'lcp' && f.severity === 3);
    const sel = { base: 'none', extras: [], care: 'none' };
    const why = [];
    if (perfBad || status.https === 'bad' || by('performance').length >= 3) { sel.base = 'starter'; why.push('neue, schnelle Website'); }
    if (status.ai !== 'good' && by('ai').length >= 2) { sel.extras.push('geo'); why.push('KI-/GEO-Sichtbarkeit'); }
    if (by('local').some((f) => ['maps', 'reviews', 'schema', 'nap'].includes(f.id))) { sel.extras.push('gbp'); why.push('Google-Unternehmensprofil'); }
    if (status.local !== 'good') { sel.care = 'care'; why.push('laufende Pflege & Local SEO'); }
    if (sel.base === 'none' && !sel.extras.length && sel.care === 'none') return { once: 0, month: 0, yearValue: 0, packages: [], why: [] };
    // Preise ohne Aktion, damit die Schätzung nicht von Black-Friday-Preisen abhängt
    const q = Offer.quote(sel, '2100-01-01');
    return {
        once: q.once, month: q.month, yearValue: q.once + q.month * 12,
        packages: q.lines.map((l) => l.label), why, selection: q.selection
    };
}

/* Akquise-Ansatz je erlaubtem Kontaktweg (§ 7 UWG) */
function approach(b, report, findings, channel) {
    const top = findings.slice(0, 3);
    const hook = top[0] ? top[0].evidence : 'Die Seite hat noch ungenutzte Hebel bei Google und KI-Assistenten.';
    const trade = b.trade && TRADES[b.trade] ? TRADES[b.trade].label : 'Betrieb';
    const points = top.map((f) => '- ' + f.title + ': ' + (f.evidence && !/^Nicht erfüllt/.test(f.evidence) ? f.evidence : f.impact)).join('\n');
    const base = {
        brief: {
            channel: 'Brief per Post',
            note: 'Ohne Einwilligung keine Werbe-Mail und kein Werbeanruf. Brief ist zulässig; Datenschutzhinweis (Art. 14 DSGVO) mit Link auf mw-itservices.de/datenschutz beilegen.',
            opener: 'Betreff: ' + b.name + ' – drei Punkte, die bei Google und auf dem Handy Anfragen kosten',
            text: 'Guten Tag,\n\nals ' + trade + ' in ' + (b.city || 'der Region') + ' leben Sie von Anfragen aus der Umgebung. Ich habe Ihre Website gemessen:\n' + points
                + '\n\nDas vollständige Ergebnis zeige ich Ihnen gern in 15 Minuten, kostenlos und unverbindlich.\n\n' + Drafts.SIGNATURE
        },
        persoenlich: {
            channel: 'Persönlich vorbeischauen',
            note: 'Ausgedruckte Messung mitnehmen, kurz halten, Visitenkarte und Brief dalassen.',
            opener: 'Ich bin Michael Weichenberger aus Augsburg und baue Websites für Handwerksbetriebe. ' + hook + ' Darf ich Ihnen in zwei Minuten zeigen, was das für Ihre Anfragen bedeutet?',
            text: 'Gesprächsleitfaden:\n1. Einstieg: ' + hook + '\n2. Zeigen: Handy-Ladezeit live, Google-Suche „' + trade + ' ' + (b.city || '') + '“\n3. Angebot: kostenloser 15-Minuten-Termin mit vollständigem Report\n' + points
        },
        bestehend: {
            channel: 'Bestehender Kontakt (E-Mail/Anruf)',
            note: 'Nur bei echter bestehender Geschäftsbeziehung oder Einwilligung.',
            opener: 'Kurze Frage zu Ihrer Website',
            text: 'Hallo,\n\nmir ist bei Ihrer Website etwas aufgefallen: ' + hook + '\n\nSoll ich Ihnen die Messung schicken? Dauert keine 15 Minuten, sie zu besprechen.' + (Drafts.BOOKING_URL ? '\n\nTermin direkt buchen: ' + Drafts.BOOKING_URL : '') + '\n\nViele Grüße\nMichael'
        }
    };
    return base[channel] || base.brief;
}

module.exports = { TRADES, findBusinesses, painScore, potential, approach, overpassQuery };
