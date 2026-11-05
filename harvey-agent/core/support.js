/* =============================================================================
   KASI · Support-Tickets von Bestandskunden (data/tickets.json)
   Aufgerufen vom Posteingangs-Assistenten, wenn eine Mail von einem Kunden
   kommt. Pro Mail: Thema und Dringlichkeit bestimmen, bei „Website geht
   nicht“ die Seite sofort selbst prüfen, Ticket anlegen und für
   Standardfragen einen Lösungsvorschlag als Entwurf in den Postausgang legen.
   Gesendet wird nichts ohne Ihre Freigabe.
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const Store = require('./datastore.js');
const AI = require('./ai.js');

const CATS = { ausfall: 'Website nicht erreichbar', fehler: 'Fehler auf der Website', aenderung: 'Änderungswunsch', email: 'E-Mail / Postfach', rechnung: 'Rechnung', frage: 'Frage', sonstiges: 'Sonstiges' };
const PRIO = { hoch: 'hoch', normal: 'normal', niedrig: 'niedrig' };
const RULES = [
    ['ausfall', /(?<![a-zäöüß])(nicht (mehr )?erreichbar|website (ist )?(weg|down|offline)|seite (geht|lädt) nicht|server not found|fehler 50\d|weiße seite)(?![a-zäöüß])/i],
    ['fehler', /(?<![a-zäöüß])(fehler|kaputt|funktioniert nicht|geht nicht|formular .*nicht|bild(er)? fehlt|verrutscht)(?![a-zäöüß])/i],
    ['email', /(?<![a-zäöüß])(e-?mail|postfach|outlook|spam|mails? kommen nicht)(?![a-zäöüß])/i],
    ['rechnung', /(?<![a-zäöüß])(rechnung|zahlung|lastschrift|mahnung|gutschrift)(?![a-zäöüß])/i],
    ['aenderung', /(?<![a-zäöüß])(ändern|änderung|aktualisieren|austauschen|neue[sn]? (foto|bild|text|seite)|öffnungszeiten|preise anpassen|hinzufügen)(?![a-zäöüß])/i],
    ['frage', /\?/]
];

const now = () => new Date().toISOString();
const all = () => { const t = Store.load('tickets'); return Array.isArray(t) ? t : []; };

async function classify(subject, text) {
    if (AI.available()) {
        try {
            return await AI.json('Ordne diese Support-Mail eines Bestandskunden einer Webagentur ein. Betreff: ' + subject + '\n\nText:\n' + text, {
                type: 'object', additionalProperties: false, required: ['category', 'priority', 'summary'],
                properties: {
                    category: { type: 'string', enum: Object.keys(CATS) },
                    priority: { type: 'string', enum: Object.keys(PRIO), description: 'hoch: Website/Formular/Mail ausgefallen oder Geld/Recht betroffen; niedrig: kann warten' },
                    summary: { type: 'string', description: 'ein Satz, worum es geht' }
                }
            }, { fast: true });
        } catch (err) { console.log('  ! KI-Einordnung: ' + err.message); }
    }
    const hit = RULES.find(([, re]) => re.test(subject + '\n' + text));
    const category = hit ? hit[0] : 'sonstiges';
    const urgent = /\b(dringend|sofort|asap|eilig|heute noch)\b/i.test(subject + ' ' + text);
    return { category, priority: ['ausfall'].includes(category) || urgent ? 'hoch' : ['fehler', 'email'].includes(category) ? 'normal' : 'niedrig', summary: String(subject || '').slice(0, 140), rule: true };
}

/* Die Seite des Kunden selbst prüfen (nur HTTP, kein Login) */
async function check(domain) {
    const t0 = Date.now();
    try {
        const res = await fetch('https://' + domain + '/', { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'MW-Kasi-Support/1.0' } });
        return { domain, ok: res.ok, status: res.status, ms: Date.now() - t0, at: now() };
    } catch (err) {
        return { domain, ok: false, status: 0, error: String(err.cause ? err.cause.code || err.message : err.message).slice(0, 80), ms: Date.now() - t0, at: now() };
    }
}

const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
/* Lösungsvorschlag für Standardfälle. Platzhalter verhindern das Senden, bis Sie geprüft haben. */
function proposal(cat, client, chk) {
    const site = chk ? chk.domain : ((client.domains || [])[0] || 'Ihre Website');
    switch (cat) {
    case 'ausfall':
        return chk && chk.ok
            ? 'danke für Ihren Hinweis. Ich habe ' + site + ' gerade (' + time(chk.at) + ' Uhr) geprüft: Die Seite ist von hier aus erreichbar und lädt in ' + (chk.ms / 1000).toFixed(1).replace('.', ',') + ' Sekunden.\n\nOft hilft es, die Seite neu zu laden (Strg + F5) oder es kurz mit dem Handy über mobile Daten statt WLAN zu versuchen. Wenn sie bei Ihnen weiterhin nicht lädt, schicken Sie mir bitte ein Foto der Fehlermeldung; dann schaue ich mir das sofort genauer an.'
            : 'danke für Ihren Hinweis. Ich habe ' + site + ' geprüft und sehe die Störung ebenfalls' + (chk && chk.status ? ' (Fehler ' + chk.status + ')' : '') + '. Ich kümmere mich jetzt darum und melde mich, sobald die Seite wieder läuft, spätestens um [BITTE EINTRAGEN: Uhrzeit].';
    case 'aenderung':
        return 'danke, Ihr Änderungswunsch ist angekommen. Ich setze ihn bis [BITTE EINTRAGEN: Datum] um und gebe Ihnen Bescheid, sobald er online ist. Falls Fotos oder Texte dazugehören, schicken Sie mir diese gern einfach als Antwort auf diese Mail.';
    case 'email':
        return 'danke für Ihre Nachricht. Damit ich das Problem mit den E-Mails schnell eingrenzen kann: Betrifft es alle Adressen oder nur eine, und seit wann tritt es auf? Hilfreich ist auch, ob die Mails im Spam-Ordner landen oder gar nicht ankommen. Bitte ändern Sie bis dahin keine Passwörter oder Einstellungen am Postfach.';
    case 'rechnung':
        return 'danke für Ihre Nachricht zur Rechnung. Ich prüfe das und melde mich bis [BITTE EINTRAGEN: Datum] bei Ihnen.';
    case 'fehler':
        return 'danke für den Hinweis auf den Fehler. Damit ich ihn nachstellen kann: Auf welcher Seite tritt er auf, und nutzen Sie Handy oder Computer? Ein Bildschirmfoto hilft sehr. Ich schaue mir das bis [BITTE EINTRAGEN: Datum] an.';
    default:
        return null; // Fragen und Sonstiges beantworten Sie selbst
    }
}

/* Ticket anlegen. Rückgabe: { ticket, draft } (draft = Text ab der Anrede oder null) */
async function triage({ client, from, subject, text, messageId }) {
    const tickets = all();
    const existing = tickets.find((t) => t.messageId === messageId);
    if (existing) return { ticket: existing, draft: null };
    const cls = await classify(subject, text);
    let chk = null;
    if (['ausfall', 'fehler'].includes(cls.category) && (client.domains || [])[0]) chk = await check(client.domains[0]);
    if (cls.category === 'ausfall' && chk && !chk.ok) cls.priority = 'hoch';
    const ticket = {
        id: 'T-' + crypto.randomBytes(3).toString('hex'), status: 'offen', createdAt: now(), clientId: client.id, client: client.company, from, subject: String(subject || '').slice(0, 200),
        category: cls.category, priority: cls.priority, summary: cls.summary, check: chk, messageId, rule: !!cls.rule
    };
    tickets.unshift(ticket);
    Store.save('tickets', tickets.slice(0, 500));
    return { ticket, draft: proposal(cls.category, client, chk) };
}

function setStatus(id, status) {
    if (!['offen', 'in_arbeit', 'erledigt'].includes(status)) throw new Error('Unbekannter Status');
    const tickets = all();
    const t = tickets.find((x) => x.id === id);
    if (!t) throw new Error('Ticket nicht gefunden');
    t.status = status;
    t.updatedAt = now();
    if (status === 'erledigt') t.doneAt = now();
    Store.save('tickets', tickets);
    return t;
}

module.exports = { CATS, PRIO, all, triage, setStatus, check, classify };
