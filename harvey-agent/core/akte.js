/* =============================================================================
   KASI · Gesprächsakte je Kunde
   Eine Seite zum Öffnen im Telefonat: Website-Link, Kontakt, Stand, die
   Hauptpunkte aus der Mail und darunter ALLE geprüften Punkte mit Beleg,
   Auswirkung und Lösung. Druckbar.

   Quellen:
     local/<fall>   Akquise (pipeline-agent): out/<fall>.json + data/leads.json
     cloud/<id>     Anfrage von der Website (D1): Report, Kontakt, Planer-Auswahl, Verlauf
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const Store = require('./datastore.js');
const VisRules = require('../../vis-rules.js');
const Offer = require('../../offer-rules.js');

const OUT = path.join(__dirname, '..', 'out');
const SITE = 'https://mw-itservices.de';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const de = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const STATE = { good: 'Gut', warn: 'Verbesserbar', bad: 'Kritisch', pending: 'nicht gemessen' };
const KIND = { anfrage: 'Anfrage über den Website-Check', paket: 'Anfrage über den Projekt-Planer', akquise: 'Akquise' };

function parse(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } }

/* Akquise-Fall aus dem Pipeline-Lauf */
function local(caseId) {
    if (!/^[a-z0-9-]{3,90}$/.test(caseId)) throw new Error('Ungültige Akte');
    const file = path.join(OUT, caseId + '.json');
    if (!fs.existsSync(file)) throw new Error('Akte nicht gefunden (out/' + caseId + '.json)');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const lead = Store.load('leads').find((l) => l.caseFile && l.caseFile.replace(/\\/g, '/').endsWith(caseId + '.md')) || {};
    const t = j.target || {};
    const report = (j.psi || j.structure) ? VisRules.buildReport({ url: t.url, name: t.name, measuredAt: j.measuredAt, psi: j.psi, structure: j.structure }) : null;
    return {
        kind: 'akquise', name: lead.name || t.name, url: t.url || (lead.domain ? 'https://' + lead.domain + '/' : ''), domain: lead.domain || t.name,
        email: null, phone: lead.phone || null, status: lead.status || null, contactAllowed: lead.contactAllowed || null, notes: lead.notes || '',
        measuredAt: j.measuredAt, report, findings: j.findings || [], callOpener: j.case && j.case.callOpener, teaser: j.case && j.case.teaserLink,
        mail: j.case && j.case.letter ? { subject: 'Anschreiben (Brief)', body: j.case.letter } : null, psi: j.psi, structure: j.structure, activities: []
    };
}

/* Anfrage von der Website aus D1 */
async function cloud(id) {
    if (!/^[a-z0-9-]{3,90}$/.test(id)) throw new Error('Ungültige Akte');
    const Cloud = require('./cloud.js');
    const [r] = await Cloud.query('SELECT * FROM leads WHERE id = ?', [id]);
    if (!r) throw new Error('Anfrage nicht gefunden');
    const acts = await Cloud.query('SELECT at, type, text FROM activities WHERE lead_id = ? ORDER BY at DESC LIMIT 30', [id]).catch(() => []);
    const report = parse(r.report);
    const selection = parse(r.selection);
    const source = parse(r.source);
    return {
        kind: r.kind, name: r.name, url: r.url || '', domain: (r.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''), email: r.email, phone: r.phone, status: r.status,
        notes: r.notes || '', measuredAt: r.measured_at, report: report && Array.isArray(report.points) ? report : null, findings: parse(r.findings) || [],
        message: r.message, topic: r.topic, selection, quote: selection ? Offer.quote(selection, r.created_at) : null, source, createdAt: r.created_at,
        teaser: r.published ? SITE + '/?check=' + r.id + '#sichtbarkeit' : null, mail: r.subject ? { subject: r.subject, body: r.body } : null, activities: acts
    };
}

/* Alle Prüfpunkte: aus dem Report, sonst aus den Rohdaten neu berechnet */
function signalsOf(a) {
    if (a.report && a.report.points && a.report.points.some((p) => Array.isArray(p.signals))) return a.report.points;
    return a.report ? a.report.points : [];
}

/* Schmerzpunkt, Technik und Ursachen */
function diag(g) {
    if (!g) return '';
    const st = g.stack || {};
    const tech = [st.cms ? st.cms + (st.version ? ' ' + st.version : '') : 'kein bekanntes CMS erkannt', st.theme ? 'Theme: ' + st.theme : null,
        st.builder ? 'Page-Builder: ' + st.builder : null, st.cachePlugin ? 'Cache: ' + st.cachePlugin : null, st.server ? 'Server: ' + st.server : null].filter(Boolean);
    const pain = g.pain && g.pain.level !== 'ok'
        ? '<h2>Schmerzpunkt</h2><p class="opener"><b>' + esc(g.pain.headline) + '</b><br>' + esc(g.pain.text) + (g.pain.cause ? '<br><b>' + esc(g.pain.cause) + '</b>' : '') + '</p>' : '';
    const plugins = st.plugins && st.plugins.length ? '<p class="muted small">Sichtbare Plugins: ' + st.plugins.map(esc).join(', ') + '</p>' : '';
    const causes = g.causes && g.causes.length
        ? '<table class="causes">' + g.causes.map((c) => '<tr><td class="sev">' + '●'.repeat(c.sev) + '</td><td class="sig"><b>' + esc(c.title) + '</b><div class="ev">' + esc(c.evidence) + '</div><div class="fix">' + esc(c.fix) + '</div></td></tr>').join('') + '</table>'
        : '<p class="muted">Keine technischen Bremsen gefunden.</p>';
    return pain + '<h2>Technik der Website</h2><p>' + tech.map(esc).join(' · ') + '</p>' + plugins + '<h2>Technische Ursachen</h2>' + causes;
}

function render(a) {
    const points = signalsOf(a);
    const top = (a.findings || []).slice(0, 4);
    const site = a.url || (a.domain ? 'https://' + a.domain + '/' : '');
    const count = points.reduce((n, p) => n + (p.signals || []).length, 0);
    const missing = points.reduce((n, p) => n + (p.signals || []).filter((s) => s.ok === false).length, 0);
    const q = a.quote;
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akte · ${esc(a.name)} · Kasi</title>
<style>
:root{--bg:#16110E;--panel:#1E1612;--line:rgba(240,201,166,.16);--text:#F4F0E8;--muted:#B9A898;--cu:#DF9A67;--cu2:#B56535;--good:#8FBF7A;--warn:#E4B872;--bad:#E58A6E}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,"Segoe UI",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 64px}
h1,h2,h3{font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;font-weight:500;margin:0}
h1{font-size:2rem}h2{font-size:1.35rem;margin:34px 0 12px;padding-top:18px;border-top:1px solid var(--line)}h3{font-size:1.08rem}
a{color:var(--cu)}.muted{color:var(--muted)}.small{font-size:13px}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.btn{display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border-radius:99px;border:1px solid var(--line);color:var(--text);text-decoration:none;font-weight:600;font-size:14px;background:rgba(244,240,232,.04)}
.btn.cu{background:linear-gradient(180deg,#B56535,#8C4A25);border-color:transparent;color:#fff}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:18px}
.fact{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.fact b{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.score{font-size:2.2rem;font-family:"Iowan Old Style",Palatino,Georgia,serif;color:var(--cu)}
.opener{background:var(--panel);border-left:3px solid var(--cu);padding:14px 16px;border-radius:8px;font-size:16px}
.top4{counter-reset:t;list-style:none;padding:0;margin:0;display:grid;gap:10px}
.top4 li{counter-increment:t;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px 12px 52px;position:relative}
.top4 li:before{content:counter(t);position:absolute;left:14px;top:12px;width:26px;height:26px;border-radius:50%;background:var(--cu2);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px}
.area{margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.area-head{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);align-items:baseline}
.st{font-size:12px;font-weight:700;padding:2px 10px;border-radius:99px;border:1px solid currentColor}.st.good{color:var(--good)}.st.warn{color:var(--warn)}.st.bad{color:var(--bad)}.st.pending{color:var(--muted)}
table{width:100%;border-collapse:collapse}td{padding:10px 16px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}
td.ok{width:34px;font-size:18px}.y{color:var(--good)}.n{color:var(--bad)}.u{color:var(--muted)}
.sig b{display:block}.sig .ev{color:var(--muted);font-size:13px}.sig .fix{font-size:13px;margin-top:4px}.sig .fix:before{content:"Lösung: ";color:var(--cu);font-weight:600}
.sev{color:var(--cu);letter-spacing:2px;font-size:12px;white-space:nowrap}
table.causes{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}table.causes td.sev{width:60px}
pre{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;font:13px/1.5 ui-monospace,Consolas,monospace;color:var(--muted)}
.notes{min-height:140px;border:1px dashed var(--line);border-radius:12px;padding:12px;color:var(--muted)}
ul.acts{list-style:none;padding:0;margin:0}ul.acts li{padding:6px 0;border-top:1px solid var(--line);font-size:13px}
@media print{body{background:#fff;color:#111}.btns,.noprint{display:none}.fact,.area,.top4 li,pre,.opener{background:#fff;border-color:#ccc}a{color:#111}.muted,.sig .ev{color:#555}h2{border-color:#ccc}}
</style></head><body><div class="wrap">
<div class="top">
  <div>
    <p class="muted small">${esc(KIND[a.kind] || 'Kunde')}${a.createdAt ? ' · eingegangen ' + esc(de(a.createdAt)) : ''}${a.source ? ' · Herkunft ' + esc(a.source.source + (a.source.campaign ? ' / ' + a.source.campaign : '')) : ''}</p>
    <h1>${esc(a.name || a.domain)}</h1>
    ${site ? `<p><a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(site.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>` : ''}
  </div>
  ${a.report && a.report.met != null ? `<div class="score" title="erfüllte Signale">${a.report.met}<span class="muted small"> / ${a.report.total} Signale</span></div>` : ''}
</div>
<div class="btns noprint">
  ${site ? `<a class="btn cu" href="${esc(site)}" target="_blank" rel="noopener noreferrer">Website ansehen</a>` : ''}
  ${a.phone ? `<a class="btn" href="tel:${esc(String(a.phone).replace(/[^\d+]/g, ''))}">Anrufen ${esc(a.phone)}</a>` : ''}
  ${a.email ? `<a class="btn" href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}
  ${a.teaser ? `<a class="btn" href="${esc(a.teaser)}" target="_blank" rel="noopener noreferrer">Report wie beim Kunden</a>` : ''}
  ${site ? `<a class="btn" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(site)}&form_factor=mobile" target="_blank" rel="noopener noreferrer">PageSpeed live</a>` : ''}
</div>
<div class="facts">
  <div class="fact"><b>Status</b>${esc(a.status || '–')}${a.contactAllowed ? ' · Kontakt: ' + esc(a.contactAllowed) : ''}</div>
  <div class="fact"><b>Gemessen</b>${esc(de(a.measuredAt))}</div>
  <div class="fact"><b>Ergebnis</b>${a.report ? esc(a.report.headline || '') : 'noch nicht gemessen'}</div>
  ${count ? `<div class="fact"><b>Offene Punkte</b>${missing} von ${count}</div>` : ''}
</div>
${diag(a.report && a.report.diagnosis)}
${a.callOpener ? `<h2>Gesprächseinstieg</h2><p class="opener">${esc(a.callOpener)}</p>` : ''}
${q ? `<h2>Gewähltes Paket</h2><p>${q.lines.map((l) => esc(l.label) + (l.month !== undefined ? ' · ' + l.month + ' €/Monat' : l.included ? ' · inklusive' : ' · ' + l.once + ' €')).join('<br>')}</p><p class="muted">Summe einmalig ${q.once} € netto${q.month ? ' + ' + q.month + ' €/Monat' : ''}${q.promo ? ' · Aktionspreis' : ''}</p>` : ''}
${a.message ? `<h2>Nachricht des Kunden</h2><p class="opener">${esc(a.message)}</p>` : ''}
${top.length ? `<h2>Die ${top.length} Hauptpunkte (stehen so in der Mail)</h2><ol class="top4">${top.map((f) => `<li><b>${esc(f.title)}</b><br><span class="muted small">${esc(f.evidence)}</span>${f.impact ? `<br><span class="small">${esc(f.impact)}</span>` : ''}</li>`).join('')}</ol>` : ''}
<h2>Alle geprüften Punkte</h2>
${points.length ? points.map((p) => `<section class="area">
  <div class="area-head"><h3>${esc(p.title)}</h3><span><span class="muted small">${esc(p.value || '')}</span> <span class="st ${esc(p.status)}">${esc(STATE[p.status] || p.status)}</span></span></div>
  ${(p.signals || []).length ? `<table>${p.signals.slice().sort((x, y) => (x.ok === false ? 0 : 1) - (y.ok === false ? 0 : 1) || (y.sev || 0) - (x.sev || 0)).map((s) => `<tr>
    <td class="ok">${s.ok === true ? '<span class="y" aria-label="erfüllt">✓</span>' : s.ok === false ? '<span class="n" aria-label="fehlt">✗</span>' : '<span class="u" aria-label="unbekannt">?</span>'}</td>
    <td class="sig"><b>${esc(s.ok === false && s.miss ? s.miss.charAt(0).toUpperCase() + s.miss.slice(1) : s.label)}</b>${s.evidence ? `<div class="ev">${esc(s.evidence)}</div>` : ''}${s.ok === false && s.fix ? `<div class="fix">${esc(s.fix)}</div>` : ''}${s.ok === false && s.impact ? `<div class="ev">${esc(s.impact)}</div>` : ''}</td>
    <td class="sev" title="Gewicht">${'●'.repeat(s.sev || 1)}</td></tr>`).join('')}</table>` : `<p class="muted small" style="padding:0 16px 12px">${esc(p.text || 'Keine Einzelwerte gespeichert.')}</p>`}
</section>`).join('') : '<p class="muted">Für diese Anfrage gibt es noch keine Messung. Im Web-Dashboard „Neu messen“ oder den Website-Check selbst starten.</p>'}
${a.psi ? `<h2>Messwerte</h2><p class="muted small">PageSpeed Performance ${a.psi.performance ?? '–'}/100 · SEO ${a.psi.seo ?? '–'}/100 · Barrierefreiheit ${a.psi.accessibility ?? '–'}/100 · LCP ${a.psi.lcp != null ? (a.psi.lcp).toString().replace('.', ',') + ' s' : '–'}${a.structure ? ' · Server-Antwort ' + (a.structure.ttfbMs != null ? (a.structure.ttfbMs / 1000).toFixed(1).replace('.', ',') + ' s' : '–') + ' · ' + (a.structure.words ?? '–') + ' Wörter · H1: ' + esc(a.structure.h1 || '–') : ''}</p>` : ''}
${a.mail ? `<h2>${esc(a.mail.subject)}</h2><pre>${esc(a.mail.body)}</pre>` : ''}
${a.activities && a.activities.length ? `<h2>Verlauf</h2><ul class="acts">${a.activities.map((x) => `<li><span class="muted">${esc(de(x.at))}</span> · ${esc(x.text)}</li>`).join('')}</ul>` : ''}
<h2>Notizen aus dem Gespräch</h2>
${a.notes ? `<p>${esc(a.notes)}</p>` : ''}
<div class="notes">Platz für Notizen (beim Drucken)</div>
<p class="muted small noprint" style="margin-top:28px">Kasi · Gesprächsakte · nur auf diesem Rechner · Strg+P zum Drucken</p>
</div></body></html>`;
}

module.exports = { local, cloud, render };
