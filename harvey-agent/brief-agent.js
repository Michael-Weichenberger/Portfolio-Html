#!/usr/bin/env node
/* =============================================================================
   KASI · Briefaktion: persönlicher Brief mit Website-Check und QR-Code

   npm run briefe                       bis zu 10 Betriebe aus der Akquise-Liste
   npm run briefe -- --limit 5          weniger auf einmal
   npm run briefe -- --domain huber-maler.de   nur dieser Betrieb

   Für jeden Betrieb (Kontaktweg Brief oder persönlich, noch nicht angeschrieben):
   1. Website messen (wie der Website-Check), falls die letzte Messung älter
      als 14 Tage ist
   2. den Report als persönliche Seite veröffentlichen:
      mw-itservices.de/?check=<id>  (Herkunft „brief“, Kasi sieht den Aufruf)
   3. Anschrift und Ansprechpartner aus dem Impressum lesen (bitte prüfen)
   4. Brief als PDF (DIN A4, Fensterumschlag DL) mit QR-Code erzeugen:
      out/briefe/<Datum>/<domain>.pdf und alle zusammen in alle-briefe.pdf

   Rechtlich: Werbung per Brief an Betriebe ist ohne Einwilligung erlaubt
   (§ 7 UWG gilt für Mail, Telefon, Fax). Der Brief nennt, woher die Anschrift
   stammt, und wie man weitere Post abbestellt (Art. 14, 21 DSGVO).
   Versendet wird nichts automatisch: Sie drucken, kuvertieren, werfen ein und
   markieren den Brief in der Zentrale als versendet.
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const fs = require('fs');
const path = require('path');
const QR = require('qrcode');
const Store = require('./core/datastore.js');
const Cloud = require('./core/cloud.js');
const Run = require('./core/runlog.js');
const A = require('./core/analyze.js');
const { processTarget } = require('./harvey-worker.js');

const ROOT = __dirname;
const SITE = 'https://mw-itservices.de';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'out', 'briefe', TODAY);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const daysSince = (d) => (d ? Math.floor((Date.now() - Date.parse(d)) / 86400000) : Infinity);

/* ---------------------------------------- Anschrift aus dem Impressum --- */
async function findAddress(url) {
    const out = { company: null, street: null, zip: null, city: null, contact: null, source: null };
    let html = '';
    try {
        const r = await A.get(url, {}, 15000);
        html = await A.readText(r);
        const link = (html.match(/<a\b[^>]*href\s*=\s*["']([^"']*impressum[^"']*)["']/i) || [])[1];
        if (link) {
            const ir = await A.get(new URL(link, r.url).toString(), {}, 15000);
            if (ir.ok) { html = await A.readText(ir); out.source = 'Impressum'; }
        }
    } catch (err) { return out; }
    // Text zeilenweise; manche Baukästen liefern HTML als Text (z. B. in JSON-Attributen)
    html = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
    let text = A.stripTags(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|span|address|td)>/gi, '\n'));
    text = text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '\n').replace(/[ \t]+/g, ' ');
    const lines = text.split(/\n|\s\|\s/).map((x) => x.trim()).filter(Boolean);
    const HEAD = /impressum|angaben gem|kontakt|anschrift|^adresse|deutschland|germany|startseite/i;
    // Straße mit Hausnummer am Ende: zuerst Wort mit Straßen-Endung, sonst bis zu drei großgeschriebene Wörter
    const SUFFIX = /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|ufer|damm|steig|berg|feld|hof|markt|graben|winkel|park|tor|anger|wall|höhe)\s?\d{1,4}\s?[a-zA-Z]?)$/i;
    const WORDS = /((?:[A-ZÄÖÜ][a-zäöüß.\-]+\s){1,2}\d{1,4}\s?[a-zA-Z]?)$/;
    const streetOf = (s) => { const x = String(s || '').trim().replace(/[,;]+$/, ''); const m = x.match(SUFFIX) || x.match(WORDS); return m ? m[1].trim() : null; };
    const LEGAL = /([A-ZÄÖÜ][^\n|:]{1,60}?\s(?:GmbH(?: & Co\. KG)?|UG(?: \(haftungsbeschränkt\))?|GbR|e\.K\.|KG|OHG|AG))\b/;
    const clean = (s) => String(s || '').replace(/^(Impressum|Kontakt|Anschrift)\s*[|:–-]?\s*/i, '').split(/\s+[–-]\s+Inh/)[0].trim();
    for (let i = 0; i < lines.length && !out.zip; i++) {
        const pm = lines[i].match(/(?:^|,\s*|\s)(\d{5})\s+([A-ZÄÖÜ][a-zäöüß\-]+(?:\s(?:am|an der|an|bei|im|in|ob|unter)\s[A-ZÄÖÜ][a-zäöüß\-]+)?)/);
        if (!pm) continue;
        let streetLine = i;
        let street = streetOf(lines[i].slice(0, pm.index));
        if (!street && i > 0) { street = streetOf(lines[i - 1]); streetLine = i - 1; }
        if (!street) continue;
        out.street = street; out.zip = pm[1]; out.city = pm[2].trim();
        // Firma: Rechtsform in der Nähe, sonst der Text davor
        const near = [lines[streetLine].slice(0, lines[streetLine].lastIndexOf(street)), ...lines.slice(Math.max(0, streetLine - 3), streetLine).reverse()];
        const legal = near.map((x) => (x.match(LEGAL) || [])[1]).find(Boolean);
        const plain = near.map((x) => clean(x.replace(/[,\s–-]+$/, ''))).find((x) => x && !HEAD.test(x) && x.length < 70 && !/\d{3,}|@/.test(x));
        out.company = clean(legal || plain) || null;
    }
    const ROLE = /^(Geschäftsführer|Geschäftsführung|Inhaber|Vertreten|Verantwortlich|Herr|Frau)/i;
    const who = [...text.matchAll(/(?:Inhaber(?:in)?|Inh\.|Geschäftsführer(?:in)?|Geschäftsführung|Vertreten durch|Vertretungsberechtigt(?:er)?)\s*:?\s*((?:Dr\.\s|Dipl\.-[A-Za-z]+\.\s)?(?:[A-ZÄÖÜ][a-zäöüß]*\.?\s)?[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)/g)]
        .map((m) => m[1].trim()).filter((x) => !ROLE.test(x));
    if (who.length) out.contact = who[0];
    if (!out.company) { const f = text.match(LEGAL); if (f) out.company = clean(f[1]); }
    return out;
}

/* ------------------------------------------- Report öffentlich stellen --- */
async function publish(result, lead) {
    const t = result.target;
    const now = new Date().toISOString();
    await Cloud.query(`INSERT INTO leads (id, kind, status, created_at, updated_at, name, url, report, findings, measured_at, published, source)
        VALUES (?, 'akquise', 'neu', ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (id) DO UPDATE SET report = excluded.report, findings = excluded.findings, measured_at = excluded.measured_at, published = 1, updated_at = excluded.updated_at`,
    [t.id, now, now, lead.name || t.name, t.url, JSON.stringify(result.teaser), JSON.stringify(result.findings), result.measuredAt, JSON.stringify({ source: 'brief', medium: 'post', campaign: 'brief-' + TODAY })]);
    return SITE + '/?check=' + t.id + '&utm_source=brief&utm_medium=post&utm_campaign=brief-' + TODAY + '#sichtbarkeit';
}

/* ---------------------------------------------------------- Brieftext --- */
function why(f) { return !f.evidence || /^Nicht erfüllt|Schema|Typen|JSON/i.test(f.evidence) ? f.impact : f.evidence + ' ' + (f.impact || ''); }

function letterHtml(d) {
    const company = Store.load('company');
    const sender = [company.name || 'MW IT-SERVICES', company.owner || 'Michael Weichenberger', company.street, (company.zip || '') + ' ' + (company.city || '')].filter((x) => x && x.trim()).join(' · ');
    const anrede = d.addr.contact && !/^[A-ZÄÖÜ]\.\s/.test(d.addr.contact) ? 'Guten Tag ' + d.addr.contact + ',' : 'Guten Tag,';
    const top = d.findings.slice(0, 3);
    const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
    const recipient = [d.addr.company || d.name, d.addr.contact ? 'z. Hd. ' + d.addr.contact : null, d.addr.street || '⚠ Straße bitte ergänzen', ((d.addr.zip || '') + ' ' + (d.addr.city || '')).trim() || '⚠ PLZ Ort bitte ergänzen'].filter(Boolean);
    return `<section class="page">
  <header class="head"><img class="logo" src="${d.logo}" alt=""><div class="hc"><b>${esc(company.name || 'MW IT-SERVICES')}</b><span>${esc(company.street || '')} · ${esc((company.zip || '') + ' ' + (company.city || ''))}</span><span>${esc(company.phone || '')} · ${esc(company.email || '')}</span><span>mw-itservices.de</span></div></header>
  <div class="window"><p class="sender">${esc(sender)}</p><p class="rcpt">${recipient.map(esc).join('<br>')}</p></div>
  <p class="date">Langweid am Lech, ${esc(date)}</p>
  <h1>Ihre Website ${esc(d.domain)}: ${d.met != null ? d.met + ' von ' + d.total + ' Punkten' : 'drei Punkte, die Anfragen kosten'}</h1>
  <p>${esc(anrede)}</p>
  <p>ich bin Michael Weichenberger aus Langweid am Lech. Ich habe selbst Maler und Lackierer gelernt und baue heute Websites für Handwerksbetriebe in der Region. Ich habe mir ${esc(d.domain)} angesehen und gemessen, wie die Seite bei Google, auf dem Handy und bei KI-Assistenten wie ChatGPT ankommt.</p>
  ${top.length ? `<p>Drei Punkte kosten Sie wahrscheinlich Anfragen:</p><ol>${top.map((f) => `<li><b>${esc(f.title)}</b>: ${esc(why(f))}</li>`).join('')}</ol>` : '<p>Die Seite ist technisch in einem guten Zustand. Ein paar Feinheiten zeige ich Ihnen gern.</p>'}
  <div class="qrbox"><img src="${d.qr}" alt="QR-Code zum persönlichen Report"><div><b>Ihr persönlicher Report</b><p>Mit dem Handy scannen: alle Punkte mit Erklärung und Lösung. Kostenlos, ohne Anmeldung.</p><p class="url">${esc(d.shortUrl)}</p></div></div>
  <p>Wenn Sie möchten, gehe ich die Punkte in 15 Minuten mit Ihnen durch, gern auch bei Ihnen im Betrieb. Rufen Sie mich einfach an oder schreiben Sie mir eine kurze Nachricht.</p>
  <p class="sig">Viele Grüße<br><br><b>Michael Weichenberger</b><br>MW IT-SERVICES · ${esc(company.phone || '')} · ${esc(company.email || '')}</p>
  <footer>Ihre Firmenanschrift stammt aus dem Impressum Ihrer Website. Wenn Sie keine weitere Post von mir möchten, genügt eine kurze Nachricht an ${esc(company.email || 'info@mw-itservices.de')}. Datenschutz: mw-itservices.de/datenschutz.html</footer>
</section>`;
}

const CSS = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font:10pt/1.42 "Segoe UI",Arial,sans-serif;color:#1d1714}
.page{position:relative;width:210mm;height:297mm;padding:10mm 20mm 24mm 25mm;page-break-after:always;overflow:hidden}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #B56535;padding-bottom:4mm}.logo{height:16mm}
.hc{display:flex;flex-direction:column;align-items:flex-end;font-size:8.5pt;color:#5b4a40}.hc b{font-size:10pt;color:#8C4A25;letter-spacing:.06em}
.window{position:absolute;top:45mm;left:25mm;width:85mm;height:45mm}.sender{font-size:7pt;color:#7a6a60;border-bottom:.5px solid #bbb;margin:0 0 2mm}.rcpt{margin:0;font-size:11pt;line-height:1.45}
.date{margin:56mm 0 4mm;text-align:right;font-size:9.5pt;color:#5b4a40}h1{font-size:12.5pt;margin:0 0 3mm;color:#8C4A25}
p{margin:0 0 2.4mm}ol{margin:0 0 3mm;padding-left:5mm}li{margin-bottom:1.4mm}
.qrbox{display:flex;gap:5mm;align-items:center;border:1px solid #DF9A67;border-radius:3mm;padding:2.5mm 4mm;margin:3mm 0;background:#fbf6f1}.qrbox img{width:26mm;height:26mm}
.qrbox p{margin:1mm 0;font-size:9.5pt}.qrbox b{color:#8C4A25}.url{font-size:7.5pt;color:#7a6a60;word-break:break-all}
.sig{margin-top:3mm}footer{position:absolute;left:25mm;right:20mm;bottom:9mm;font-size:7pt;color:#8a7a70;border-top:.5px solid #ddd;padding-top:2mm}`;

/* --------------------------------------------------------------- Lauf --- */
async function main() {
    Store.ensure();
    const leads = Store.load('leads');
    const only = opt('domain');
    const limit = Number(opt('limit')) || 10;
    const todo = leads.filter((l) => (only ? l.domain === only : ['neu', 'gemessen'].includes(l.status) && ['brief', 'persoenlich'].includes(l.contactAllowed || 'brief'))).slice(0, limit);
    if (!todo.length) { console.log('Keine Betriebe für Briefe: zuerst unter Leads & Scout Vorschläge übernehmen (Kontaktweg Brief).'); return Run.done('briefe', { summary: 'Keine Betriebe für Briefe' }); }
    fs.mkdirSync(OUT, { recursive: true });
    const logo = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'assets', 'opt', 'logo-mw-it-services.webp')).toString('base64');
    const pages = [];
    const notes = [];
    for (const l of todo) {
        try {
            console.log('→ ' + l.domain + ' …');
            // Messung: vorhandene Akte nutzen, wenn jünger als 14 Tage
            let result = null;
            const caseJson = l.caseFile ? path.join(ROOT, l.caseFile.replace(/\.md$/, '.json')) : null;
            if (caseJson && fs.existsSync(caseJson) && daysSince(l.lastScan) < 14) result = JSON.parse(fs.readFileSync(caseJson, 'utf8'));
            if (!result || !result.teaser) result = await processTarget(l.domain, { publish: false, json: false });
            const link = await publish(result, l);
            const addr = await findAddress(result.target.url);
            const qr = await QR.toDataURL(link, { margin: 1, width: 360, color: { dark: '#1d1714', light: '#ffffff' } });
            const html = letterHtml({ domain: l.domain, name: l.name, met: result.teaser.met, total: result.teaser.total, findings: result.findings, addr, qr, logo, shortUrl: SITE.replace('https://', '') + '/?check=' + result.target.id });
            pages.push({ l, html, addr, id: result.target.id, link });
            Object.assign(l, { status: 'brief-bereit', letter: { at: new Date().toISOString(), file: 'out/briefe/' + TODAY + '/' + l.domain + '.pdf', cloudId: result.target.id, link, address: addr },
                caseFile: 'out/' + result.target.id + '.md', lastScan: l.lastScan && daysSince(l.lastScan) < 14 ? l.lastScan : TODAY, met: result.teaser.met, total: result.teaser.total });
            const missing = [!addr.street && 'Straße', !addr.zip && 'PLZ/Ort', !addr.contact && 'Ansprechpartner'].filter(Boolean);
            notes.push(l.name + ': Brief bereit' + (missing.length ? ' · bitte ergänzen: ' + missing.join(', ') : ''));
            console.log('  ✓ Brief' + (missing.length ? ' (fehlt: ' + missing.join(', ') + ')' : ''));
        } catch (err) {
            console.log('  ✗ ' + err.message);
            notes.push(l.name + ': ' + err.message.slice(0, 120));
        }
        Store.save('leads', leads);
    }
    if (pages.length) {
        const { chromium } = require('playwright-core');
        const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
        const page = await browser.newPage();
        const doc = (body) => '<!doctype html><html lang="de"><head><meta charset="utf-8"><style>' + CSS + '</style></head><body>' + body + '</body></html>';
        for (const p of pages) {
            await page.setContent(doc(p.html), { waitUntil: 'load' });
            await page.pdf({ path: path.join(OUT, p.l.domain + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
        }
        await page.setContent(doc(pages.map((p) => p.html).join('')), { waitUntil: 'load' });
        await page.pdf({ path: path.join(OUT, 'alle-briefe.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
        await browser.close();
    }
    const summary = pages.length + (pages.length === 1 ? ' Brief' : ' Briefe') + ' bereit · out/briefe/' + TODAY + '/alle-briefe.pdf';
    console.log(summary);
    Run.done('briefe', { summary, notes, data: { date: TODAY, letters: pages.map((p) => ({ domain: p.l.domain, name: p.l.name, file: 'out/briefe/' + TODAY + '/' + p.l.domain + '.pdf', address: p.addr })) } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
module.exports = { main, findAddress };
