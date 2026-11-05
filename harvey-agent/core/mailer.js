/* =============================================================================
   KASI · Mailversand (Gmail-Schnittstelle oder SMTP)

   1. Bevorzugt: Google verbunden mit Gmail-Berechtigung (Zentrale → Agenten →
      „Google verbinden“). Dann geht die Mail über die Gmail-Schnittstelle von
      info@mw-itservices.de raus, ohne App-Passwort, und liegt in „Gesendet“.
   2. Sonst SMTP, Zugangsdaten nur in harvey-agent/.env (in .gitignore):
        SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=…  SMTP_PASS=… (App-Passwort)
        SMTP_FROM="MW IT-SERVICES <info@mw-itservices.de>"  MAIL_BCC=… (optional)

   Jede Mail geht als Text und als HTML mit der Signatur (Porträt-GIF, Links).
   ============================================================================= */
'use strict';

const Google = require('./google.js');

const FROM_DEFAULT = 'MW IT-SERVICES <info@mw-itservices.de>';
const SIG_TEXT_START = 'Viele Grüße\nMichael Weichenberger';

function config() {
    const c = {
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465,
        user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM || process.env.SMTP_USER || FROM_DEFAULT, bcc: process.env.MAIL_BCC || ''
    };
    const via = Google.has('gmailSend') ? 'gmail' : 'smtp';
    const missing = via === 'gmail' ? [] : ['host', 'user', 'pass'].filter((k) => !c[k]).map((k) => 'SMTP_' + k.toUpperCase());
    return { c, missing, via };
}

let transport = null;
function smtp(c) {
    if (!transport) {
        let nodemailer;
        try { nodemailer = require('nodemailer'); } catch (err) { throw new Error('nodemailer fehlt: im Ordner harvey-agent „npm install“ ausführen.'); }
        transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
    }
    return transport;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const SIGNATURE_HTML = '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#2D2018;margin-top:4px;">'
    + '<tr><td style="padding:0 0 12px 0;font-size:14px;line-height:20px;">Viele Grüße</td></tr>'
    + '<tr><td style="padding:0 0 10px 0;"><a href="https://mw-itservices.de/?utm_source=email&amp;utm_medium=signatur&amp;utm_campaign=signatur" target="_blank"><img src="https://mw-itservices.de/assets/mail/signatur.gif" width="400" height="104" alt="Michael Weichenberger · MW IT-SERVICES · Websites &amp; Digitalisierung fürs Handwerk" style="display:block;width:400px;height:104px;border:0;"></a></td></tr>'
    + '<tr><td style="font-size:13px;line-height:20px;color:#5B4A3E;"><b style="color:#2D2018;">Michael Weichenberger</b> · MW IT-SERVICES<br>'
    + '<a href="tel:+4915292610572" style="color:#8C4A25;text-decoration:none;">+49 1529 2610572</a> · <a href="mailto:info@mw-itservices.de" style="color:#8C4A25;text-decoration:none;">info@mw-itservices.de</a> · '
    + '<a href="https://mw-itservices.de/?utm_source=email&amp;utm_medium=signatur&amp;utm_campaign=signatur" style="color:#8C4A25;text-decoration:none;">mw-itservices.de</a><br>Deuringer Straße 1 · 86462 Langweid am Lech</td></tr></table>';

/* Text → HTML: Signatur-Block am Ende durch die HTML-Signatur ersetzen, Links klickbar */
function toHtml(text) {
    const i = text.lastIndexOf(SIG_TEXT_START);
    const main = i >= 0 ? text.slice(0, i).trimEnd() : text;
    const html = esc(main).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#8C4A25;">$1</a>').replace(/\n/g, '<br>');
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#2D2018;">' + html + '</div><br>' + (i >= 0 ? SIGNATURE_HTML : '');
}

async function send(entry) {
    const { c, missing, via } = config();
    if (missing.length) throw new Error('Versand nicht eingerichtet: Google verbinden oder ' + missing.join(', ') + ' in harvey-agent/.env');
    const m = entry.meta || {};
    // Antworten im selben Mail-Verlauf halten
    const thread = m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.references || m.inReplyTo } : {};
    const mail = { from: via === 'gmail' ? FROM_DEFAULT : c.from, to: entry.to, bcc: c.bcc || undefined, subject: entry.subject, text: entry.body, html: toHtml(entry.body), ...thread };
    if (via === 'gmail') {
        const MailComposer = require('nodemailer/lib/mail-composer');
        const raw = await new MailComposer(mail).compile().build();
        const r = await Google.gmailSend(raw);
        return { messageId: 'gmail:' + r.id };
    }
    const info = await smtp(c).sendMail(mail);
    return { messageId: info.messageId };
}

async function verify() {
    const { c, via, missing } = config();
    if (missing.length) throw new Error('Versand nicht eingerichtet');
    if (via === 'gmail') { await Google.gmailProfile(); return true; }
    await smtp(c).verify();
    return true;
}

module.exports = { config, send, verify, toHtml };
