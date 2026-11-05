#!/usr/bin/env node
/* =============================================================================
   KASI · Onboarding neuer Kunden

   npm run onboarding            neue Aufträge übernehmen und vorbereiten
   npm run onboarding -- --dry   nur anzeigen

   1. Kundenstruktur: Aufträge aus dem Web-Dashboard (Status „Kunde“) werden in
      data/clients.json angelegt (Kundennummer, Paket, Domain, Kontakt).
   2. Projektordner out/kunden/<Kundennr>-<name>/ mit Checkliste, Material-
      Liste, Zugängen (ohne Passwörter) und Projektplan je nach Paket.
   3. Willkommensmail mit Checkliste als Entwurf im Postausgang (Typ
      „Willkommen“). Gesendet wird erst nach Ihrer Freigabe.
   Einmal je Kunde (clients.json → onboardedAt). Kunden mit
   "onboarding": false werden übersprungen.
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const Drafts = require('./core/drafts.js');
const Events = require('./core/events.js');
const Cloud = require('./core/cloud.js');
const Run = require('./core/runlog.js');
const Offer = require('../offer-rules.js');

const DRY = process.argv.includes('--dry');
const OUT = path.join(__dirname, 'out', 'kunden');
const slug = (s) => String(s || 'kunde').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const de = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '');

async function importWon(clients) {
    let rows = [];
    try {
        rows = await Cloud.query("SELECT id, name, url, email, phone, selection, won_at, start_at, created_at FROM leads WHERE status = 'auftrag'");
    } catch (err) {
        console.log('! Web-Dashboard nicht abrufbar: ' + err.message);
        return { added: [], offline: true };
    }
    let nextId = clients.reduce((m, c) => Math.max(m, Number(String(c.id).replace(/\D/g, '')) || 1000), 1000);
    const added = [];
    for (const l of rows) {
        if (clients.some((c) => c.harveyId === l.id || (l.email && c.email && c.email.toLowerCase() === String(l.email).toLowerCase()))) continue;
        let sel = null;
        try { sel = l.selection ? JSON.parse(l.selection) : null; } catch (_) { sel = null; }
        const domain = l.url ? String(l.url).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
        const c = { id: 'K-' + (++nextId), harveyId: l.id, company: l.name || domain || 'Neuer Kunde', contact: '', salutation: 'Guten Tag', email: l.email || '', phone: l.phone || '',
            street: '', zip: '', city: '', domains: domain ? [domain] : [], package: sel ? Offer.normalize(sel) : null,
            careSince: (l.start_at || l.won_at || '').slice(0, 10) || null, careUntil: null, notes: 'Vom Onboarding-Agenten angelegt. Anschrift ergänzen.' };
        // Aktionspreis festhalten, der zum Zeitpunkt der Anfrage galt (z. B. Black Friday), damit spätere Rechnungen stimmen
        if (c.package && l.created_at) {
            c.orderedAt = String(l.created_at).slice(0, 10);
            const q = Offer.quote(c.package, l.created_at);
            if (q.promo) {
                const start = new Date((c.careSince || c.orderedAt) + 'T12:00:00Z');
                const until = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + Offer.PROMO.months - 1, 1)).toISOString().slice(0, 7);
                c.careRate = { net: Offer.PROMO.month, until, note: 'Aktionspreis laut Anfrage vom ' + de(c.orderedAt) };
            }
        }
        clients.push(c);
        added.push(c);
    }
    return { added };
}

function plan(pkg) {
    const p = Offer.normalize(pkg || {});
    const q = Offer.quote(p);
    const base = p.base;
    const steps = [];
    if (base !== 'none') {
        steps.push(['Kick-off (30 Minuten): Ziele, Leistungen, Einzugsgebiet', 'Woche 1'],
            ['Material von Ihnen: Logo, Fotos, Texte oder Stichpunkte', 'Woche 1–2'],
            ['Entwurf der Startseite zur Abstimmung', base === 'multipage' ? 'Woche 3' : 'Woche 2'],
            ['Alle Seiten, Impressum, Datenschutz, Kontaktformular', base === 'multipage' ? 'Woche 4–6' : 'Woche 3'],
            ['Abnahme und Livegang', base === 'multipage' ? 'Woche 6–8' : 'Woche 3–4']);
    }
    if (p.extras.includes('gbp')) steps.push(['Google-Unternehmensprofil einrichten oder übernehmen (Verwaltungszugriff)', 'parallel']);
    if (p.extras.includes('geo')) steps.push(['GEO: einheitliche Firmendaten, strukturierte Daten, erster KI-Sichtbarkeits-Check', 'nach Livegang']);
    if (p.extras.includes('career')) steps.push(['Karriereseite mit Bewerberformular', 'mit den Seiten']);
    if (p.extras.includes('office')) steps.push(['Büro-Digitalisierung: Bestandsaufnahme vor Ort', 'nach Absprache']);
    if (p.care !== 'none') steps.push(['Betreuung „' + Offer.PRICES.care[p.care].label + '“ startet: täglicher Website-Wächter, Monatsbericht', 'ab Livegang']);
    return { p, q, steps };
}

function material(p) {
    const m = ['Logo als Datei (SVG oder PNG in guter Auflösung)', 'Fotos: Team, Betrieb, 5–10 eigene Projekte (gern vom Handy)', 'Leistungen in Stichpunkten, mit dem Wichtigsten zuerst',
        'Einzugsgebiet (Orte/Landkreise)', 'Angaben fürs Impressum: Inhaber/Geschäftsführung, Anschrift, Handelsregister, USt-IdNr., Kammer'];
    if (p.extras.includes('career')) m.push('Offene Stellen, was Ihren Betrieb als Arbeitgeber ausmacht');
    if (p.extras.includes('gbp')) m.push('Zugang zum Google-Unternehmensprofil: bitte info@mw-itservices.de als Verwalter einladen');
    return m;
}

function access(c) {
    return ['# Zugänge ' + c.company, '',
        '> Hier keine Passwörter eintragen. Zugangsdaten nur im Passwort-Manager speichern; hier nur vermerken, ob der Zugang da ist.', '',
        '| Zugang | vorhanden | Notiz |', '|---|---|---|',
        '| Domain / Registrar (' + ((c.domains || [])[0] || 'Domain') + ') | ☐ | |', '| Hosting / bisherige Website | ☐ | |', '| E-Mail-Postfächer (nicht ändern ohne Absprache) | ☐ | |',
        '| Google-Unternehmensprofil (Verwalter-Einladung) | ☐ | |', '| Google Search Console | ☐ | |', ''].join('\n');
}

function welcome(c, pl, mat) {
    const first = pl.steps.slice(0, 3).map((s, i) => (i + 1) + '. ' + s[0] + ' (' + s[1] + ')').join('\n');
    return [c.salutation && c.salutation !== 'Guten Tag' ? c.salutation + ',' : 'Guten Tag,', '',
        'vielen Dank für Ihren Auftrag. Ich freue mich auf die Zusammenarbeit mit ' + c.company + '.', '',
        'Gebucht: ' + pl.q.lines.map((l) => l.label).join(', ') + '.', '',
        'So geht es weiter:', first, '',
        'Damit ich starten kann, brauche ich von Ihnen:', mat.map((m) => '– ' + m).join('\n'), '',
        'Schicken Sie mir das gern nach und nach, es muss nicht alles auf einmal kommen. Fotos können Sie einfach per Mail oder als Link (z. B. WeTransfer) senden. Passwörter bitte nicht per Mail; die klären wir am Telefon.', '',
        'Für den Kick-off schlage ich Ihnen [BITTE EINTRAGEN: zwei Termine] vor.', '',
        Drafts.SIGNATURE].join('\n');
}

async function main() {
    Store.ensure();
    const clients = Store.load('clients');
    const { added, offline } = await importWon(clients);
    const notes = [];
    if (offline) notes.push('Web-Dashboard nicht erreichbar: neue Aufträge von dort beim nächsten Lauf');
    const todo = clients.filter((c) => !c.onboardedAt && c.onboarding !== false && (c.package || added.includes(c)));
    const done = [];
    for (const c of todo) {
        const pl = plan(c.package);
        const mat = material(pl.p);
        const dir = path.join(OUT, c.id + '-' + slug(c.company));
        console.log('→ ' + c.company + ' (' + c.id + '): ' + pl.q.lines.map((l) => l.label).join(', ') + (DRY ? ' (Probelauf)' : ''));
        if (DRY) continue;
        fs.mkdirSync(path.join(dir, 'material'), { recursive: true });
        fs.writeFileSync(path.join(dir, '00-Checkliste.md'), ['# Onboarding ' + c.company + ' (' + c.id + ')', '', 'Angelegt am ' + de(new Date().toISOString()) + '. Paket: ' + pl.q.lines.map((l) => l.label).join(', ') + '.', '',
            '- [ ] Willkommensmail freigegeben und gesendet', '- [ ] Kick-off-Termin steht', '- [ ] Anschrift und Ansprechpartner in den Stammdaten', '- [ ] Material vollständig (01-Material.md)',
            '- [ ] Zugänge geklärt (02-Zugaenge.md)', '- [ ] Erste Rechnung als Entwurf (Finanzen → Rechnung)', ...(pl.p.care !== 'none' ? ['- [ ] Domain im Website-Wächter (passiert automatisch über clients.json → domains)'] : []), ''].join('\n'));
        fs.writeFileSync(path.join(dir, '01-Material.md'), '# Material von ' + c.company + '\n\nAblage: Ordner material/\n\n' + mat.map((m) => '- [ ] ' + m).join('\n') + '\n');
        fs.writeFileSync(path.join(dir, '02-Zugaenge.md'), access(c));
        fs.writeFileSync(path.join(dir, '03-Projektplan.md'), '# Projektplan ' + c.company + '\n\n| Schritt | Zeitraum | erledigt |\n|---|---|---|\n' + pl.steps.map((s) => '| ' + s[0] + ' | ' + s[1] + ' | ☐ |').join('\n') + '\n\nZeiträume ab Kick-off, abhängig vom Material.\n');
        if (c.email) {
            Outbox.add({ key: 'willkommen:' + c.id, type: 'willkommen', to: c.email, subject: 'Willkommen bei MW IT-SERVICES: so starten wir', body: welcome(c, pl, mat), ref: c.id,
                contactAllowed: 'bestehend', meta: { client: c.company, clientId: c.id, folder: path.relative(__dirname, dir).replace(/\\/g, '/') } });
        } else notes.push(c.company + ': keine Mailadresse, Willkommensmail bitte selbst senden');
        c.onboardedAt = new Date().toISOString();
        c.folder = path.relative(__dirname, dir).replace(/\\/g, '/');
        Events.record('client_onboarded', { name: c.company, label: 'Onboarding vorbereitet', kind: 'Kunde' });
        if (c.harveyId) { try { await Cloud.log(c.harveyId, 'notiz', 'Onboarding vorbereitet: Projektordner und Willkommensmail (Entwurf)'); } catch (_) { /* offline */ } }
        done.push({ id: c.id, company: c.company, folder: c.folder });
    }
    if (!DRY) Store.save('clients', clients);
    added.forEach((c) => notes.push('Neu angelegt: ' + c.company + ' (' + c.id + '), Anschrift ergänzen'));
    const summary = done.length ? done.length + (done.length === 1 ? ' Kunde' : ' Kunden') + ' vorbereitet' + (added.length ? ', ' + added.length + ' aus dem Web-Dashboard übernommen' : '') : 'Keine neuen Kunden';
    console.log(summary + (done.length ? '. Willkommensmail im Postausgang prüfen.' : ''));
    if (!DRY) Run.done('onboarding', { summary, notes, data: { done } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('onboarding', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { plan, material };
