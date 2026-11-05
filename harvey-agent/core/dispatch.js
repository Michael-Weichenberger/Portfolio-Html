/* =============================================================================
   KASI · Versand nach Freigabe
   Eine Stelle für alles, was nach „Freigeben & Senden“ rausgeht:
     - Mails über SMTP (core/mailer.js)
     - Antworten auf Google-Bewertungen (öffentlich, core/google.js)
   Wird nur vom Postausgang aufgerufen, nie von einem Agenten.
   ============================================================================= */
'use strict';

const Mailer = require('./mailer.js');

async function send(entry) {
    if (entry.type === 'beitrag') {
        // LinkedIn hat keine freie Schnittstelle: Sie posten selbst, hier wird nur „gepostet“ vermerkt
        if (entry.meta.channel === 'linkedin') return { messageId: 'linkedin:manuell' };
        const Google = require('./google.js');
        const loc = await Google.ownLocation();
        const r = await Google.localPost(loc, entry.body, entry.meta.url);
        return { messageId: 'google-post:' + (r.name || '') };
    }
    if (entry.type === 'bewertung') {
        const Google = require('./google.js');
        await Google.reply(entry.meta.review, entry.body);
        return { messageId: 'google-review:' + entry.meta.review };
    }
    return Mailer.send(entry);
}

/* Was fehlt für den Versand dieses Eintrags? */
function missing(entry) {
    if (entry.type === 'beitrag') {
        if (entry.meta && entry.meta.channel === 'linkedin') return [];
        const Google = require('./google.js');
        return Google.connected() ? [] : ['Google-Verbindung'];
    }
    if (entry.type === 'bewertung') {
        const Google = require('./google.js');
        return Google.connected() ? [] : ['Google-Verbindung'];
    }
    return Mailer.config().missing;
}

module.exports = { send, missing };
