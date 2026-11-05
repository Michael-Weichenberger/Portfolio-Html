#!/usr/bin/env node
/* =============================================================================
   KASI POSTAUSGANG · Vier-Augen-Prinzip für jeden Versand

   npm run send-approval                    Postausgang anzeigen
   npm run send-approval -- --show M-…      eine Mail vollständig anzeigen
   npm run send-approval -- --approve M-…   freigeben (prüft UWG, Empfänger, Platzhalter)
   npm run send-approval -- --discard M-…   verwerfen
   npm run send-approval -- --send          alle freigegebenen senden, jede einzeln bestätigen
   npm run send-approval -- --send M-…      nur diese (muss freigegeben sein)
   npm run send-approval -- --test-smtp     Verbindung zum Postfach prüfen

   Bequemer im Browser: npm run dashboard (Freigeben & Senden per Klick).
   ============================================================================= */
'use strict';

const readline = require('readline');
require('./harvey-worker.js'); // lädt harvey-agent/.env
const Outbox = require('./core/outbox.js');
const Mailer = require('./core/mailer.js');
const Dispatch = require('./core/dispatch.js'); // Mails und Antworten auf Google-Bewertungen
const After = require('./core/after-send.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes('--' + name);
const ICON = { entwurf: '○', freigegeben: '◐', gesendet: '●', verworfen: '×' };

function show(e) {
    console.log('\n' + e.id + ' · ' + Outbox.TYPES[e.type] + ' · ' + e.status + (e.ref ? ' · ' + e.ref : ''));
    console.log('An:      ' + (e.to || '(fehlt)'));
    console.log('Betreff: ' + e.subject);
    console.log('─'.repeat(72));
    console.log(e.body);
    console.log('─'.repeat(72));
    const why = Outbox.blocker(e);
    if (why && e.status !== 'gesendet') console.log('⚠ ' + why);
}

function listAll() {
    const box = Outbox.all().filter((e) => has('all') || e.status !== 'verworfen');
    if (!box.length) return console.log('Postausgang leer. Entwürfe entstehen durch npm run billing und npm run scout.');
    box.forEach((e) => console.log([ICON[e.status] + ' ' + e.id, e.status.padEnd(11), Outbox.TYPES[e.type].padEnd(9), (e.to || '–').slice(0, 30).padEnd(30), e.subject.slice(0, 60)].join('  ')));
    console.log('\n○ Entwurf  ◐ freigegeben  ● gesendet · Details: --show <id> · Freigeben: --approve <id> · Senden: --send');
}

function ask(q) {
    if (!process.stdin.isTTY) return Promise.resolve('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim().toLowerCase()); }));
}

async function sendOne(e) {
    show(e);
    const yes = has('yes') ? 'j' : await ask('Diese Mail jetzt an ' + e.to + ' senden? [j/N] ');
    if (yes !== 'j' && yes !== 'ja') return console.log('· übersprungen' + (process.stdin.isTTY ? '' : ' (keine Konsole: im Dashboard oder mit --yes bestätigen)'));
    try {
        const info = await Dispatch.send(e);
        Outbox.markSent(e.id, info);
        await After.afterSend(e);
        console.log('✓ gesendet an ' + e.to);
    } catch (err) {
        Outbox.markFailed(e.id, err.message);
        console.error('✗ ' + err.message);
    }
}

(async function main() {
    try {
        if (has('show')) return show(Outbox.all().find((e) => e.id === opt('show')) || (() => { throw new Error('nicht gefunden'); })());
        if (has('approve')) { const e = Outbox.approve(opt('approve'), 'Konsole'); return console.log('✓ ' + e.id + ' freigegeben. Senden: npm run send-approval -- --send ' + e.id); }
        if (has('discard')) { Outbox.discard(opt('discard')); return console.log('✓ verworfen'); }
        if (has('test-smtp')) { await Mailer.verify(); return console.log('✓ SMTP-Verbindung in Ordnung.'); }
        if (has('send')) {
            const id = opt('send');
            const todo = Outbox.all().filter((e) => e.status === 'freigegeben' && (!id || id.startsWith('--') || e.id === id));
            if (!todo.length) return console.log('Nichts freigegeben. Erst --approve <id>.');
            for (const e of todo) await sendOne(e);
            return;
        }
        listAll();
    } catch (err) {
        console.error('✗ ' + err.message);
        process.exitCode = 1;
    }
}());
