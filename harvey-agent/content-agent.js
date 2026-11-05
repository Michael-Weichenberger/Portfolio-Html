#!/usr/bin/env node
/* =============================================================================
   KASI · Beiträge (Local SEO für Google-Unternehmensprofil und LinkedIn)

   npm run beitraege              Beiträge dieser Woche vorbereiten (einmal je Woche)
   npm run beitraege -- --force   neu erstellen

   Pro Woche zwei Entwürfe im Postausgang (Typ „Beitrag“):
     - Google-Unternehmensprofil von MW IT-SERVICES (kurz, mit Link).
       Veröffentlicht wird erst nach „Freigeben & Veröffentlichen“.
     - LinkedIn (länger). LinkedIn hat keine freie Schnittstelle: Sie kopieren
       den Text und posten selbst, die Zentrale vermerkt es.
   Dazu ein Bild im Look der Website (1080 × 1080) in out/beitraege/<Woche>/.

   Themen: feste Liste mit Tipps für Handwerksbetriebe, der Reihe nach.
   Erfolgsgeschichten nur über Kunden mit Referenz-Freigabe
   (clients.json → "reference": true) und nur mit gemessenen Werten.
   Mit ANTHROPIC_API_KEY wird der Text sprachlich angepasst, sonst Vorlage.
   ============================================================================= */
'use strict';

require('./harvey-worker.js'); // lädt .env
const fs = require('fs');
const path = require('path');
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const AI = require('./core/ai.js');
const Run = require('./core/runlog.js');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const SITE = 'https://mw-itservices.de/';
const TAGS = '#Handwerk #Augsburg #LocalSEO #Webdesign';

/* Tipps, die für jeden Handwerksbetrieb stimmen. Keine Zahlen, die wir nicht belegen können. */
const TOPICS = [
    { id: 'gbp-pflege', title: 'Ihr Google-Profil ist Ihr erstes Schaufenster', lead: 'Wer „Maler in Augsburg“ sucht, sieht zuerst die Karte mit den Unternehmensprofilen, noch vor jeder Website.',
        points: ['Öffnungszeiten aktuell halten, auch an Feiertagen', 'echte Fotos von Baustellen und Team hochladen', 'jede Bewertung beantworten, die guten wie die kritischen'] },
    { id: 'handy', title: 'Ihre Kunden suchen auf dem Handy', lead: 'Viele Anfragen für Handwerker beginnen auf dem Smartphone, oft direkt auf der Baustelle oder abends auf dem Sofa.',
        points: ['Telefonnummer oben und antippbar', 'Text ohne Zoomen lesbar', 'Kontaktformular mit wenigen Feldern'] },
    { id: 'ladezeit', title: 'Drei Sekunden entscheiden', lead: 'Lädt eine Seite zu lange, ist der Interessent beim nächsten Betrieb. Langsame Websites verlieren Anfragen, bevor sie überhaupt gelesen werden.',
        points: ['Bilder verkleinern, bevor sie hochgeladen werden', 'keine schweren Baukasten-Effekte', 'Ladezeit einmal im Quartal messen'] },
    { id: 'impressum', title: 'Impressum und Datenschutz: Pflicht, nicht Kür', lead: 'Ein fehlendes oder veraltetes Impressum kann eine Abmahnung nach sich ziehen. Seit Mai 2024 gilt dafür das Digitale-Dienste-Gesetz (§ 5 DDG).',
        points: ['Impressum von jeder Seite mit einem Klick erreichbar', 'Verweis auf das alte TMG ersetzen', 'Datenschutzerklärung zu den genutzten Diensten passend'] },
    { id: 'leistungsseiten', title: 'Eine Seite pro Leistung', lead: 'Google zeigt eher die Seite, die genau zur Suche passt. „Badsanierung in Augsburg“ findet eine eigene Seite zur Badsanierung leichter als eine Sammelseite.',
        points: ['je Hauptleistung eine Unterseite', 'Ort und Einzugsgebiet im Text nennen', 'Fotos eigener Projekte statt Stockbilder'] },
    { id: 'ki-suche', title: 'Wird Ihr Betrieb von KI-Assistenten empfohlen?', lead: 'Immer mehr Menschen fragen ChatGPT & Co. nach einem Handwerker in der Nähe. Genannt wird, wer im Netz klar und einheitlich beschrieben ist.',
        points: ['Name, Adresse und Telefon überall gleich', 'Leistungen und Ort klar auf der Website', 'aktuelle Bewertungen auf Google'] },
    { id: 'bewertungen', title: 'Bewertungen sammeln, ohne zu nerven', lead: 'Zufriedene Kunden bewerten gern, sie werden nur selten gefragt.',
        points: ['direkt nach der Abnahme freundlich fragen', 'den Link als QR-Code auf Rechnung oder Visitenkarte', 'jede Bewertung persönlich beantworten'] },
    { id: 'karriere', title: 'Fachkräfte finden über die eigene Website', lead: 'Gute Leute schauen sich zuerst an, wie ein Betrieb im Netz auftritt, bevor sie sich bewerben.',
        points: ['eigene Karriereseite mit echten Fotos', 'Bewerbung in zwei Minuten, auch vom Handy', 'ehrlich zeigen, wie der Arbeitsalltag aussieht'] },
    { id: 'kontakt', title: 'Machen Sie es Interessenten leicht', lead: 'Jeder zusätzliche Schritt bis zur Anfrage kostet Kontakte.',
        points: ['Anruf, Mail und Formular auf jeder Seite', 'Rückruf-Zeitfenster anbieten', 'klare Antwortzeit nennen, z. B. „Antwort am selben Werktag“'] },
    { id: 'aktuell', title: 'Eine Website ist kein Einmal-Projekt', lead: 'Veraltete Preise, alte Fotos oder ein Hinweis auf „Neu 2019“ wirken auf Interessenten, als gäbe es den Betrieb nicht mehr.',
        points: ['zweimal im Jahr alle Texte durchsehen', 'neue Projekte als Referenz ergänzen', 'Technik und Sicherheits-Updates regelmäßig'] }
];

const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    return y + '-W' + String(Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0');
};

function story() {
    // nur Kunden mit Referenz-Freigabe und gemessenen Werten
    const watch = Store.load('watch');
    for (const c of Store.load('clients').filter((x) => x.reference === true)) {
        for (const d of c.domains || []) {
            const chk = ((watch.domains || {})[d] || {}).checks || [];
            const last = chk[chk.length - 1];
            const vis = ((watch.reports || {})[d] || {}).vis;
            if (last && last.ok && vis) {
                return { id: 'story:' + c.id, title: 'Aus der Praxis: ' + c.company, lead: 'Für ' + c.company + ' betreuen wir die Website ' + d + '.',
                    points: ['lädt aktuell in ' + (last.ms / 1000).toFixed(1).replace('.', ',') + ' s', vis.met + ' von ' + vis.total + ' Punkten im Sichtbarkeits-Check', 'gesichert mit gültigem SSL-Zertifikat und aktuellem Impressum'] };
            }
        }
    }
    return null;
}

function texts(t) {
    const list = t.points.map((p) => '✓ ' + p).join('\n');
    return {
        google: [t.title, '', t.lead, '', list, '', 'Kostenloser Sichtbarkeits-Check für Ihre Website auf mw-itservices.de.'].join('\n'),
        linkedin: [t.title, '', t.lead, '', 'Drei Dinge, die sofort helfen:', list, '',
            'Wir bauen und betreuen Websites für Handwerksbetriebe in Augsburg und München. Wie Ihre Website heute dasteht, zeigt der kostenlose Sichtbarkeits-Check: ' + SITE, '', TAGS].join('\n')
    };
}

async function polish(text, channel) {
    if (!AI.available()) return text;
    try {
        return (await AI.write('Überarbeite diesen ' + (channel === 'google' ? 'Beitrag für ein Google-Unternehmensprofil (höchstens 1200 Zeichen)' : 'LinkedIn-Beitrag (höchstens 1300 Zeichen)') +
            ' einer Webagentur für Handwerker sprachlich. Inhalt, Fakten und Aufzählung beibehalten, nichts hinzuerfinden, keine neuen Zahlen. Nur den fertigen Text.\n\n' + text)).trim();
    } catch (err) { console.log('  ! KI: ' + err.message + ', Vorlage bleibt.'); return text; }
}

function browserPath() {
    return [process.env.HARVEY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((x) => fs.existsSync(x));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function cardHtml(t) {
    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1080px;height:1080px}
body{background:radial-gradient(120% 80% at 80% 0%,#3A2A1F 0%,#1E1612 45%,#16110E 100%);color:#F4F0E8;font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;display:flex;flex-direction:column;justify-content:space-between;padding:96px;box-sizing:border-box;position:relative;overflow:hidden}
body:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(97deg,rgba(240,201,166,.025) 0 2px,transparent 2px 9px);pointer-events:none}
.ring{position:absolute;right:-180px;top:-180px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#F0C9A6 0%,#DF9A67 18%,#B56535 42%,#8C4A25 64%,#2D2018 100%);opacity:.55;filter:blur(1px)}
.brand{font:600 26px/1 system-ui,"Segoe UI",sans-serif;letter-spacing:.24em;color:#DF9A67;position:relative}
h1{font-size:76px;line-height:1.06;margin:0 0 36px;max-width:820px;position:relative;background:linear-gradient(180deg,#F4F0E8 0%,#F0C9A6 100%);-webkit-background-clip:text;color:transparent}
ul{list-style:none;margin:0;padding:0;font:400 34px/1.45 system-ui,"Segoe UI",sans-serif;color:#E8DCCD;position:relative}
li{padding-left:52px;position:relative;margin:10px 0}
li:before{content:"";position:absolute;left:0;top:18px;width:26px;height:3px;background:linear-gradient(90deg,#8C4A25,#DF9A67)}
.foot{display:flex;justify-content:space-between;font:500 26px/1 system-ui,"Segoe UI",sans-serif;color:#B9A898;position:relative;border-top:1px solid rgba(240,201,166,.18);padding-top:32px}
</style><div class="ring"></div><div class="brand">MW IT-SERVICES</div>
<div><h1>${esc(t.title)}</h1><ul>${t.points.map((p) => '<li>' + esc(p) + '</li>').join('')}</ul></div>
<div class="foot"><span>Websites für Handwerksbetriebe</span><span>mw-itservices.de</span></div>`;
}

async function card(t, file) {
    const exe = browserPath();
    if (!exe) return null;
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: exe, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
        await page.setContent(cardHtml(t), { waitUntil: 'load' });
        await page.screenshot({ path: file, type: 'png' });
        return file;
    } finally { await browser.close(); }
}

async function main() {
    Store.ensure();
    const week = isoWeek(new Date());
    const prev = (Run.all().content || {}).data || {};
    if (!FORCE && prev.week === week) {
        console.log('Beiträge für ' + week + ' sind schon vorbereitet (neu mit --force).');
        return;
    }
    const used = prev.used || [];
    // jede vierte Woche eine Erfolgsgeschichte, wenn eine Referenz freigegeben ist
    const s = (Number(week.slice(-2)) % 4 === 0) ? story() : null;
    const t = s || TOPICS.find((x) => !used.includes(x.id)) || TOPICS[0];
    const nextUsed = s ? used : (used.length >= TOPICS.length - 1 ? [t.id] : used.concat(t.id));
    const base = texts(t);
    const dir = path.join(__dirname, 'out', 'beitraege', week);
    fs.mkdirSync(dir, { recursive: true });
    let image = null;
    try { image = await card(t, path.join(dir, 'bild.png')); } catch (err) { console.log('  ! Bild nicht erstellt: ' + err.message); }
    const rel = image ? path.relative(__dirname, image).replace(/\\/g, '/') : null;
    const google = await polish(base.google, 'google');
    const linkedin = await polish(base.linkedin, 'linkedin');
    fs.writeFileSync(path.join(dir, 'beitraege.md'), '# ' + t.title + ' (' + week + ')\n\n## Google-Unternehmensprofil\n\n' + google + '\n\n## LinkedIn\n\n' + linkedin + '\n');
    for (const [channel, body] of [['google', google], ['linkedin', linkedin]]) {
        Outbox.add({ key: 'beitrag:' + week + ':' + channel, type: 'beitrag', to: '', subject: (channel === 'google' ? 'Google-Profil: ' : 'LinkedIn: ') + t.title, body, ref: week,
            contactAllowed: 'bestehend', meta: { channel, topic: t.id, week, image: rel, url: channel === 'google' ? SITE : null } });
    }
    const summary = '2 Beiträge für ' + week + ': „' + t.title + '“' + (image ? ' mit Bild' : '');
    console.log('✓ ' + summary + ' → Postausgang' + (rel ? ', Bild: ' + rel : ''));
    Run.done('content', { summary, notes: image ? [] : ['Kein Bild: Chrome oder Edge nicht gefunden (HARVEY_BROWSER in .env)'], data: { week, used: nextUsed, image: rel, title: t.title } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('content', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { TOPICS, texts, isoWeek };
