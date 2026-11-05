/* =============================================================================
   KASI · Folgen eines tatsächlich gesendeten Mails
   Mahnung gesendet → Mahnstufe in invoices.json eintragen.
   Akquise gesendet → Status in leads.json auf „angeschrieben“.
   ============================================================================= */
'use strict';

const Store = require('./datastore.js');
const Events = require('./events.js');

async function afterSend(e) {
    const today = new Date().toISOString().slice(0, 10);
    if (e.type === 'mahnung' && e.meta && e.meta.invoice) {
        const invoices = Store.load('invoices');
        const inv = invoices.find((i) => i.number === e.meta.invoice);
        if (inv) {
            inv.reminders = (inv.reminders || []).filter((r) => r.stage !== e.meta.stage).concat({ stage: e.meta.stage, sentAt: today, outboxId: e.id });
            Store.save('invoices', invoices);
        }
    }
    if (e.type === 'akquise' && e.ref) {
        const leads = Store.load('leads');
        const l = leads.find((x) => x.domain === e.ref);
        if (l && ['neu', 'gemessen'].includes(l.status)) { l.status = 'angeschrieben'; l.contactedAt = today; Store.save('leads', leads); }
    }
    if (e.type === 'nachfass' && e.meta && e.meta.cloudId) {
        // im Web-Dashboard im Verlauf vermerken (best effort, ohne Netz kein Fehler)
        try { await require('./cloud.js').log(e.meta.cloudId, 'nachfass', 'Nachfass-Mail ' + (e.meta.stage || '') + ' gesendet: ' + e.subject); } catch (err) { /* später sichtbar im lokalen Protokoll */ }
    }
    if (e.type === 'bewertung') {
        Events.record('review_replied', { outboxId: e.id, name: e.meta && e.meta.location, ref: e.meta && e.meta.review });
        return;
    }
    Events.record('mail_sent', { outboxId: e.id, type: e.type, to: e.to, ref: e.ref });
}

module.exports = { afterSend };
