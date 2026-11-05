#!/usr/bin/env node
/* =============================================================================
   KASI · Bank verbinden (Enable Banking, nur Lesezugriff)

   npm run bank -- --status
   npm run bank -- --banks                     Liste deutscher Banken
   npm run bank -- --connect "Sparkasse Augsburg"
   npm run bank -- --code "<Adresse der Zielseite nach der Freigabe>"
   npm run bank -- --sync                      Eingänge jetzt abgleichen (macht sonst der Monitor)
   ============================================================================= */
'use strict';

require('./harvey-worker.js');
const Bank = require('./core/bank.js');
const Store = require('./core/datastore.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes('--' + n);

(async () => {
    Store.ensure();
    if (has('banks')) {
        const q = (opt('banks') || '').toLowerCase();
        (await Bank.banks('DE')).filter((n) => !q || n.toLowerCase().includes(q)).forEach((n) => console.log('· ' + n));
        return;
    }
    if (has('connect')) {
        const url = await Bank.connect(opt('connect'));
        console.log('1. Diesen Link im Browser öffnen und bei der Bank freigeben:\n   ' + url);
        console.log('2. Danach die komplette Adresse der Zielseite kopieren und ausführen:\n   npm run bank -- --code "<Adresse>"');
        return;
    }
    if (has('code')) {
        const acc = await Bank.finish(opt('code'));
        console.log('✓ Verbunden: ' + acc.length + ' Konto/Konten. Der Monitor gleicht Eingänge ab jetzt automatisch ab.');
        return;
    }
    if (has('sync')) {
        const { matchPayments } = require('./monitor-agent.js');
        const txs = await Bank.incoming();
        const r = matchPayments(txs, 'Bank');
        console.log('Bank: ' + r.total + ' Eingänge, ' + r.matched + ' zugeordnet' + (r.skipped ? ', ' + r.skipped + ' schon bekannt' : ''));
        return;
    }
    console.log(JSON.stringify(Bank.status(), null, 2));
})().catch((err) => { console.error('✗ ' + err.message); process.exit(1); });
