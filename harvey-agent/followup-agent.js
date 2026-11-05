#!/usr/bin/env node
/* =============================================================================
   KASI · Nachfass-Agent

   npm run followup             Angebote ohne Antwort finden, Nachfass-Entwürfe anlegen
   npm run followup -- --dry    nur anzeigen

   Quellen:
   - Web-Dashboard (Cloudflare D1): Anfragen und Paket-Anfragen mit Status
     „Angebot / Mail raus“. Diese Personen haben selbst angefragt, eine
     Nachfrage per Mail zum Angebot ist daher zulässig.
   - Lokal: gesendete Angebots-Mails aus dem Postausgang ohne Antwort.
   - Akquise per Brief (leads.json, „angeschrieben“): KEINE Mail (§ 7 UWG),
     stattdessen eine Erinnerung für Nachfass-Brief oder Besuch.

   Stufen nach Tagen seit dem Angebot: 5 · 10 · 21 (einstellbar mit --days 5,10,21).
   Bucht jemand einen Termin, antwortet oder wird Kunde, endet das Nachfassen:
   offene Nachfass-Entwürfe werden verworfen. Gesendet wird nur im Postausgang.
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const Drafts = require('./core/drafts.js');
const AI = require('./core/ai.js');
const Cloud = require('./core/cloud.js');
const Run = require('./core/runlog.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');
const STAGES = (opt('days') || '5,10,21').split(',').map(Number).filter((n) => n > 0);
const DAY = 86400000;
const log = (m) => console.log(m);
const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / DAY);

const TEXT = {
    1: { subject: 'Kurze Nachfrage zu Ihrem Angebot', body: 'ich wollte kurz nachhören, ob mein Angebot für {name} gut angekommen ist und ob noch Fragen offen sind. Wenn etwas unklar ist oder Sie lieber in einem kurzen Gespräch drüber sprechen möchten, melden Sie sich gern. Ich passe das Angebot auch an, wenn Ihnen etwas fehlt oder zu viel ist.' },
    2: { subject: 'Ihr Angebot für {name}: passt der Zeitpunkt?', body: 'mein Angebot für {name} liegt jetzt etwa zehn Tage bei Ihnen. Im Handwerk ist gerade viel los, das verstehe ich gut. Falls es jetzt nicht passt, sagen Sie mir einfach, wann ich mich wieder melden darf. Sonst können wir die nächsten Schritte in 15 Minuten am Telefon klären.' },
    3: { subject: 'Ich halte Ihr Angebot noch für Sie bereit', body: 'ich melde mich ein letztes Mal zu meinem Angebot für {name}. Ich halte es gern noch bis Monatsende für Sie bereit. Wenn das Thema für Sie gerade nicht dran ist, ist das völlig in Ordnung; eine kurze Rückmeldung hilft mir bei der Planung. Danach melde ich mich von selbst nicht mehr.' }
};

async function personalize(stage, c, fallback) {
    if (!AI.available()) return fallback;
    try {
        return await AI.write([
            'Schreibe eine kurze Nachfass-Mail (Stufe ' + stage + ' von 3) zu einem Angebot für eine Website. Nur den Text ab der Anrede, ohne Betreff, ohne Signatur, 60 bis 110 Wörter.',
            'Stufe 1: freundlich nachfragen. Stufe 2: Verständnis für wenig Zeit, Termin anbieten. Stufe 3: letzte Nachfrage, Tür offen lassen, keinen Druck.',
            'Kontext (nur verwenden, was hier steht):',
            JSON.stringify({ betrieb: c.name, website: c.url, thema: c.topic || null, nachricht: c.message ? String(c.message).slice(0, 600) : null, auswahl: c.selection || null, angebotVorTagen: c.days })
        ].join('\n'));
    } catch (err) {
        log('  ! KI nicht verfügbar (' + err.message + '), Standardtext.');
        return fallback;
    }
}

async function cloudCases() {
    try {
        return (await Cloud.query("SELECT id, kind, status, name, url, email, sent_at, topic, message, selection FROM leads WHERE kind IN ('anfrage','paket') AND email IS NOT NULL AND sent_at IS NOT NULL"))
            .map((r) => ({ src: 'cloud', key: 'cloud:' + r.id, cloudId: r.id, name: r.name, url: r.url, to: r.email, sentAt: r.sent_at, open: r.status === 'gesendet', topic: r.topic, message: r.message, selection: r.selection }));
    } catch (err) {
        log('! Web-Dashboard nicht abrufbar: ' + err.message);
        return [];
    }
}

function localCases() {
    // gesendete Angebote aus dem Postausgang ohne Antwort
    return Outbox.all().filter((e) => e.type === 'angebot' && e.status === 'gesendet' && e.to)
        .map((e) => ({ src: 'local', key: 'mail:' + e.id, name: (e.meta && e.meta.client) || e.ref || e.to, url: (e.meta && e.meta.url) || '', to: e.to, sentAt: e.sentAt, open: !e.repliedAt, topic: e.subject }));
}

async function main() {
    Store.ensure();
    const notes = [];
    const cases = [...await cloudCases(), ...localCases()];
    const box = Outbox.all();
    let created = 0;
    let stopped = 0;
    for (const c of cases) {
        const mine = box.filter((e) => e.type === 'nachfass' && e.meta && e.meta.case === c.key);
        const openDrafts = mine.filter((e) => ['entwurf', 'freigegeben'].includes(e.status));
        if (!c.open) {
            // Antwort, Termin oder Auftrag: Nachfassen beenden
            if (!DRY) openDrafts.forEach((e) => { Outbox.discard(e.id); stopped++; });
            continue;
        }
        const days = daysSince(c.sentAt);
        const stage = STAGES.filter((d) => days >= d).length;
        if (!stage) continue;
        const sentStages = mine.filter((e) => e.status === 'gesendet').map((e) => e.meta.stage);
        if (sentStages.includes(stage) || openDrafts.some((e) => e.meta.stage === stage)) continue;
        const lastSent = mine.filter((e) => e.status === 'gesendet').map((e) => e.sentAt).sort().pop();
        if (lastSent && daysSince(lastSent) < 4) continue; // nicht zu dicht hintereinander
        c.days = days;
        const t = TEXT[Math.min(stage, 3)];
        const name = c.name || 'Ihre Website';
        const core = await personalize(stage, c, t.body.replace(/\{name\}/g, name));
        const body = 'Guten Tag,\n\n' + core.replace(/^Guten Tag,?\s*/i, '').trim() + '\n\n' + Drafts.SIGNATURE;
        log('→ ' + name + ': Angebot vor ' + days + ' Tagen, Nachfass Stufe ' + stage + (DRY ? ' (Probelauf)' : ''));
        if (!DRY) {
            openDrafts.forEach((e) => Outbox.discard(e.id)); // ältere Stufe ersetzen
            Outbox.add({ key: 'nachfass:' + c.key + ':' + stage, type: 'nachfass', to: c.to, subject: t.subject.replace(/\{name\}/g, name), body, ref: c.url || c.to,
                contactAllowed: 'bestehend', meta: { case: c.key, stage, client: name, cloudId: c.cloudId || null, days } });
            created++;
        }
    }

    // Akquise per Brief: Erinnerung, keine Mail
    const letters = Store.load('leads').filter((l) => l.status === 'angeschrieben' && l.contactedAt && daysSince(l.contactedAt) >= 14 && !['einwilligung', 'bestehend'].includes(l.contactAllowed));
    letters.forEach((l) => notes.push('Nachfass-Brief oder Besuch: ' + (l.name || l.domain) + ' (angeschrieben vor ' + daysSince(l.contactedAt) + ' Tagen, Mail nicht erlaubt)'));

    const summary = created + (created === 1 ? ' Nachfass-Entwurf' : ' Nachfass-Entwürfe') + (stopped ? ', ' + stopped + ' beendet (Antwort/Termin)' : '') + (letters.length ? ', ' + letters.length + ' Brief-Erinnerungen' : '');
    log('Nachfass: ' + summary + '. Prüfen und senden im Postausgang.');
    notes.forEach((n) => log('  · ' + n));
    if (!DRY) Run.done('followup', { summary, notes });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('followup', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main };
