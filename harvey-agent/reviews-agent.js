#!/usr/bin/env node
/* =============================================================================
   KASI · Bewertungs-Agent (Google-Unternehmensprofil)

   npm run reviews          neue Bewertungen finden, Antworten vorschreiben
   npm run reviews -- --list    verbundene Profile anzeigen

   Voraussetzung: Google verbunden (Zentrale → Agenten) und Ihr Konto ist
   Verwalter der Unternehmensprofile Ihrer Kunden. Antworten landen als
   Entwurf (Typ „Bewertung“) im Postausgang; „Freigeben & Senden“
   veröffentlicht sie im Profil. Bei 1 bis 3 Sternen kommt ein Hinweis aufs Handy.
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const Google = require('./core/google.js');
const AI = require('./core/ai.js');
const Notify = require('./core/notify.js');
const Events = require('./core/events.js');
const Run = require('./core/runlog.js');

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';

function template(stars, name, business) {
    const hi = 'Hallo' + (name ? ' ' + name : '') + ',';
    if (stars >= 4) return hi + '\n\nvielen Dank für Ihre Bewertung und das Vertrauen in ' + business + '. Es freut uns sehr, dass Sie zufrieden sind. Wir sind gern wieder für Sie da.\n\nIhr Team von ' + business;
    if (stars === 3) return hi + '\n\ndanke für Ihre ehrliche Rückmeldung. Wir möchten verstehen, was wir besser machen können. Rufen Sie uns gern an oder schreiben Sie uns, damit wir das persönlich klären.\n\nIhr Team von ' + business;
    return hi + '\n\nes tut uns leid, dass Sie nicht zufrieden waren. Das nehmen wir ernst. Bitte melden Sie sich direkt bei uns, damit wir die Sache gemeinsam klären können.\n\nIhr Team von ' + business;
}

async function main() {
    Store.ensure();
    if (!Google.connected()) {
        console.log('Google nicht verbunden: Zentrale → Agenten → „Google verbinden“.');
        return Run.done('reviews', { ok: false, summary: 'Google nicht verbunden' });
    }
    const locs = await Google.locations();
    if (process.argv.includes('--list')) { locs.forEach((l) => console.log('· ' + l.title + ' · ' + (l.website || 'ohne Website'))); return; }
    const prev = (Run.all().reviews || {}).data || {};
    const seen = new Set(prev.seen || []);
    let drafts = 0;
    const notes = [];
    for (const loc of locs) {
        let list = [];
        try { list = await Google.reviews(loc); } catch (err) { notes.push(loc.title + ': ' + err.message); continue; }
        for (const r of list) {
            if (seen.has(r.name)) continue;
            seen.add(r.name);
            if (r.reviewReply) continue; // schon beantwortet
            const stars = STARS[r.starRating] || 0;
            const name = first(r.reviewer && r.reviewer.displayName);
            let body = template(stars, name, loc.title);
            if (AI.available()) {
                try {
                    body = await AI.write('Schreibe eine öffentliche Antwort des Betriebs „' + loc.title + '“ auf diese Google-Bewertung (' + stars + ' von 5 Sternen). Höchstens 80 Wörter, persönlich, ohne Rechtfertigung, ohne Angebote oder Rabatte, keine personenbezogenen Details aus dem Auftrag nennen. Bei Kritik: bedauern, zur direkten Klärung einladen. Unterschrift: „Ihr Team von ' + loc.title + '“.\n\nBewertung von ' + (name || 'Kunde') + ':\n' + String(r.comment || '(nur Sterne, kein Text)').slice(0, 2000));
                } catch (err) { console.log('  ! KI: ' + err.message); }
            }
            Outbox.add({ key: 'review:' + r.name, type: 'bewertung', to: '', subject: 'Antwort auf Bewertung von ' + (name || 'Kunde') + ' (' + '★'.repeat(stars) + ') · ' + loc.title, body,
                ref: loc.website || loc.title, meta: { review: r.name, location: loc.title, stars, client: loc.title, comment: String(r.comment || '').slice(0, 600) } });
            drafts++;
            Events.record('review_new', { name: loc.title, label: 'Neue Bewertung · ' + stars + ' Sterne' });
            if (stars && stars <= 3) await Notify.send('Kasi: kritische Bewertung', loc.title + ': ' + stars + ' Sterne von ' + (name || 'Kunde') + '. Antwort-Entwurf liegt im Postausgang.', { priority: 'high' });
            console.log('★ ' + loc.title + ' · ' + stars + ' Sterne von ' + (name || 'Kunde') + ' → Entwurf');
        }
    }
    const summary = locs.length + ' Profile geprüft, ' + drafts + ' neue Bewertungen mit Antwort-Entwurf';
    console.log(summary);
    Run.done('reviews', { summary, notes, data: { seen: [...seen].slice(-5000) } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('reviews', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main };
