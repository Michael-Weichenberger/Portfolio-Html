#!/usr/bin/env node
/* =============================================================================
   KASI · Termine aus Cal.com (Buchung, Verschiebung, Absage)

   npm run buchungen        neue Webhook-Termine abholen und vorbereiten
   Läuft bei geöffneter Zentrale alle 2 Minuten und im Morgenlauf.

   Der Cal.com-Webhook landet im Cloudflare-Worker (Signatur geprüft) und dort
   in der Tabelle „bookings“. Kasi holt neue und geänderte Einträge ab und:
     gebucht     → Gesprächsakte verknüpfen, Überschneidungen mit dem Google
                   Kalender prüfen, persönliche Bestätigung als ENTWURF
     verschoben  → alten Entwurf verwerfen, neuen Entwurf mit neuer Zeit
     abgesagt    → offene Entwürfe zum Termin verwerfen, Entwurf „neuer Termin?“
   Gesendet wird nichts: alles liegt im Postausgang zur Freigabe.
   In den Kalender schreibt Kasi nicht. Den Eintrag legt Cal.com selbst an
   (Cal.com → Einstellungen → Kalender → Google Kalender verbinden).
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const Store = require('./core/datastore.js');
const Cloud = require('./core/cloud.js');
const Outbox = require('./core/outbox.js');
const Drafts = require('./core/drafts.js');
const Events = require('./core/events.js');
const Notify = require('./core/notify.js');
const Run = require('./core/runlog.js');

const BOOKING_URL = process.env.BOOKING_URL || 'https://cal.com/mw-itservices';
const AKTE = (leadId) => 'http://127.0.0.1:' + (Number(process.env.HARVEY_DASHBOARD_PORT) || 5590) + '/akte/cloud/' + leadId;
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr' : 'unbekannt');
const isVideo = (loc) => /^https?:\/\//i.test(String(loc || ''));

/* Überschneidungen mit anderen Einträgen im Google Kalender (der Cal.com-Termin selbst zählt nicht) */
async function conflicts(b) {
    const Google = require('./core/google.js');
    if (!Google.has('calendar') || !b.start_at) return null;
    const s = Date.parse(b.start_at);
    const e = b.end_at ? Date.parse(b.end_at) : s + 30 * 60000;
    try {
        const evs = await Google.calendarEvents(new Date(s - 60000).toISOString(), new Date(e + 60000).toISOString());
        const own = (x) => (x.attendees || []).some((a) => a.toLowerCase() === String(b.email || '').toLowerCase()) || (b.name && x.title.includes(b.name));
        return evs.filter((x) => !x.allDay && !own(x) && Date.parse(x.start) < e && Date.parse(x.end || x.start) > s).map((x) => x.title + ' (' + when(x.start) + ')');
    } catch (err) { return ['Kalender nicht prüfbar: ' + err.message]; }
}

function confirmText(b) {
    const ort = isVideo(b.location) ? 'Den Link zum Video-Gespräch finden Sie in der Bestätigung von Cal.com: ' + b.location : b.location ? 'Ort: ' + b.location : 'Ich rufe Sie zur vereinbarten Zeit an.';
    return ['Guten Tag' + (b.name ? ' ' + b.name : '') + ',', '',
        'vielen Dank für Ihre Terminbuchung. Ich freue mich auf unser Gespräch am ' + when(b.start_at) + '.', '',
        ort, '',
        'Damit wir die Zeit gut nutzen: Wenn Sie mögen, schicken Sie mir vorab Ihre Website-Adresse (falls vorhanden) und zwei, drei Stichpunkte, was Ihnen am wichtigsten ist. Fotos von Ihren Arbeiten helfen ebenfalls, sind aber kein Muss.', '',
        Drafts.SIGNATURE].join('\n');
}
function movedText(b) {
    return ['Guten Tag' + (b.name ? ' ' + b.name : '') + ',', '',
        'danke für die Info, der neue Termin passt: ' + when(b.start_at) + '.', '',
        (isVideo(b.location) ? 'Der Video-Link bleibt in der Bestätigung von Cal.com: ' + b.location : 'Ich melde mich zur neuen Zeit.'), '',
        Drafts.SIGNATURE].join('\n');
}
function cancelledText(b) {
    return ['Guten Tag' + (b.name ? ' ' + b.name : '') + ',', '',
        'schade, dass es zum Termin am ' + when(b.start_at) + ' nicht klappt. Wenn Sie möchten, buchen Sie sich einfach einen neuen Termin, der Ihnen besser passt:', BOOKING_URL, '',
        'Oder antworten Sie kurz auf diese Mail, dann schlage ich Ihnen zwei Zeiten vor.', '',
        Drafts.SIGNATURE].join('\n');
}

function discardFor(uid, keepStart) {
    Outbox.all().filter((e) => e.type === 'termin' && e.meta && e.meta.booking === uid && (keepStart === undefined || e.meta.start !== keepStart) && ['entwurf', 'freigegeben'].includes(e.status)).forEach((e) => Outbox.discard(e.id));
}

async function main() {
    Store.ensure();
    let rows;
    try {
        rows = await Cloud.query('SELECT * FROM bookings WHERE handled_at IS NULL ORDER BY updated_at LIMIT 25');
    } catch (err) {
        console.log('✗ Termine nicht abrufbar: ' + err.message);
        return Run.done('bookings', { ok: false, summary: 'Termine nicht abrufbar: ' + err.message.slice(0, 120) });
    }
    const local = Store.load('bookings');
    const list = Array.isArray(local) ? local : [];
    const notes = [];
    let done = 0;
    for (const b of rows) {
        try {
            const entry = { uid: b.uid, status: b.status, start: b.start_at, end: b.end_at, name: b.name, email: b.email, title: b.title, location: b.location, notes: b.notes, leadId: b.lead_id, at: b.updated_at };
            if (b.status === 'gebucht' || b.status === 'verschoben') {
                entry.conflicts = await conflicts(b);
                if (b.status === 'verschoben') {
                    // Entwürfe zum alten Termin (der auf diesen verweist) verwerfen
                    const old = await Cloud.query('SELECT uid FROM bookings WHERE replaced_by = ?', [b.uid]).catch(() => []);
                    old.forEach((o) => { discardFor(o.uid); list.filter((x) => x.uid === o.uid).forEach((x) => { x.status = 'ersetzt'; }); });
                }
                discardFor(b.uid, b.start_at); // gleiche Buchung, andere Zeit
                const key = 'termin:' + b.uid + ':' + b.start_at;
                const known = Outbox.all().some((e) => e.key === key); // doppelt zugestellter Webhook: kein zweiter Hinweis
                if (b.email) {
                    const d = Outbox.add({ key: 'termin:' + b.uid + ':' + b.start_at, type: 'termin', to: b.email, subject: b.status === 'verschoben' ? 'Neuer Termin bestätigt: ' + when(b.start_at) : 'Unser Termin am ' + when(b.start_at),
                        body: b.status === 'verschoben' ? movedText(b) : confirmText(b), ref: b.lead_id || b.email, contactAllowed: 'bestehend',
                        meta: { booking: b.uid, leadId: b.lead_id, start: b.start_at, client: b.name || b.email, akte: b.lead_id ? AKTE(b.lead_id) : null } });
                    entry.draft = d.id;
                }
                Events.record(b.status === 'verschoben' ? 'booking_moved' : 'booking_new', { name: b.name || b.email, label: when(b.start_at) + (entry.conflicts && entry.conflicts.length ? ' · Überschneidung!' : ''), kind: 'Termin' });
                if (!known) await Notify.send('Kasi: ' + (b.status === 'verschoben' ? 'Termin verschoben' : 'Neuer Termin'), (b.name || b.email) + ' · ' + when(b.start_at) + (entry.conflicts && entry.conflicts.length ? '\nÜberschneidung: ' + entry.conflicts[0] : '') + '\nBestätigung liegt im Postausgang.', { priority: 'high' }).catch(() => {});
                notes.push((b.status === 'verschoben' ? 'Verschoben: ' : 'Neu: ') + (b.name || b.email) + ', ' + when(b.start_at) + (entry.conflicts && entry.conflicts.length ? ' · Überschneidung mit ' + entry.conflicts.join(', ') : ''));
            } else if (b.status === 'abgesagt') {
                discardFor(b.uid);
                if (b.email) {
                    const d = Outbox.add({ key: 'termin-absage:' + b.uid, type: 'termin', to: b.email, subject: 'Neuer Termin?', body: cancelledText(b), ref: b.lead_id || b.email, contactAllowed: 'bestehend',
                        meta: { booking: b.uid, leadId: b.lead_id, start: b.start_at, client: b.name || b.email, cancelled: true } });
                    entry.draft = d.id;
                }
                Events.record('booking_cancelled', { name: b.name || b.email, label: 'Termin ' + when(b.start_at) + ' abgesagt', kind: 'Termin' });
                notes.push('Abgesagt: ' + (b.name || b.email) + ', ' + when(b.start_at));
            }
            const i = list.findIndex((x) => x.uid === b.uid);
            if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
            await Cloud.query('UPDATE bookings SET handled_at = ? WHERE uid = ?', [new Date().toISOString(), b.uid]);
            done++;
        } catch (err) {
            // Fallback: Eintrag bleibt unverarbeitet und wird beim nächsten Lauf erneut versucht
            console.log('✗ Termin ' + b.uid + ': ' + err.message);
            notes.push('Termin von ' + (b.name || b.email) + ' wird erneut versucht: ' + err.message.slice(0, 100));
        }
    }
    // Lokale Liste: kommende Termine und Absagen der letzten 7 Tage
    const keep = list.filter((x) => x.start && Date.parse(x.start) > Date.now() - 7 * 86400000 && x.status !== 'ersetzt').sort((a, b) => String(a.start).localeCompare(String(b.start)));
    Store.save('bookings', keep.slice(0, 100));
    const upcoming = keep.filter((x) => ['gebucht', 'verschoben'].includes(x.status) && Date.parse(x.start) > Date.now()).length;
    const summary = (done ? done + (done === 1 ? ' Termin-Änderung verarbeitet' : ' Termin-Änderungen verarbeitet') : 'Keine neuen Termine') + ' · ' + upcoming + ' kommend';
    console.log(summary);
    notes.forEach((n) => console.log('  · ' + n));
    Run.done('bookings', { summary, notes });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('bookings', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main, confirmText, conflicts };
