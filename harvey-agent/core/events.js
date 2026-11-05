/* =============================================================================
   KASI · Ereignisprotokoll (data/events.json)
   Alles, was Kasi automatisch erkennt oder ändert, steht hier nachvollziehbar:
   gesendete Mails, erkannte Zahlungen, Antworten von Kunden, Statuswechsel.
   ============================================================================= */
'use strict';

const Store = require('./datastore.js');

const LABEL = {
    mail_sent: 'Mail gesendet',
    payment_matched: 'Zahlung erkannt',
    payment_unmatched: 'Zahlung ohne Zuordnung',
    reply_received: 'Antwort eingegangen',
    invoice_paid: 'Rechnung bezahlt',
    dunning_paused: 'Mahnwesen pausiert',
    reply_classified: 'Antwort eingeordnet',
    site_down: 'Website nicht erreichbar',
    hot_lead: 'Heißer Lead',
    review_replied: 'Bewertung beantwortet',
    review_new: 'Neue Bewertung',
    client_onboarded: 'Onboarding',
    ticket_new: 'Support-Ticket',
    booking_new: 'Neuer Termin',
    booking_moved: 'Termin verschoben',
    booking_cancelled: 'Termin abgesagt'
};

function record(type, data) {
    const ev = Store.load('events');
    ev.push({ at: new Date().toISOString(), type, label: LABEL[type] || type, ...data });
    Store.save('events', ev.slice(-2000));
}

function recent(n = 50) {
    return Store.load('events').slice(-n).reverse();
}

module.exports = { LABEL, record, recent };
