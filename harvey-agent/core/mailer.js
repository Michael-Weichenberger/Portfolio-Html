/* =============================================================================
   KASI · Mailversand über SMTP (Ihr eigenes Postfach, z. B. Google Workspace)

   Zugangsdaten nur in harvey-agent/.env (in .gitignore):
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=465
     SMTP_USER=info@mw-itservices.de
     SMTP_PASS=…              (App-Passwort, nicht das normale Passwort)
     SMTP_FROM="Michael Weichenberger <info@mw-itservices.de>"
     MAIL_BCC=info@mw-itservices.de   (optional: Kopie an sich selbst)

   Warum nicht EmailJS? Die EmailJS-Vorlage der Website schickt Anfragen an Sie;
   für Mails an Kunden aus einem Server-Skript braucht EmailJS einen privaten
   Schlüssel und eine eigene Vorlage. SMTP über Ihr Postfach ist direkter, und
   gesendete Mails landen in Ihrem „Gesendet“-Ordner.
   ============================================================================= */
'use strict';

function config() {
    const c = {
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465,
        user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM || process.env.SMTP_USER, bcc: process.env.MAIL_BCC || ''
    };
    const missing = ['host', 'user', 'pass'].filter((k) => !c[k]).map((k) => 'SMTP_' + k.toUpperCase());
    return { c, missing };
}

let transport = null;
function getTransport() {
    const { c, missing } = config();
    if (missing.length) throw new Error('Versand nicht eingerichtet: ' + missing.join(', ') + ' fehlt in harvey-agent/.env');
    if (!transport) {
        let nodemailer;
        try { nodemailer = require('nodemailer'); } catch (err) { throw new Error('nodemailer fehlt: im Ordner harvey-agent „npm install“ ausführen.'); }
        transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
    }
    return { transport, c };
}

async function send(entry) {
    const { transport: t, c } = getTransport();
    const m = entry.meta || {};
    // Antworten im selben Mail-Verlauf halten
    const thread = m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.references || m.inReplyTo } : {};
    const info = await t.sendMail({ from: c.from, to: entry.to, bcc: c.bcc || undefined, subject: entry.subject, text: entry.body, ...thread });
    return { messageId: info.messageId };
}

async function verify() {
    const { transport: t } = getTransport();
    await t.verify();
    return true;
}

module.exports = { config, send, verify };
