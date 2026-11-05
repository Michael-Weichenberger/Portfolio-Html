#!/usr/bin/env node
/* =============================================================================
   KASI ZENTRALE · lokales Master-Dashboard (nur auf diesem Rechner)

   npm run dashboard   →  http://127.0.0.1:5590

   Zeigt Scout-Vorschläge, Akquise-Liste, Kunden, offene Rechnungen mit
   Mahnstufen, den Postausgang und das Ereignisprotokoll. Freigeben & Senden
   per Klick, jeder Versand mit Bestätigung im Browser.

   Sicherheit: lauscht nur auf 127.0.0.1, prüft Host und Origin jeder Anfrage
   (Schutz gegen fremde Webseiten und DNS-Rebinding). Externe Skripte nur
   Three.js (cdnjs) und Tailwind (jsDelivr), versionsgenau und mit Prüfsumme
   (Subresource Integrity). Daten verlassen den Rechner nicht (connect-src 'self').
   ============================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
require('../harvey-worker.js'); // lädt .env
const Store = require('../core/datastore.js');
const B = require('../core/billing.js');
const Outbox = require('../core/outbox.js');
const Mailer = require('../core/mailer.js');
const After = require('../core/after-send.js');
const Events = require('../core/events.js');
const Calendar = require('../core/calendar.js');
const Projects = require('../core/projects.js');
const Activity = require('../core/activity.js');
const Dispatch = require('../core/dispatch.js');
const Run = require('../core/runlog.js');

const PORT = Number(process.env.HARVEY_DASHBOARD_PORT) || 5590;
const HOSTS = ['127.0.0.1:' + PORT, 'localhost:' + PORT];
const PUBLIC = path.join(__dirname, 'public');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const SEC = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    // Tailwind erzeugt seine Klassen im Browser als <style>-Block, daher 'unsafe-inline' nur für Styles
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()'
};

function send(res, status, body, type) {
    res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', ...SEC });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let d = '';
        req.on('data', (c) => { d += c; if (d.length > 200000) { reject(new Error('zu groß')); req.destroy(); } });
        req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (err) { reject(new Error('ungültiges JSON')); } });
    });
}

function latestScout() {
    const latest = path.join(ROOT, 'out', 'scout', 'latest.json');
    if (!fs.existsSync(latest)) return null;
    try {
        const file = path.join(ROOT, 'out', JSON.parse(fs.readFileSync(latest, 'utf8')).file);
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) { return null; }
}

/* ---------- Firmendaten (Stammdaten) ---------- */
// Pfad in company.json → Beschriftung; nur diese Felder sind im Dashboard änderbar
const COMPANY_FIELDS = [
    ['name', 'Firmenname', 'text'], ['owner', 'Inhaber', 'text'],
    ['street', 'Straße und Nr.', 'text'], ['zip', 'PLZ', 'text'], ['city', 'Ort', 'text'],
    ['email', 'E-Mail', 'email'], ['phone', 'Telefon', 'tel'], ['web', 'Website', 'text'],
    ['taxNumber', 'Steuernummer', 'text'], ['vatId', 'USt-IdNr.', 'text'],
    ['bank.holder', 'Kontoinhaber', 'text'], ['bank.iban', 'IBAN', 'text'], ['bank.bic', 'BIC', 'text'], ['bank.bankName', 'Bank', 'text'],
    ['invoice.paymentTermDays', 'Zahlungsziel (Tage)', 'number'], ['invoice.smallBusiness', 'Kleinunternehmer (§ 19 UStG)', 'checkbox'],
    ['dunning.baseRate.percent', 'Basiszinssatz (%)', 'number'], ['dunning.baseRate.validFrom', 'Basiszins gültig ab', 'date'],
    ['briefing.name', 'Anrede im Briefing', 'text'], ['scout.basePrice', 'Akquise-Basispreis (€ netto)', 'number']
];
const DEFAULTS = { 'briefing.name': 'Michael', 'scout.basePrice': 1190 };
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };
const isPlaceholder = (v) => v === undefined || v === null || v === '' || /BITTE EINTRAGEN/.test(String(v));

function companyFields(company) {
    return COMPANY_FIELDS.map(([p, label, type]) => {
        const v = getPath(company, p);
        if (isPlaceholder(v) && p in DEFAULTS) return { path: p, label, type, value: DEFAULTS[p] };
        return { path: p, label, type, value: isPlaceholder(v) && type !== 'checkbox' ? '' : v };
    });
}

function setupChecks(company, smtpMissing) {
    const need = [];
    if (isPlaceholder(company.street) || isPlaceholder(company.city)) need.push('Anschrift');
    if (isPlaceholder(company.taxNumber) && isPlaceholder(company.vatId)) need.push('Steuernummer oder USt-IdNr.');
    if (!company.bank || isPlaceholder(company.bank.iban)) need.push('IBAN');
    const baseAge = company.dunning ? B.days(company.dunning.baseRate.validFrom, B.iso(Date.now())) : 0;
    return [
        { id: 'company', ok: !need.length, title: 'Firmendaten', text: need.length ? 'Es fehlen: ' + need.join(', ') + '. Ohne diese Angaben lassen sich Rechnungen und Mahnungen nicht freigeben.' : 'Vollständig.', action: 'stammdaten' },
        { id: 'smtp', ok: !smtpMissing.length, title: 'Mailversand', text: smtpMissing.length ? smtpMissing.join(', ') + ' in harvey-agent/.env eintragen (Google-App-Passwort), dann das Dashboard neu starten.' : 'Bereit, gesendet wird über Ihr Postfach.', action: null },
        { id: 'baserate', ok: baseAge <= 183, title: 'Basiszinssatz', text: baseAge > 183 ? 'Stand ' + B.de(company.dunning.baseRate.validFrom) + '. Aktuellen Wert bei der Bundesbank prüfen und eintragen.' : 'Aktuell.', action: 'stammdaten', link: company.dunning && company.dunning.baseRate.source }
    ];
}

function saveCompany(body) {
    const company = Store.load('company');
    for (const [p, , type] of COMPANY_FIELDS) {
        if (!(p in body)) continue;
        let v = body[p];
        if (type === 'number') { v = Number(String(v).replace(',', '.')); if (!isFinite(v) || v < 0) throw new Error('Ungültige Zahl bei ' + p); }
        else if (type === 'checkbox') v = v === true;
        else if (type === 'date') { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Ungültiges Datum'); }
        else v = String(v).trim().slice(0, 200);
        if (p === 'bank.iban' && v) {
            v = v.replace(/\s+/g, '').toUpperCase();
            if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) throw new Error('Die IBAN sieht nicht gültig aus.');
        }
        setPath(company, p, v);
    }
    Store.save('company', company);
    return companyFields(company);
}

function state() {
    Store.ensure();
    const company = Store.load('company');
    const clients = Store.load('clients');
    const invoices = Store.load('invoices');
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    const today = B.iso(Date.now());
    const assessed = invoices.filter((i) => i.status !== 'storniert').map((i) => {
        const a = i.status === 'gestellt' ? B.assess(i, today, company) : { totals: B.totals(i, company), stage: 0, proposed: null, overdueDays: 0, reason: i.status };
        return { number: i.number || i.draftId, status: i.status, client: (byId[i.clientId] || {}).company || i.clientId, date: i.date, dueDate: i.dueDate,
            gross: a.totals.gross, open: a.totals.open, overdueDays: a.overdueDays, stage: a.stage, proposed: a.proposed, reason: a.reason,
            interest: a.interest || 0, paused: i.dunningPaused || null, paidAt: i.paidAt || null };
    });
    const mrr = clients.filter((c) => c.package && c.package.care && c.package.care !== 'none' && !c.careUntil)
        .reduce((s, c) => s + (c.careRate ? c.careRate.net : (require('../../offer-rules.js').PRICES.care[c.package.care] || { month: 0 }).month), 0);
    const { missing } = Mailer.config();
    return {
        company: { name: company.name, owner: company.owner, placeholders: /BITTE EINTRAGEN/.test(JSON.stringify(company)),
            briefingName: (company.briefing && company.briefing.name) || DEFAULTS['briefing.name'],
            basePrice: (company.scout && Number(company.scout.basePrice)) || DEFAULTS['scout.basePrice'] },
        settings: companyFields(company),
        setup: setupChecks(company, missing),
        smtp: { ready: !missing.length, missing },
        today,
        kpis: {
            openAmount: assessed.filter((a) => a.status === 'gestellt').reduce((s, a) => s + a.open, 0),
            overdue: assessed.filter((a) => a.status === 'gestellt' && a.overdueDays > 0).length,
            proposals: assessed.filter((a) => a.proposed).length,
            outbox: Outbox.all().filter((e) => ['entwurf', 'freigegeben'].includes(e.status)).length,
            clients: clients.length, mrr
        },
        invoices: assessed,
        clients: clients.map((c) => ({ id: c.id, company: c.company, email: c.email, domains: c.domains, package: c.package, careSince: c.careSince })),
        leads: Store.load('leads'),
        scout: latestScout(),
        outbox: Outbox.all().filter((e) => e.status !== 'verworfen').slice(-200).reverse()
            .map((e) => ({ ...e, blocker: e.status === 'gesendet' ? null : Outbox.blocker(e), sendMissing: e.status === 'gesendet' ? [] : Dispatch.missing(e) })),
        events: Events.recent(40),
        marketing: marketingState(),
        tickets: require('../core/support.js').all().filter((t) => t.status !== 'erledigt' || Date.now() - Date.parse(t.doneAt || t.createdAt) < 7 * 86400000).slice(0, 60),
        agents: agentState()
    };
}

/* Marketing: Marke, Kampagnen, Auswertung (data/marketing.json + letzter Lauf) */
function marketingState() {
    let m = Store.load('marketing');
    if (!m || !m.brand) { m = require('../marketing-agent.js').defaults(); Store.save('marketing', m); }
    const run = (require('../core/runlog.js').all().marketing) || {};
    const clients = Store.load('clients').map((c) => ({ id: c.id, company: c.company, careSince: c.careSince || null, reviewAskedAt: c.reviewAskedAt || null, reference: c.reference === true }));
    return { ...m, run: { lastRun: run.lastRun || null, summary: run.summary || '', ...(run.data || {}) }, clients };
}
const BRAND_FIELDS = ['positioning', 'promise', 'audience', 'proof', 'tone', 'colors'];

/* Stand und Einrichtung aller Agenten (ohne geheime Werte) */
const AGENTS = [
    ['inbox', 'Posteingang', 'Antworten einordnen und vorschreiben', 'inbox'],
    ['followup', 'Nachfass', 'Angebote ohne Antwort nachfassen', 'followup'],
    ['appointments', 'Termin-Vorbereitung', 'Gesprächsvorlagen für die nächsten Termine', 'termine'],
    ['alert', 'Heiße Leads', 'Neue Anfragen bewerten, Hinweis aufs Handy', 'alert'],
    ['watch', 'Website-Wächter', 'Kunden-Websites täglich prüfen', 'watch'],
    ['watch-report', 'Betreuungsbericht', 'Monatsbericht an Betreuungskunden', 'report'],
    ['watch-roi', 'Quartals-ROI', 'Wert der Website je Quartal', 'roi'],
    ['geo', 'KI-Sichtbarkeit', 'Werden Ihre Kunden von KI-Assistenten genannt?', 'geo'],
    ['reviews', 'Bewertungen', 'Google-Bewertungen beantworten', 'reviews'],
    ['video', 'Video-Pitch', 'Website-Check als Video für den Erstkontakt', null],
    ['onboarding', 'Onboarding', 'Neue Kunden: Ordner, Checkliste, Willkommensmail', 'onboarding'],
    ['accounting', 'Buchhaltung', 'DATEV-Export, Übergabe an Lexware Office', 'buchhaltung'],
    ['content', 'Beiträge', 'Jede Woche Google-Profil und LinkedIn', 'beitraege'],
    ['marketing', 'Marketing', 'Anfragen je Kampagne und Seite, Bewertungs-Erinnerungen', 'marketing']
];
function agentState() {
    const AI = require('../core/ai.js');
    const Google = require('../core/google.js');
    const Bank = require('../core/bank.js');
    const Notify = require('../core/notify.js');
    const runs = Run.all();
    const pick = (id) => { const r = runs[id] || {}; return { lastRun: r.lastRun || null, ok: r.ok !== false, summary: r.summary || '', notes: r.notes || [] }; };
    const imap = !!((process.env.IMAP_USER || process.env.SMTP_USER) && (process.env.IMAP_PASS || process.env.SMTP_PASS));
    return {
        list: AGENTS.map(([id, name, task, job]) => ({ id, name, task, job, ...pick(id) })),
        hot: ((runs.alert || {}).data || {}).hot || [],
        preps: ((runs.appointments || {}).data || {}).preps || [],
        videos: ((runs.video || {}).data || {}).videos || [],
        accounting: { ...((runs.accounting || {}).data || {}), lexware: !!process.env.LEXWARE_API_KEY },
        content: (runs.content || {}).data || null,
        setup: [
            { id: 'ai', ok: AI.available(), optional: true, title: 'KI (Claude, optional)', text: AI.available() ? 'Bereit · Entwürfe mit ' + AI.MODEL() + ', Einordnung mit ' + AI.MODEL_FAST() : 'Später. Bis dahin schreiben die Agenten mit Vorlagen und Regeln.' },
            { id: 'imap', ok: imap, title: 'Postfach', text: imap ? 'Bereit' : 'IMAP_USER/IMAP_PASS (oder SMTP_USER/SMTP_PASS) in .env.' },
            { id: 'notify', ok: Notify.channels().length > 0, title: 'Handy-Hinweise', text: Notify.channels().length ? 'Über ' + Notify.channels().join(' und ') : 'WHATSAPP_PHONE + CALLMEBOT_APIKEY oder NTFY_TOPIC in .env.' },
            { id: 'google', ok: Google.connected(), title: 'Google', text: Google.connected() ? 'Verbunden (Unternehmensprofile, Search Console)' : Google.configured() ? 'Bereit zum Verbinden' : 'GOOGLE_CLIENT_ID/SECRET in .env (README).', action: Google.configured() && !Google.connected() ? 'google' : null },
            { id: 'lexware', ok: !!process.env.LEXWARE_API_KEY, optional: true, title: 'Lexware Office (optional)', text: process.env.LEXWARE_API_KEY ? 'Bereit · Übertragung nur auf Klick' : 'LEXWARE_API_KEY in .env. Ohne: DATEV-Export für den Steuerberater.' },
            { id: 'bank', ok: Bank.connected(), title: 'Bank', text: Bank.connected() ? 'Verbunden · ' + (Bank.status().bank || '') : Bank.configured() ? 'Bereit zum Verbinden' : 'Enable Banking einrichten (README).', action: Bank.configured() && !Bank.connected() ? 'bank' : null }
        ]
    };
}

const Live = { last: null, daily: null }; // Stand der Läufe für die Zentrale
const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); };
/* Morgenlauf: höchstens einmal am Tag, nie doppelt */
function morning(force) {
    const Run = require('../core/runlog.js');
    if (Live.daily && !Live.daily.done) return 'running';
    const last = (Run.all().daily || {}).lastRun;
    if (!force && last && dayKey(last) === dayKey(Date.now())) return 'done';
    runScript('daily.js', [], 'daily').then(() => { Activity.log('good', 'Morgenlauf fertig, Briefing bereit'); });
    return 'started';
}
function runScript(file, extra, slot) {
    const label = file.replace(/-agent\.js$|\.js$/, '') + (extra && extra.length ? ' ' + extra.join(' ') : '');
    Activity.log('run', '▶ ' + label);
    const live = { label, startedAt: Date.now(), output: '', done: false };
    if (slot === 'daily') Live.daily = live;
    else if (!slot) Live.last = live;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, file), ...(extra || [])], { cwd: ROOT, env: process.env, windowsHide: true });
        const add = (chunk) => { live.output = (live.output + chunk.toString()).slice(-20000); };
        child.stdout.on('data', add);
        child.stderr.on('data', add);
        const timer = setTimeout(() => { add('\n✗ Abgebrochen nach 15 Minuten.'); child.kill(); }, 15 * 60000);
        child.on('error', (err) => add('\n✗ ' + err.message));
        child.on('close', (code) => {
            clearTimeout(timer);
            const output = live.output.trim();
            const lastLine = output.split('\n').filter((l) => l.trim()).pop() || '';
            const ok = code === 0;
            live.done = true;
            Activity.log(ok ? 'good' : 'bad', (ok ? '✓ ' : '✗ ') + label + (lastLine ? ' · ' + lastLine.trim().slice(0, 120) : ''));
            resolve({ ok, output: output.slice(-8000) });
        });
    });
}

/* Nur Domains wie huber-maler.de, keine Pfade oder Optionen (wird als Argument an pipeline-agent übergeben) */
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const CONTACTS = ['brief', 'persoenlich', 'bestehend', 'einwilligung'];

async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // nach /api
    if (req.method === 'GET' && parts[0] === 'state') return send(res, 200, state());
    if (req.method === 'POST' && parts[0] === 'morning') return send(res, 200, { status: morning(false) });
    if (req.method === 'GET' && parts[0] === 'run-live') {
        const l = url.searchParams.get('slot') === 'daily' ? Live.daily : Live.last;
        return send(res, 200, l ? { label: l.label, seconds: Math.round((Date.now() - l.startedAt) / 1000), output: l.output.slice(-6000), done: l.done } : {});
    }
    if (req.method === 'GET' && parts[0] === 'calendar') {
        const agenda = await Calendar.agenda({ days: 14, force: url.searchParams.get('refresh') === '1', invoices: state().invoices });
        const bad = agenda.sources.filter((s) => s.error);
        Activity.log(bad.length ? 'warn' : 'info', 'Kalender · ' + agenda.events.length + ' Termine aus ' + (agenda.sources.length + 1) + ' Quellen' + (bad.length ? ' · ' + bad.length + ' nicht erreichbar' : ''));
        const booking = require('../core/drafts.js').BOOKING_URL || '';
        return send(res, 200, { ...Calendar.forBrowser(agenda), kinds: Calendar.KINDS, booking, calcomWebhook: !!process.env.CAL_WEBHOOK_SECRET });
    }
    if (req.method === 'GET' && parts[0] === 'projects') {
        const st = await Projects.status(url.searchParams.get('refresh') === '1');
        const down = st.sites.filter((s) => !s.ok).length;
        Activity.log(down ? 'warn' : 'info', 'Monitor · ' + st.sites.length + ' Dienste geprüft' + (down ? ' · ' + down + ' gestört' : ', alle erreichbar'));
        return send(res, 200, st);
    }
    if (req.method === 'GET' && parts[0] === 'activity') return send(res, 200, Activity.since(url.searchParams.get('since')));
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const body = await readBody(req);

    if (parts[0] === 'outbox' && parts[1]) {
        const id = parts[1];
        const action = parts[2];
        if (action === 'edit') return send(res, 200, Outbox.edit(id, body));
        if (action === 'check') {
            // Live-Prüfung des Textes im Browser, ohne zu speichern
            const e = Outbox.all().find((x) => x.id === id);
            if (!e) return send(res, 404, { error: 'nicht gefunden' });
            return send(res, 200, { blocker: Outbox.blocker({ ...e, ...['to', 'subject', 'body'].reduce((o, k) => (typeof body[k] === 'string' ? { ...o, [k]: body[k] } : o), {}) }) });
        }
        if (action === 'discard') return send(res, 200, Outbox.discard(id));
        if (action === 'approve') return send(res, 200, Outbox.approve(id, 'Dashboard'));
        if (action === 'send') {
            // Freigeben & Senden: Text aus dem Browser übernehmen, freigeben, senden
            if (body.subject || body.body || body.to) Outbox.edit(id, body);
            let e = Outbox.all().find((x) => x.id === id);
            if (!e) return send(res, 404, { error: 'nicht gefunden' });
            if (body.confirm !== true) return send(res, 400, { error: 'Versand nicht bestätigt.' });
            if (e.status === 'entwurf') e = Outbox.approve(id, 'Dashboard');
            if (e.status !== 'freigegeben') return send(res, 400, { error: 'Status ' + e.status });
            try {
                Activity.log('run', '▶ Versand nach Bestätigung · ' + (e.type === 'bewertung' ? 'Google-Bewertung ' + (e.meta.location || '') : e.to));
                const info = await Dispatch.send(e); // Mail per SMTP oder Antwort auf Google-Bewertung
                Outbox.markSent(id, info);
                await After.afterSend(e);
                Activity.log('good', '✓ Gesendet · ' + e.subject.slice(0, 80));
                return send(res, 200, { ok: true });
            } catch (err) {
                Activity.log('bad', '✗ Versand fehlgeschlagen · ' + err.message);
                Outbox.markFailed(id, err.message);
                return send(res, 502, { error: err.message });
            }
        }
    }
    if (parts[0] === 'marketing') {
        const m = marketingState();
        delete m.run; delete m.clients;
        if (parts[1] === 'brand') {
            for (const k of BRAND_FIELDS) if (typeof body[k] === 'string') m.brand[k] = body[k].slice(0, 1200);
            if (Array.isArray(body.claims)) m.brand.claims = body.claims.map((x) => String(x).slice(0, 160)).filter(Boolean).slice(0, 8);
            Store.save('marketing', m);
            return send(res, 200, { ok: true });
        }
        if (parts[1] === 'campaign' && parts[2]) {
            const c = m.campaigns.find((x) => x.id === parts[2]);
            if (!c) return send(res, 404, { error: 'Kampagne nicht gefunden' });
            if (['entwurf', 'aktiv', 'pausiert', 'beendet'].includes(body.status)) c.status = body.status;
            if (body.spend !== undefined) { const v = Number(body.spend); if (!(v >= 0 && v < 1e6)) return send(res, 400, { error: 'Ausgaben ungültig' }); c.spend = Math.round(v * 100) / 100; }
            if (body.budgetDay !== undefined) { const v = Number(body.budgetDay); if (!(v >= 0 && v < 1e5)) return send(res, 400, { error: 'Budget ungültig' }); c.budgetDay = v; }
            Store.save('marketing', m);
            return send(res, 200, c);
        }
        if (parts[1] === 'client' && parts[2]) {
            const clients = Store.load('clients');
            const c = clients.find((x) => x.id === parts[2]);
            if (!c) return send(res, 404, { error: 'Kunde nicht gefunden' });
            if (body.asked === true) c.reviewAskedAt = new Date().toISOString().slice(0, 10);
            if (typeof body.reference === 'boolean') c.reference = body.reference;
            Store.save('clients', clients);
            return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'unbekannt' });
    }
    if (parts[0] === 'accounting' && parts[1] === 'push') {
        // Übergabe an Lexware Office: nur mit ausdrücklicher Bestätigung aus der Zentrale
        if (body.confirm !== true) return send(res, 400, { error: 'Übertragung nicht bestätigt.' });
        const nr = String(body.number || '');
        if (nr && !/^[A-Z0-9][A-Z0-9-]{2,30}$/i.test(nr)) return send(res, 400, { error: 'Ungültige Rechnungsnummer' });
        return send(res, 200, await runScript('accounting-agent.js', nr ? ['--push', nr] : ['--push-all']));
    }
    if (parts[0] === 'ticket' && parts[1]) {
        try { return send(res, 200, require('../core/support.js').setStatus(parts[1], String(body.status || ''))); }
        catch (err) { return send(res, 400, { error: err.message }); }
    }
    if (parts[0] === 'company') return send(res, 200, { settings: saveCompany(body) });
    if (parts[0] === 'calendar' && parts[1] === 'add') return send(res, 200, { source: Calendar.add(body) });
    if (parts[0] === 'calendar' && parts[1]) return send(res, 200, { source: Calendar.update(parts[1], body) });
    if (parts[0] === 'scout' && parts[1] === 'accept') return send(res, 200, await runScript('scout-agent.js', ['--accept', String(body.domain || ''), '--contact', String(body.contact || 'brief')]));
    if (parts[0] === 'run') {
        const jobs = { billing: ['billing-agent.js', []], monitor: ['monitor-agent.js', []], pipeline: ['pipeline-agent.js', ['--limit', '5']], scout: ['scout-agent.js', ['--limit', '8']], monthly: ['billing-agent.js', ['--monthly']],
            followup: ['followup-agent.js', []], termine: ['appointment-agent.js', ['--days', '3']], watch: ['watch-agent.js', ['--links']], report: ['watch-agent.js', ['--report']], roi: ['watch-agent.js', ['--quarter']],
            inbox: ['inbox-agent.js', []], alert: ['alert-agent.js', []], geo: ['geo-agent.js', []], reviews: ['reviews-agent.js', []], daily: ['daily.js', []],
            onboarding: ['onboarding-agent.js', []], buchhaltung: ['accounting-agent.js', []], beitraege: ['content-agent.js', ['--force']],
            marketing: ['marketing-agent.js', []], anzeigenbilder: ['marketing-agent.js', ['--creatives']] };
        const job = jobs[parts[1]];
        if (!job) return send(res, 404, { error: 'unbekannt' });
        if (parts[1] === 'daily') {
            if (Live.daily && !Live.daily.done) return send(res, 200, { ok: false, output: 'Der Morgenlauf läuft gerade schon. Den Stand sehen Sie in der Zentrale bei der Kugel.' });
        }
        return send(res, 200, await runScript(job[0], job[1]));
    }
    if (parts[0] === 'video') {
        const domain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
        if (!DOMAIN.test(domain)) return send(res, 400, { error: 'Bitte eine Domain wie huber-maler.de eingeben.' });
        return send(res, 200, await runScript('video-agent.js', ['--domain', domain]));
    }
    if (parts[0] === 'google' && parts[1] === 'connect') return send(res, 200, { url: require('../core/google.js').authUrl() });
    if (parts[0] === 'bank' && parts[1] === 'connect') {
        const bank = String(body.bank || '').trim().slice(0, 120);
        if (!bank) return send(res, 400, { error: 'Bitte den Namen Ihrer Bank angeben.' });
        return send(res, 200, { url: await require('../core/bank.js').connect(bank) });
    }
    if (parts[0] === 'bank' && parts[1] === 'code') {
        const acc = await require('../core/bank.js').finish(String(body.code || ''));
        Activity.log('good', '✓ Bank verbunden · ' + acc.length + ' Konto/Konten');
        return send(res, 200, { accounts: acc.length });
    }
    if (parts[0] === 'lead' && parts[1] === 'add') {
        const domain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
        if (!DOMAIN.test(domain)) return send(res, 400, { error: 'Bitte eine Domain wie huber-maler.de eingeben.' });
        const contact = CONTACTS.includes(body.contact) ? body.contact : 'brief';
        const args = ['--add', domain, '--contact', contact];
        const name = String(body.name || '').trim().slice(0, 80);
        const city = String(body.city || '').trim().slice(0, 60);
        if (name && !name.startsWith('-')) args.push('--name', name);
        if (city && !city.startsWith('-')) args.push('--city', city);
        return send(res, 200, await runScript('pipeline-agent.js', args));
    }
    if (parts[0] === 'invoice' && parts[1] === 'draft') {
        const id = String(body.clientId || '');
        if (!Store.load('clients').some((c) => c.id === id)) return send(res, 400, { error: 'Kunde nicht gefunden.' });
        return send(res, 200, await runScript('billing-agent.js', ['--draft', id]));
    }
    if (parts[0] === 'invoice' && parts[1] && parts[2] === 'paid') return send(res, 200, await runScript('billing-agent.js', ['--paid', parts[1]]));
    if (parts[0] === 'invoice' && parts[1] && parts[2] === 'resume') return send(res, 200, await runScript('billing-agent.js', ['--resume', parts[1]]));
    return send(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
    // Nur direkte Aufrufe von diesem Rechner
    if (!HOSTS.includes(req.headers.host || '')) return send(res, 421, 'Falscher Host', 'text/plain; charset=utf-8');
    const origin = req.headers.origin;
    if (req.method !== 'GET' && (!origin || !HOSTS.map((h) => 'http://' + h).includes(origin))) return send(res, 403, { error: 'origin' });
    if (req.method !== 'GET' && req.headers['x-harvey'] !== '1') return send(res, 403, { error: 'header' });
    const url = new URL(req.url, 'http://' + req.headers.host);
    try {
        if (url.pathname.startsWith('/api/')) return await api(req, res, url);
        if (url.pathname === '/oauth/google') {
            // Rückkehr von der Google-Anmeldung (nur mit gültigem state)
            let msg = 'Google ist verbunden. Dieses Fenster kann geschlossen werden.';
            try { await require('../core/google.js').exchange(url.searchParams.get('code') || '', url.searchParams.get('state') || ''); Activity.log('good', '✓ Google verbunden'); }
            catch (err) { msg = 'Google-Verbindung fehlgeschlagen: ' + err.message; }
            return send(res, 200, '<!doctype html><meta charset=utf-8><title>Kasi</title><body style="font:16px system-ui;background:#16110E;color:#F4F0E8;padding:40px"><p>' + msg.replace(/[<>&]/g, '') + '</p><p><a style="color:#DF9A67" href="/#agenten">Zur Zentrale</a></p>', 'text/html; charset=utf-8');
        }
        const ad = url.pathname.match(/^\/out\/marketing\/([a-z0-9-]{2,40})\/([a-z0-9-]{2,40}-(?:feed|story))\.png$/);
        if (ad) {
            const p = path.join(ROOT, 'out', 'marketing', ad[1], ad[2] + '.png');
            return fs.existsSync(p) ? send(res, 200, fs.readFileSync(p), 'image/png') : send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
        }
        const img = url.pathname.match(/^\/out\/beitraege\/(\d{4}-W\d{2})\/bild\.png$/);
        if (img) {
            const p = path.join(ROOT, 'out', 'beitraege', img[1], 'bild.png');
            return fs.existsSync(p) ? send(res, 200, fs.readFileSync(p), 'image/png') : send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
        }
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
        if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (err) {
        return send(res, 400, { error: err.message });
    }
});

// Läuft die Zentrale schon (zweites Fenster), freundlich Bescheid geben statt abzustürzen
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('Die Kasi-Zentrale läuft bereits. Einfach im Browser öffnen: http://127.0.0.1:' + PORT);
        process.exit(0);
    }
    throw err;
});
server.listen(PORT, '127.0.0.1', () => {
    console.log('Kasi-Zentrale läuft: http://127.0.0.1:' + PORT + '  (Strg+C beendet)');
    Activity.log('good', 'Zentrale gestartet · 127.0.0.1:' + PORT);
    // Heiße Leads alle 10 Minuten prüfen, solange die Zentrale läuft (nur lesen und Hinweis an Sie)
    const alertLoop = () => runScript('alert-agent.js', [], true).catch(() => {});
    setTimeout(alertLoop, 20000);
    setInterval(alertLoop, 10 * 60000);
});
