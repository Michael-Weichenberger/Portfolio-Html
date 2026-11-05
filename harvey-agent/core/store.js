/* =============================================================================
   KASI · Kundenverwaltung (Cloudflare D1)
   Tabellen: cloudflare/schema.sql. Genutzt vom Prüfdienst (neue Anfragen,
   öffentliche Teaser) und vom Dashboard (alles Weitere).

   Erweitern: Status, Bereiche und Projektschritte stehen unten als Listen.
   Neue Einträge dort ergänzen, das Dashboard übernimmt sie automatisch.
   ============================================================================= */
'use strict';

const VisRules = require('../../vis-rules.js');
const Offer = require('../../offer-rules.js');
const Drafts = require('./drafts.js');

// Reihenfolge = Reihenfolge im Dashboard (der Weg vom Erstkontakt zum Kunden)
const STATUSES = [
    { id: 'neu', label: 'Neu' },
    { id: 'in_arbeit', label: 'In Arbeit' },
    { id: 'gesendet', label: 'Angebot / Mail raus' },
    { id: 'termin', label: 'Termin' },
    { id: 'auftrag', label: 'Kunde' },
    { id: 'abgelegt', label: 'Abgelegt' }
];
const KINDS = [
    { id: 'anfrage', label: 'Website-Test', hint: 'Hat den Report angefordert und eingewilligt' },
    { id: 'paket', label: 'Paket-Anfragen', hint: 'Anfrageformular und Projekt-Planer: Kasi schlägt ein Angebot vor' },
    { id: 'akquise', label: 'Akquise', hint: 'Ohne Einwilligung: nur Brief, Besuch oder bestehender Kontakt' }
];
// Projekt-Checkliste für Kunden (Website-Projekt bis zur laufenden Betreuung)
const PROJECT_STEPS = [
    { id: 'vertrag', label: 'Angebot unterschrieben / Auftrag bestätigt' },
    { id: 'anzahlung', label: 'Anzahlung erhalten' },
    { id: 'kickoff', label: 'Kickoff: Ziele, Leistungen, Einsatzgebiet geklärt' },
    { id: 'inhalte', label: 'Texte, Logo und Bilder vom Kunden erhalten' },
    { id: 'domain', label: 'Domain, Hosting und E-Mail eingerichtet' },
    { id: 'entwurf', label: 'Entwurf abgestimmt' },
    { id: 'recht', label: 'Impressum und Datenschutz geprüft' },
    { id: 'live', label: 'Website live geschaltet' },
    { id: 'google', label: 'Google-Unternehmensprofil eingerichtet / verknüpft' },
    { id: 'messung', label: 'Abschlussmessung (Sichtbarkeits-Check) gespeichert' },
    { id: 'rechnung', label: 'Schlussrechnung gestellt' },
    { id: 'bewertung', label: 'Um Google-Bewertung gebeten' },
    { id: 'betreuung', label: 'Betreuungsvertrag aktiv' }
];
const OPEN_STATUSES = ['in_arbeit', 'gesendet', 'termin']; // zählen in die Pipeline
const STATUS_IDS = STATUSES.map((s) => s.id);
const KIND_IDS = KINDS.map((k) => k.id);
const STEP_IDS = PROJECT_STEPS.map((s) => s.id);
const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || { label: id }).label;

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

function makeId(name) {
    const b = new Uint8Array(4);
    globalThis.crypto.getRandomValues(b);
    const hash = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return String(name).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60) + '-' + hash;
}

/* Bewertung + Vorschlag aus einer Messung (psi/structure) für einen Eintrag. */
function evaluate(kind, target, id, measurement) {
    const psi = measurement && measurement.psi;
    const structure = measurement && measurement.structure;
    if (!psi && !structure) {
        // Ohne Messung trotzdem ein Vorschlag; „Neu messen“ im Dashboard ergänzt die Befunde.
        const d = draftFor(kind, { id, name: target.name, report: null, findings: [] });
        return { report: null, findings: [], subject: d.subject, body: d.body };
    }
    const measuredAt = now();
    const report = VisRules.buildReport({ id, url: target.url, name: target.name, measuredAt, psi, structure,
        source: psi && structure ? 'Google PageSpeed und Strukturanalyse' : psi ? 'Google PageSpeed Insights' : 'Strukturanalyse' });
    const findings = VisRules.findingsFrom({ psi, structure });
    const draft = draftFor(kind, { id, name: target.name, report, findings, psi });
    return { report, findings, measuredAt, subject: draft.subject, body: draft.body };
}

function draftFor(kind, d) {
    if (kind === 'paket') return Drafts.offerDraft({ name: d.name, topic: d.topic, phone: d.phone, message: d.message, selection: d.selection });
    if (kind === 'akquise') {
        const c = Drafts.buildCase({ id: d.id, name: d.name }, d.report || {}, d.findings || [], d.psi, VisRules.fmt);
        return { subject: c.subject, body: c.letter, priority: c.priority, callOpener: c.callOpener };
    }
    return Drafts.replyDraft({ name: d.name, report: d.report, findings: d.findings });
}

/* Wert eines Eintrags: von Hand eingetragen, sonst aus der Planer-Auswahl berechnet. */
function valueOf(r, selection) {
    const q = selection ? Offer.quote(selection) : null;
    return {
        once: r.value_once !== null && r.value_once !== undefined ? r.value_once : q ? q.once : null,
        month: r.value_month !== null && r.value_month !== undefined ? r.value_month : q ? q.month : null,
        estimated: (r.value_once === null || r.value_once === undefined) && !!q
    };
}

function parse(s, fallback) {
    try { return s ? JSON.parse(s) : fallback; } catch (err) { return fallback; }
}

function row(r, full) {
    if (!r) return null;
    const report = parse(r.report, null);
    const selection = parse(r.selection, null);
    const out = {
        id: r.id, kind: r.kind, status: r.status, name: r.name, url: r.url, email: r.email, topic: r.topic || '',
        createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, published: r.published === 1,
        followUp: r.follow_up || null, wonAt: r.won_at || null, startAt: r.start_at || null,
        value: valueOf(r, selection),
        met: report ? report.met : null, total: report ? report.total : null, ratio: report ? report.ratio : null,
        points: report ? report.points.map((p) => ({ key: p.key, status: p.status })) : []
    };
    const done = parse(r.checklist, []);
    out.progress = { done: done.filter((x) => STEP_IDS.includes(x)).length, total: STEP_IDS.length };
    if (full) Object.assign(out, {
        consentAt: r.consent_at, measuredAt: r.measured_at, report,
        findings: parse(r.findings, []), subject: r.subject || '', body: r.body || '', notes: r.notes || '',
        phone: r.phone || '', message: r.message || '', selection,
        valueOnce: r.value_once, valueMonth: r.value_month, checklist: done
    });
    return out;
}

async function log(db, leadId, type, text) {
    await db.prepare('INSERT INTO activities (lead_id, at, type, text) VALUES (?, ?, ?, ?)').bind(leadId, now(), type, String(text).slice(0, 300)).run();
}

async function activities(db, leadId) {
    const { results } = await db.prepare('SELECT at, type, text FROM activities WHERE lead_id = ? ORDER BY at DESC LIMIT 100').bind(leadId).all();
    return results;
}

const CREATED_TEXT = { anfrage: 'Report über den Website-Test angefordert', paket: 'Anfrage über das Formular eingegangen', akquise: 'Als Akquise-Kontakt angelegt und gemessen' };

async function insert(db, e) {
    const t = now();
    await db.prepare(`INSERT INTO leads (id, kind, status, created_at, updated_at, name, url, email, consent_at, report, findings, measured_at, subject, body, published, phone, topic, message, selection, source)
        VALUES (?, ?, 'neu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(e.id, e.kind, t, t, e.name, e.url || '', e.email || null, e.consentAt || null,
            e.report ? JSON.stringify(e.report) : null, JSON.stringify(e.findings || []), e.measuredAt || null,
            e.subject || null, e.body || null, e.published ? 1 : 0,
            e.phone || null, e.topic || null, e.message || null, e.selection ? JSON.stringify(e.selection) : null,
            e.source ? JSON.stringify(e.source) : null)
        .run();
    await log(db, e.id, 'created', CREATED_TEXT[e.kind] || 'Angelegt');
    return e.id;
}

/* Liste mit Filtern. view: 'due' (Wiedervorlage fällig), 'kunden' (Status Kunde) */
async function list(db, f) {
    const where = [];
    const args = [];
    if (f.kind && KIND_IDS.includes(f.kind)) { where.push('kind = ?'); args.push(f.kind); }
    if (f.status && STATUS_IDS.includes(f.status)) { where.push('status = ?'); args.push(f.status); }
    if (f.view === 'due') { where.push("follow_up IS NOT NULL AND follow_up <= ? AND status != 'abgelegt'"); args.push(today()); }
    if (f.view === 'kunden') where.push("status = 'auftrag'");
    if (f.q) { where.push('(name LIKE ? OR email LIKE ? OR url LIKE ? OR topic LIKE ?)'); const q = '%' + String(f.q).slice(0, 60) + '%'; args.push(q, q, q, q); }
    const order = f.view === 'due' ? 'follow_up ASC' : f.view === 'kunden' ? 'won_at DESC' : 'created_at DESC';
    const sql = 'SELECT * FROM leads' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ' + order + ' LIMIT 300';
    const { results } = await db.prepare(sql).bind(...args).all();
    return results.map((r) => row(r, false));
}

async function counts(db) {
    const { results } = await db.prepare('SELECT kind, status, COUNT(*) AS n FROM leads GROUP BY kind, status').all();
    const due = await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE follow_up IS NOT NULL AND follow_up <= ? AND status != 'abgelegt'").bind(today()).first();
    return { byKindStatus: results, due: due ? due.n : 0 };
}

/* Übersicht: Kennzahlen, fällige Wiedervorlagen, letzte Aktivitäten */
async function overview(db) {
    const { results } = await db.prepare("SELECT * FROM leads WHERE status != 'abgelegt' ORDER BY created_at DESC LIMIT 1000").all();
    const rows = results.map((r) => row(r, false));
    const monthStart = today().slice(0, 7);
    const sum = (list, k) => list.reduce((a, x) => a + (x.value[k] || 0), 0);
    const open = rows.filter((x) => OPEN_STATUSES.includes(x.status));
    const customers = rows.filter((x) => x.status === 'auftrag');
    const wonMonth = customers.filter((x) => (x.wonAt || '').slice(0, 7) === monthStart);
    const t = today();
    const due = rows.filter((x) => x.followUp && x.followUp <= t).sort((a, b) => a.followUp.localeCompare(b.followUp));
    const upcoming = rows.filter((x) => x.followUp && x.followUp > t).sort((a, b) => a.followUp.localeCompare(b.followUp)).slice(0, 6);
    const fresh = rows.filter((x) => x.status === 'neu');
    const { results: recent } = await db.prepare(`SELECT a.at, a.type, a.text, a.lead_id AS id, l.name, l.kind FROM activities a
        JOIN leads l ON l.id = a.lead_id ORDER BY a.at DESC LIMIT 14`).all();
    const funnel = STATUSES.map((s) => ({ id: s.id, label: s.label, n: rows.filter((x) => x.status === s.id).length }))
        .filter((s) => s.id !== 'abgelegt');
    return {
        today: t,
        kpis: {
            fresh: fresh.length,
            due: due.length,
            open: open.length,
            pipelineOnce: sum(open, 'once'),
            pipelineMonth: sum(open, 'month'),
            customers: customers.length,
            mrr: sum(customers, 'month'),
            wonMonthOnce: sum(wonMonth, 'once'),
            wonMonth: wonMonth.length
        },
        due: due.slice(0, 20),
        upcoming,
        fresh: fresh.slice(0, 8),
        projects: customers.filter((x) => x.progress.done < x.progress.total).slice(0, 8),
        funnel,
        recent
    };
}

async function get(db, id) {
    const lead = row(await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first(), true);
    if (lead) lead.activities = await activities(db, id);
    return lead;
}

const EDITABLE = { status: 'status', notes: 'notes', subject: 'subject', body: 'body', email: 'email', phone: 'phone',
    published: 'published', sentAt: 'sent_at', followUp: 'follow_up', valueOnce: 'value_once', valueMonth: 'value_month', startAt: 'start_at' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtDate = (d) => d.split('-').reverse().join('.');

async function update(db, id, patch, before) {
    const old = before || await get(db, id);
    if (!old) return null;
    const sets = [];
    const args = [];
    const logs = [];
    for (const [k, col] of Object.entries(EDITABLE)) {
        if (!(k in patch)) continue;
        let v = patch[k];
        if (k === 'status' && !STATUS_IDS.includes(v)) continue;
        if ((k === 'followUp' || k === 'startAt') && v !== null && !DATE_RE.test(String(v))) continue;
        if (k === 'valueOnce' || k === 'valueMonth') v = v === null || v === '' ? null : Math.max(0, Math.round(Number(v)) || 0);
        else if (k === 'published') v = v ? 1 : 0;
        else if (v !== null) v = String(v).slice(0, k === 'body' ? 20000 : k === 'notes' ? 8000 : 300);
        sets.push(col + ' = ?');
        args.push(v);
    }
    if (patch.status && patch.status !== old.status && STATUS_IDS.includes(patch.status)) {
        logs.push(['status', 'Status: ' + statusLabel(old.status) + ' → ' + statusLabel(patch.status)]);
        if (patch.status === 'auftrag' && !old.wonAt) {
            sets.push('won_at = ?');
            args.push(now());
            // Auftragswert aus dem Angebot übernehmen, wenn noch keiner eingetragen ist
            if (old.valueOnce === null && !('valueOnce' in patch) && old.value.once !== null) { sets.push('value_once = ?'); args.push(old.value.once); }
            if (old.valueMonth === null && !('valueMonth' in patch) && old.value.month !== null) { sets.push('value_month = ?'); args.push(old.value.month); }
        }
    }
    if (patch.sentAt && !old.sentAt) logs.push(['sent', 'Mail / Brief als gesendet markiert']);
    if ('followUp' in patch && patch.followUp !== old.followUp) {
        logs.push(['followup', patch.followUp && DATE_RE.test(patch.followUp) ? 'Wiedervorlage am ' + fmtDate(patch.followUp) : 'Wiedervorlage erledigt']);
    }
    if (Array.isArray(patch.checklist)) {
        const next = [...new Set(patch.checklist.filter((x) => STEP_IDS.includes(x)))];
        sets.push('checklist = ?');
        args.push(JSON.stringify(next));
        next.filter((x) => !old.checklist.includes(x)).forEach((x) => logs.push(['step', 'Erledigt: ' + PROJECT_STEPS.find((s) => s.id === x).label]));
    }
    if (patch.selection !== undefined) {
        sets.push('selection = ?');
        args.push(patch.selection ? JSON.stringify(patch.selection) : null);
        logs.push(['offer', patch.selection ? 'Angebot neu erstellt' : 'Antwort ohne Paket erstellt']);
    }
    if (patch.report !== undefined) {
        sets.push('report = ?', 'findings = ?', 'measured_at = ?');
        args.push(JSON.stringify(patch.report), JSON.stringify(patch.findings || []), patch.measuredAt || now());
        logs.push(['measure', 'Neu gemessen: ' + (patch.report && patch.report.total ? patch.report.met + ' von ' + patch.report.total + ' Signalen' : 'unvollständig')]);
    }
    if (patch.logDraft) logs.push(['draft', 'Vorschlag aus den Bausteinen neu erstellt']);
    if (!sets.length && !logs.length) return get(db, id);
    if (sets.length) {
        sets.push('updated_at = ?');
        args.push(now(), id);
        await db.prepare('UPDATE leads SET ' + sets.join(', ') + ' WHERE id = ?').bind(...args).run();
    }
    for (const [type, text] of logs) await log(db, id, type, text);
    return get(db, id);
}

async function remove(db, id) {
    await db.batch([
        db.prepare('DELETE FROM activities WHERE lead_id = ?').bind(id),
        db.prepare('DELETE FROM leads WHERE id = ?').bind(id)
    ]);
}

/* Öffentlicher Teaser für ?check=<id>, nur wenn im Dashboard freigegeben. */
async function publicReport(db, id) {
    const r = await db.prepare('SELECT report FROM leads WHERE id = ? AND published = 1').bind(id).first();
    return r && r.report ? JSON.parse(r.report) : null;
}

/* Terminbuchung (Cal.com-Webhook): Eintrag per E-Mail finden oder anlegen, Status „Termin“. */
async function saveBooking(db, ev, leadId) {
    if (!ev.uid) return;
    const t = now();
    const str = (v, n) => (v == null ? null : String(v).slice(0, n));
    const status = ev.cancelled ? 'abgesagt' : ev.trigger === 'BOOKING_RESCHEDULED' ? 'verschoben' : 'gebucht';
    const iso = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : null; };
    if (ev.cancelled) {
        // Absage: vorhandenen Termin freigeben (auch wenn Kasi ihn noch nicht kannte)
        await db.prepare("INSERT INTO bookings (uid, lead_id, status, start_at, end_at, title, name, email, location, notes, created_at, updated_at) VALUES (?, ?, 'abgesagt', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (uid) DO UPDATE SET status = 'abgesagt', updated_at = excluded.updated_at, handled_at = NULL")
            .bind(ev.uid, leadId, iso(ev.start), iso(ev.end), str(ev.title, 200), str(ev.name, 120), str(ev.email, 200), str(ev.location, 300), str(ev.notes, 1000), t, t).run();
        return;
    }
    const stmts = [db.prepare('INSERT INTO bookings (uid, lead_id, status, start_at, end_at, title, name, email, location, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (uid) DO UPDATE SET status = excluded.status, start_at = excluded.start_at, end_at = excluded.end_at, title = excluded.title, location = excluded.location, notes = excluded.notes, updated_at = excluded.updated_at, handled_at = NULL')
        .bind(ev.uid, leadId, status, iso(ev.start), iso(ev.end), str(ev.title, 200), str(ev.name, 120), str(ev.email, 200), str(ev.location, 300), str(ev.notes, 1000), t, t)];
    // Verschiebung: alten Termin in einem Schritt als ersetzt markieren
    if (ev.previousUid && ev.previousUid !== ev.uid) stmts.push(db.prepare("UPDATE bookings SET status = 'ersetzt', replaced_by = ?, updated_at = ? WHERE uid = ?").bind(ev.uid, t, ev.previousUid));
    await db.batch(stmts);
}

async function bookingEvent(db, ev) {
    const email = String(ev.email || '').trim().toLowerCase().slice(0, 200);
    if (!email) return null;
    const r = await db.prepare('SELECT id FROM leads WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1').bind(email).first();
    let id = r && r.id;
    const start = ev.start ? new Date(ev.start) : null;
    const when = start && !isNaN(start) ? start.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'unbekannt';
    if (ev.cancelled) {
        if (!id) { await saveBooking(db, ev, null); return null; }
        const lead = await get(db, id);
        await update(db, id, lead.status === 'termin' ? { status: 'in_arbeit' } : {}, lead);
        await log(db, id, 'booking', 'Termin abgesagt (' + when + ')');
        await saveBooking(db, ev, id);
        return id;
    }
    if (!id) {
        id = makeId(ev.name || email.split('@')[1] || 'termin');
        await insert(db, { id, kind: 'paket', name: String(ev.name || email).slice(0, 120), email, topic: 'Termin über den Buchungslink' + (ev.title ? ': ' + String(ev.title).slice(0, 200) : '') });
    }
    const lead = await get(db, id);
    const patch = {};
    if (lead.status !== 'auftrag') patch.status = 'termin';
    if (start && !isNaN(start)) patch.followUp = start.toISOString().slice(0, 10);
    await update(db, id, patch, lead);
    await log(db, id, 'booking', (ev.trigger === 'BOOKING_RESCHEDULED' ? 'Termin verschoben auf ' : 'Termin gebucht: ') + when + (ev.title ? ' · ' + String(ev.title).slice(0, 120) : ''));
    await saveBooking(db, ev, id);
    return id;
}

/* Export aller Einträge (Datensicherung, Auskunft nach Art. 15 DSGVO) */
async function exportAll(db) {
    const { results } = await db.prepare('SELECT * FROM leads ORDER BY created_at').all();
    const { results: acts } = await db.prepare('SELECT * FROM activities ORDER BY at').all();
    return { exportedAt: now(), leads: results, activities: acts };
}

module.exports = { STATUSES, KINDS, PROJECT_STEPS, makeId, evaluate, draftFor, insert, list, counts, overview, get, update, remove, publicReport, exportAll, log, bookingEvent };
