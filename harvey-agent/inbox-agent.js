#!/usr/bin/env node
/* =============================================================================
   KASI · Posteingangs-Assistent

   npm run inbox            neue Mails von bekannten Kontakten einordnen, Antworten vorschreiben
   npm run inbox -- --days 3

   Mails von Bestandskunden werden Support-Tickets (core/support.js).
   Liest nur Mails von bekannten Kontakten (Kunden, Leads, Empfänger Ihrer
   gesendeten Mails, Anfragen aus dem Web-Dashboard). Alle anderen Mails
   bleiben unberührt. Pro Mail:
     1. Einordnen: Interesse, Terminwunsch, Rückfrage, Absage, Zahlung, Beschwerde, Sonstiges
     2. Antwort-Entwurf in den Postausgang (Typ „Antwort“, im selben Verlauf)
     3. Verlauf im Web-Dashboard ergänzen, bei Interesse/Termin Hinweis aufs Handy

   Mit ANTHROPIC_API_KEY: Einordnung (schnelles Modell) und Entwurf per KI.
   Ohne Schlüssel: Einordnung nach Stichworten, kein Entwurf, nur Hinweis.
   Gespeichert werden nur Kurzfassung und Entwurf, nicht der Mailtext.
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const Store = require('./core/datastore.js');
const Outbox = require('./core/outbox.js');
const Drafts = require('./core/drafts.js');
const Events = require('./core/events.js');
const AI = require('./core/ai.js');
const Cloud = require('./core/cloud.js');
const Notify = require('./core/notify.js');
const Run = require('./core/runlog.js');
const Support = require('./core/support.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const CATS = { interesse: 'Interesse', termin: 'Terminwunsch', rueckfrage: 'Rückfrage', absage: 'Absage', zahlung: 'Zahlung', beschwerde: 'Beschwerde', sonstiges: 'Sonstiges' };
const RULES = [
    ['absage', /(?<![a-zäöüß])(kein interesse|nicht interessiert|absage|abmelden|bitte keine|nicht mehr kontaktieren|haben uns (anders|für einen anderen) entschieden)(?![a-zäöüß])/i],
    ['zahlung', /(?<![a-zäöüß])(überwiesen|bezahlt|zahlung (ist|wurde)|beglichen|lastschrift)(?![a-zäöüß])/i],
    ['beschwerde', /(?<![a-zäöüß])(beschwerde|unzufrieden|ärgerlich|funktioniert nicht|geht nicht|fehler auf der (seite|website))(?![a-zäöüß])/i],
    ['termin', /(?<![a-zäöüß])(termin|rückruf|ruf(en sie)? (mich )?an|telefonieren|wann (passt|haben sie)|treffen)(?![a-zäöüß])/i],
    ['interesse', /(?<![a-zäöüß])(interesse|angebot (passt|annehmen)|machen wir|gerne starten|auftrag|beauftragen|klingt gut)(?![a-zäöüß])/i],
    ['rueckfrage', /\?/]
];

function stripQuote(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const cut = lines.findIndex((l) => /^>/.test(l) || /^(Am|On) .{5,80}(schrieb|wrote).*:$/.test(l.trim()) || /^-{2,}\s*(Ursprüngliche|Original) Nachricht/i.test(l.trim()));
    return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim().slice(0, 4000);
}

async function knownContacts() {
    const known = new Map();
    const add = (email, v) => { if (email && !known.has(email.toLowerCase())) known.set(email.toLowerCase(), v); };
    Store.load('clients').forEach((c) => add(c.email, { kind: 'Kunde', name: c.company, id: c.id, client: c }));
    Store.load('leads').forEach((l) => add(l.email, { kind: 'Lead', name: l.name, id: l.domain }));
    try {
        (await Cloud.query('SELECT id, name, email FROM leads WHERE email IS NOT NULL')).forEach((r) => add(r.email, { kind: 'Anfrage', name: r.name, id: r.id, cloudId: r.id }));
    } catch (err) { console.log('! Web-Dashboard nicht abrufbar: ' + err.message); }
    Outbox.all().filter((e) => e.status === 'gesendet' && e.to).forEach((e) => add(e.to, { kind: 'Kontakt', name: (e.meta && e.meta.client) || e.to, id: e.ref }));
    return known;
}

async function classify(from, subject, text) {
    if (AI.available()) {
        try {
            return await AI.json('Ordne diese Antwort eines (möglichen) Kunden einer Webagentur ein. Betreff: ' + subject + '\n\nText:\n' + text, {
                type: 'object', additionalProperties: false, required: ['category', 'summary', 'urgent'],
                properties: {
                    category: { type: 'string', enum: Object.keys(CATS) },
                    summary: { type: 'string', description: 'ein Satz, worum es geht, ohne Personendaten außer dem Firmennamen' },
                    urgent: { type: 'boolean', description: 'braucht heute eine Reaktion' }
                }
            }, { fast: true });
        } catch (err) { console.log('  ! KI-Einordnung: ' + err.message); }
    }
    const hit = RULES.find(([, re]) => re.test(subject + '\n' + text));
    return { category: hit ? hit[0] : 'sonstiges', summary: String(subject || '').slice(0, 140), urgent: hit ? ['termin', 'beschwerde'].includes(hit[0]) : false, rule: true };
}

async function draftReply(who, subject, text, cls, lastSent) {
    if (!AI.available() || cls.category === 'zahlung') return null;
    try {
        const body = await AI.write([
            'Schreibe eine Antwort-Mail auf die folgende Nachricht. Nur der Text ab der Anrede, ohne Betreff, ohne Signatur, höchstens 140 Wörter.',
            'Einordnung: ' + CATS[cls.category] + '. Bei Absage: kurz bedanken, Tür offen lassen, nicht überreden. Bei Terminwunsch: zwei Zeitfenster als [BITTE PRÜFEN] markieren oder auf den Buchungslink verweisen. Bei Beschwerde: ernst nehmen, konkrete nächste Schritte, keine Schuldzuweisung.',
            'Absender: ' + who.name + ' (' + who.kind + ').',
            lastSent ? 'Unsere letzte Mail an diese Person (Betreff): ' + lastSent.subject : '',
            'Nachricht (Betreff: ' + subject + '):\n' + text
        ].filter(Boolean).join('\n'));
        return 'Guten Tag,\n\n' + body.replace(/^Guten Tag,?\s*/i, '').trim() + '\n\n' + Drafts.SIGNATURE;
    } catch (err) { console.log('  ! KI-Entwurf: ' + err.message); return null; }
}

async function main() {
    Store.ensure();
    const Mailbox = require('./core/mailbox.js');
    if (!Mailbox.mode()) {
        console.log('Postfach nicht eingerichtet: Google verbinden (mit Gmail) oder IMAP_USER/IMAP_PASS in .env.');
        return Run.done('inbox', { ok: false, summary: 'Postfach nicht eingerichtet (Google verbinden oder IMAP in .env)' });
    }
    const { simpleParser } = require('mailparser');
    const prev = (Run.all().inbox || {}).data || {};
    const seen = new Set(prev.seen || []);
    const since = new Date(Date.now() - (Number(opt('days')) || 2) * 86400000);
    const known = await knownContacts();
    const own = await Mailbox.own();
    const notes = [];
    let handled = 0;
    {
        {
            const list = [];
            for (const msg of await Mailbox.recent(since, 100)) {
                if (!msg.from || msg.from === own || !known.has(msg.from)) continue;
                const id = msg.messageId || 'mail:' + msg.id;
                if (!seen.has(id)) list.push({ uid: msg.id, from: msg.from, id, subject: msg.subject || '' });
            }
            for (const m of list.slice(0, 25)) {
                const parsed = await simpleParser(await Mailbox.source(m.uid));
                const text = stripQuote(parsed.text || '');
                const who = known.get(m.from);
                if (who.kind === 'Kunde' && who.client) {
                    // Bestandskunde: Support-Ticket statt Vertriebs-Einordnung
                    const { ticket, draft } = await Support.triage({ client: who.client, from: m.from, subject: m.subject, text, messageId: m.id });
                    if (draft) {
                        const greet = who.client.salutation && who.client.salutation !== 'Guten Tag' ? who.client.salutation + ',' : 'Guten Tag,';
                        Outbox.add({ key: 'support:' + m.id, type: 'support', to: m.from, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, body: [greet, '', draft, '', Drafts.SIGNATURE].join('\n'), ref: ticket.id,
                            contactAllowed: 'bestehend', meta: { client: who.name, ticket: ticket.id, category: ticket.category, inReplyTo: m.id, references: [parsed.references].flat().filter(Boolean).concat(m.id).join(' ') } });
                    }
                    Events.record('ticket_new', { name: who.name, label: Support.CATS[ticket.category] + ' (' + ticket.priority + '): ' + ticket.summary, kind: 'Kunde' });
                    if (ticket.priority === 'hoch') await Notify.send('Kasi: Support dringend', who.name + ': ' + Support.CATS[ticket.category] + (ticket.check ? (ticket.check.ok ? ' (Seite von hier erreichbar)' : ' (Störung bestätigt)') : ''), { priority: 'high' });
                    notes.push('Ticket ' + ticket.id + ' · ' + who.name + ': ' + Support.CATS[ticket.category] + ' (' + ticket.priority + ')' + (draft ? ', Lösungsvorschlag im Postausgang' : ''));
                    console.log('🎫 ' + Support.CATS[ticket.category] + ' · ' + who.name + ' (' + ticket.priority + ')' + (draft ? ' → Vorschlag' : ''));
                    seen.add(m.id);
                    handled++;
                    continue;
                }
                const cls = await classify(m.from, m.subject, text);
                const lastSent = Outbox.all().filter((e) => e.status === 'gesendet' && e.to && e.to.toLowerCase() === m.from).pop();
                const body = await draftReply(who, m.subject, text, cls, lastSent);
                if (body) {
                    Outbox.add({ key: 'inbox:' + m.id, type: 'antwort', to: m.from, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, body, ref: who.id || m.from,
                        contactAllowed: 'bestehend', meta: { client: who.name, category: cls.category, summary: cls.summary, inReplyTo: m.id, references: [parsed.references].flat().filter(Boolean).concat(m.id).join(' ') } });
                }
                Events.record('reply_classified', { name: who.name, label: CATS[cls.category] + ': ' + cls.summary, kind: who.kind });
                if (who.cloudId) { try { await Cloud.log(who.cloudId, 'antwort', CATS[cls.category] + ': ' + cls.summary); } catch (err) { /* offline */ } }
                if (cls.urgent || ['interesse', 'termin'].includes(cls.category)) await Notify.send('Kasi: ' + CATS[cls.category], who.name + ': ' + cls.summary + (body ? '\nAntwort-Entwurf liegt im Postausgang.' : ''), { priority: 'high' });
                notes.push(CATS[cls.category] + ' · ' + who.name + ': ' + cls.summary + (body ? ' (Entwurf im Postausgang)' : ''));
                console.log('✉ ' + CATS[cls.category] + ' · ' + who.name + ': ' + cls.summary + (body ? ' → Entwurf' : ''));
                seen.add(m.id);
                handled++;
            }
        }
    }
    const summary = handled ? handled + ' Mails eingeordnet' + (AI.available() ? '' : ' (ohne KI, nur Stichworte)') : 'Keine neuen Mails von bekannten Kontakten';
    console.log(summary);
    Run.done('inbox', { summary, notes, data: { seen: [...seen].slice(-1000) } });
}

if (require.main === module) main().catch((err) => { console.error('✗ ' + err.message); Run.done('inbox', { ok: false, summary: err.message }); process.exit(1); });
module.exports = { main, stripQuote, classify };
