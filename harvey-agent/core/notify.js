/* =============================================================================
   KASI · Hinweise an Sie selbst (Handy)
   Nur an Ihre eigene Nummer bzw. Ihr eigenes Thema, nie an Kunden.

   .env, eine der Varianten:
     WHATSAPP_PHONE=+4917612345678      eigene Nummer, mit CallMeBot (kostenlos):
     CALLMEBOT_APIKEY=123456            Schlüssel per WhatsApp anfordern, Anleitung und
                                        aktuelle Nummer: https://www.callmebot.com/blog/free-api-whatsapp-messages/
     NTFY_TOPIC=mw-harvey-geheim-8f3k    ntfy.sh-App auf dem Handy, dieses Thema abonnieren
   ============================================================================= */
'use strict';

function channels() {
    const out = [];
    if (process.env.WHATSAPP_PHONE && process.env.CALLMEBOT_APIKEY) out.push('whatsapp');
    if (process.env.NTFY_TOPIC) out.push('ntfy');
    return out;
}

async function send(title, text, { url, priority } = {}) {
    const sent = [];
    const errors = [];
    // Sparsam: nur ein allgemeiner Hinweis ohne Namen, Details stehen in der Zentrale
    if (process.env.HARVEY_NOTIFY_MINIMAL === '1') { text = 'Neuer Hinweis, Details in der Zentrale.'; url = undefined; }
    const msg = (title ? title + '\n' : '') + text + (url ? '\n' + url : '');
    if (process.env.WHATSAPP_PHONE && process.env.CALLMEBOT_APIKEY) {
        try {
            const q = new URLSearchParams({ phone: process.env.WHATSAPP_PHONE, text: msg.slice(0, 1200), apikey: process.env.CALLMEBOT_APIKEY });
            const res = await fetch('https://api.callmebot.com/whatsapp.php?' + q, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error('CallMeBot ' + res.status);
            sent.push('WhatsApp');
        } catch (err) { errors.push('WhatsApp: ' + err.message); }
    }
    if (process.env.NTFY_TOPIC) {
        try {
            const res = await fetch('https://ntfy.sh/' + encodeURIComponent(process.env.NTFY_TOPIC), {
                method: 'POST', body: text.slice(0, 3000),
                headers: { Title: encodeURIComponent(title || 'Kasi').replace(/%20/g, ' '), Priority: priority || 'default', Tags: 'briefcase', ...(url ? { Click: url } : {}) },
                signal: AbortSignal.timeout(15000)
            });
            if (!res.ok) throw new Error('ntfy ' + res.status);
            sent.push('ntfy');
        } catch (err) { errors.push('ntfy: ' + err.message); }
    }
    return { sent, errors };
}

/* WhatsApp-Schnellstart an einen Lead: nur ein Link, den Sie selbst öffnen und absenden */
function waLink(phone, text) {
    let p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('0')) p = '+49' + p.slice(1);
    p = p.replace(/^\+/, '');
    if (p.length < 8) return null;
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
}

module.exports = { channels, send, waLink };
