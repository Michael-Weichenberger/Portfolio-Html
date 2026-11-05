/* =============================================================================
   KASI · Multi-Kalender
   Liest angebundene Kalender über ihre geheime iCal-Adresse (Google, Outlook,
   iCloud …) und ergänzt Kasis eigene Termine: Leads mit Status „Termin“ und
   Fälligkeiten offener Rechnungen.

   Cal.com hat keinen eigenen Abo-Feed. Gebuchte Termine landen im verbundenen
   Google-Kalender und erscheinen darüber; der Webhook setzt den Lead im
   Web-Dashboard auf „Termin“.

   Die Adressen liegen in data/calendars.json (gitignored) und werden nie an den
   Browser zurückgegeben. Übernommen werden nur Titel, Ort und Zeit, keine
   Beschreibungen. Teilnehmer-Adressen dienen nur der Zuordnung zu Leads
   (Termin-Vorbereitung) und werden nicht an den Browser gegeben.
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const Store = require('./datastore.js');

const KINDS = { google: 'Google Kalender', calcom: 'Cal.com (über Kalender-Feed)', ics: 'iCal-Feed (Outlook, iCloud …)' };
const CACHE_MS = 10 * 60000;
const MAX_BYTES = 4 * 1024 * 1024;
const cache = new Map(); // id → { at, events, error }

/* Windows-Zeitzonen, wie Outlook sie in TZID schreibt */
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'UTC': 'UTC' };

/* ---------- Zeitrechnung ---------- */
function tzOffset(ms, tz) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/* Wandzeit (Jahr, Monat 0-basiert …) in einer Zeitzone → UTC-Millisekunden */
function wallToMs(w, tz) {
    if (tz === 'UTC') return Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s);
    if (!tz) return new Date(w.y, w.m, w.d, w.h, w.mi, w.s).getTime(); // „floating“: Zeit dieses Rechners
    const guess = Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s);
    let ms = guess - tzOffset(guess, tz);
    ms = guess - tzOffset(ms, tz);
    return ms;
}

function validTz(tz) {
    if (!tz) return null;
    tz = WIN_TZ[tz] || tz;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (err) { return null; }
}

function parseStamp(value, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
    if (!m) return null;
    const allDay = !m[4] || params.VALUE === 'DATE';
    const wall = { y: +m[1], m: +m[2] - 1, d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    const tz = allDay ? null : m[7] ? 'UTC' : validTz(params.TZID);
    return { wall, tz, allDay };
}

const addDays = (w, n) => { const d = new Date(Date.UTC(w.y, w.m, w.d + n)); return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; };
const addMonths = (w, n) => { const d = new Date(Date.UTC(w.y, w.m + n, 1)); return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() }; };
const weekday = (w) => new Date(Date.UTC(w.y, w.m, w.d)).getUTCDay();
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/* ---------- iCal lesen ---------- */
function parseIcs(text) {
    const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') { cur = { exdates: [], attendees: [] }; continue; }
        if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
        if (!cur) continue;
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const [name, ...rawParams] = line.slice(0, idx).split(';');
        const params = Object.fromEntries(rawParams.map((p) => { const [k, v] = p.split('='); return [k.toUpperCase(), (v || '').replace(/^"|"$/g, '')]; }));
        const value = line.slice(idx + 1);
        const key = name.toUpperCase();
        if (key === 'SUMMARY') cur.title = unescape(value);
        else if (key === 'LOCATION') cur.location = unescape(value);
        else if (key === 'UID') cur.uid = value;
        else if (key === 'STATUS') cur.status = value.toUpperCase();
        else if (key === 'DTSTART') cur.start = parseStamp(value, params);
        else if (key === 'DTEND') cur.end = parseStamp(value, params);
        else if (key === 'DURATION') cur.duration = durationMs(value);
        else if (key === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
        else if (key === 'EXDATE') value.split(',').forEach((v) => { const s = parseStamp(v, params); if (s) cur.exdates.push(stampMs(s)); });
        else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseStamp(value, params);
        else if (key === 'ATTENDEE') { const m = /mailto:([^;\s]+)/i.exec(value); if (m) cur.attendees.push(m[1].toLowerCase()); }
    }
    return events;
}

function unescape(v) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
function durationMs(v) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v);
    if (!m) return 0;
    return (((+(m[1] || 0) * 7 + +(m[2] || 0)) * 24 + +(m[3] || 0)) * 60 + +(m[4] || 0)) * 60000 + +(m[5] || 0) * 1000;
}
function stampMs(s) { return wallToMs(s.wall, s.tz); }

/* Termine eines Feeds im Zeitfenster [from, to) inkl. einfacher Wiederholungen */
function expand(events, from, to) {
    const overrides = new Set(events.filter((e) => e.recurrenceId && e.uid).map((e) => e.uid + '@' + stampMs(e.recurrenceId)));
    const out = [];
    for (const e of events) {
        if (!e.start || e.status === 'CANCELLED') continue;
        const startMs = stampMs(e.start);
        const length = (e.end ? Math.max(0, stampMs(e.end) - startMs) : e.duration) || (e.start.allDay ? 86400000 : 3600000);
        const push = (wall) => {
            const s = wallToMs(wall, e.start.tz);
            if (s + length <= from || s >= to) return;
            if (e.exdates.includes(s)) return;
            if (!e.recurrenceId && e.rrule && overrides.has(e.uid + '@' + s)) return;
            out.push({ title: e.title || '(ohne Titel)', location: e.location || '', start: new Date(s).toISOString(), end: new Date(s + length).toISOString(), allDay: e.start.allDay, attendees: e.attendees || [] });
        };
        const r = e.rrule;
        if (!r || e.recurrenceId) { push(e.start.wall); continue; }
        const freq = r.FREQ;
        const interval = Math.max(1, +r.INTERVAL || 1);
        const count = r.COUNT ? +r.COUNT : Infinity;
        const until = r.UNTIL ? stampMs(parseStamp(r.UNTIL, {}) || e.start) : Infinity;
        const byDay = r.BYDAY && freq === 'WEEKLY' ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : null;
        const periodDays = { DAILY: interval, WEEKLY: 7 * interval, MONTHLY: 28 * interval, YEARLY: 365 * interval }[freq];
        if (!periodDays) { push(e.start.wall); continue; }
        // alte Serien nicht ab dem ersten Termin durchzählen: kurz vor das Fenster springen
        const i0 = Math.max(0, Math.floor((from - startMs) / (periodDays * 86400000)) - 2);
        let n = i0 * (byDay ? byDay.length : 1);
        const s0 = e.start.wall;
        for (let i = i0; i < i0 + 1500 && n < count; i++) {
            let base;
            if (freq === 'DAILY') base = addDays(s0, interval * i);
            else if (freq === 'WEEKLY') base = addDays(s0, 7 * interval * i);
            else {
                base = { ...addMonths(s0, (freq === 'YEARLY' ? 12 : 1) * interval * i), d: s0.d };
                if (new Date(Date.UTC(base.y, base.m, base.d)).getUTCMonth() !== base.m) continue; // z. B. 31. im Februar
            }
            const candidates = byDay
                ? byDay.map((wd) => addDays(base, (wd - weekday(base) + 7) % 7)).sort((a, b) => wallToMs(a, null) - wallToMs(b, null))
                : [base];
            let stop = false;
            for (const c of candidates) {
                const ms = wallToMs(c, e.start.tz);
                if (ms < startMs) continue;
                if (ms > until || n >= count || ms >= to) { stop = true; break; }
                n++;
                push(c);
            }
            if (stop) break;
        }
    }
    return out;
}

/* ---------- Quellen ---------- */
function sources() {
    const list = Store.load('calendars');
    return Array.isArray(list) ? list : [];
}

function publicSource(s) {
    let host = '';
    try { host = new URL(s.url).host; } catch (err) { host = ''; }
    const c = cache.get(s.id);
    return { id: s.id, name: s.name, kind: s.kind, kindLabel: KINDS[s.kind] || s.kind, host, enabled: s.enabled !== false,
        checkedAt: c ? new Date(c.at).toISOString() : null, error: c ? c.error : null, count: c && !c.error ? c.events.length : null };
}

function add({ name, kind, url }) {
    url = String(url || '').trim();
    let u;
    try { u = new URL(url.replace(/^webcal:\/\//i, 'https://')); } catch (err) { throw new Error('Die Adresse ist keine gültige URL.'); }
    if (u.protocol !== 'https:') throw new Error('Nur https-Adressen (oder webcal://) sind erlaubt.');
    if (!KINDS[kind]) kind = 'ics';
    const list = sources();
    if (list.length >= 12) throw new Error('Höchstens 12 Kalender.');
    const s = { id: 'cal-' + crypto.randomBytes(4).toString('hex'), name: String(name || '').trim().slice(0, 60) || KINDS[kind], kind, url: u.toString(), enabled: true, addedAt: new Date().toISOString() };
    Store.save('calendars', [...list, s]);
    return publicSource(s);
}

function update(id, patch) {
    const list = sources();
    const s = list.find((x) => x.id === id);
    if (!s) throw new Error('Kalender nicht gefunden.');
    if (patch.remove) { Store.save('calendars', list.filter((x) => x.id !== id)); cache.delete(id); return null; }
    if (typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
    if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim().slice(0, 60);
    Store.save('calendars', list);
    return publicSource(s);
}

async function fetchSource(s, force) {
    const c = cache.get(s.id);
    if (!force && c && Date.now() - c.at < CACHE_MS) return c;
    const entry = { at: Date.now(), events: [], error: null };
    try {
        const res = await fetch(s.url, { headers: { 'User-Agent': 'MW-Kasi-Zentrale/1.0', Accept: 'text/calendar' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(res.status === 404 ? 'Adresse nicht gefunden (404). Geheime iCal-Adresse neu kopieren.' : 'Antwort ' + res.status);
        const text = await res.text();
        if (text.length > MAX_BYTES) throw new Error('Kalender ist zu groß.');
        if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Das ist kein iCal-Kalender.');
        entry.events = parseIcs(text);
    } catch (err) {
        entry.error = err.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.message;
        if (c && c.events.length) entry.events = c.events; // letzten Stand behalten
    }
    cache.set(s.id, entry);
    return entry;
}

/* Kasis eigene Termine aus den lokalen Daten */
function harveyEvents(from, to, invoices) {
    const out = [];
    for (const l of Store.load('leads')) {
        const at = l.meetingAt || l.followUp;
        if (l.status !== 'termin' || !at) continue;
        const s = Date.parse(at);
        if (s >= from && s < to) out.push({ title: 'Termin: ' + (l.name || l.domain), location: l.domain || '', start: new Date(s).toISOString(), end: new Date(s + 30 * 60000).toISOString(), allDay: !/T/.test(at), source: 'harvey', sourceName: 'Kasi · Leads', kind: 'harvey' });
    }
    for (const i of invoices || []) {
        if (i.status !== 'gestellt' || !i.dueDate) continue;
        const s = new Date(i.dueDate + 'T00:00:00').getTime();
        if (s >= from && s < to) out.push({ title: 'Fällig: ' + i.number + ' · ' + i.client, location: '', start: new Date(s).toISOString(), end: new Date(s + 86400000).toISOString(), allDay: true, source: 'harvey', sourceName: 'Kasi · Rechnungen', kind: 'harvey', amount: i.open });
    }
    return out;
}

/* Alle Termine von heute bis +days, sortiert */
let googleCache = { key: null, at: 0, events: [] };
async function agenda({ days = 14, force = false, invoices } = {}) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const to = from + days * 86400000;
    const list = sources();
    const results = await Promise.all(list.filter((s) => s.enabled !== false).map(async (s) => {
        const entry = await fetchSource(s, force);
        return expand(entry.events, from, to).map((e) => ({ ...e, source: s.id, sourceName: s.name, kind: s.kind }));
    }));
    // Google Kalender direkt (mit Teilnehmern), wenn Google mit Kalender-Berechtigung verbunden ist
    const Google = require('./google.js');
    let google = [];
    let googleSource = null;
    if (Google.has('calendar')) {
        const key = 'google:' + from + ':' + days;
        if (!force && googleCache.key === key && Date.now() - googleCache.at < 10 * 60000) google = googleCache.events;
        else {
            try {
                google = (await Google.calendarEvents(new Date(from).toISOString(), new Date(to).toISOString()))
                    .map((e) => ({ title: e.title, location: e.location, start: new Date(e.start).toISOString(), end: e.end ? new Date(e.end).toISOString() : null, allDay: e.allDay, attendees: e.attendees, source: 'google', sourceName: 'Google Kalender', kind: 'google' }));
                googleCache = { key, at: Date.now(), events: google };
            } catch (err) { googleSource = { error: err.message }; }
        }
        googleSource = { id: 'google', name: 'Google Kalender (info@mw-itservices.de)', kind: 'google', enabled: true, count: google.length, ...(googleSource || {}) };
    }
    const events = [...results.flat(), ...google, ...harveyEvents(from, to, invoices)].sort((a, b) => a.start.localeCompare(b.start));
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), events: events.slice(0, 300), sources: [...(googleSource ? [googleSource] : []), ...list.map(publicSource)] };
}

function forBrowser(agenda) {
    return { ...agenda, events: agenda.events.map(({ attendees, ...e }) => e) };
}

module.exports = { KINDS, parseIcs, expand, sources, add, update, agenda, forBrowser, publicSource };
