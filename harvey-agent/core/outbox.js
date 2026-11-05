/* =============================================================================
   KASI · Postausgang mit Vier-Augen-Prinzip (data/outbox.json)

   Ablauf je Mail:  entwurf → freigegeben → gesendet   (oder: verworfen)
   - Kasi legt nur Entwürfe an (Mahnungen, Akquise bei Einwilligung, Angebote).
   - Freigeben und Senden sind zwei getrennte, bewusste Schritte von Ihnen.
   - Wird ein freigegebener Text geändert, fällt er zurück auf „entwurf“.
   - Akquise-Mails gehen nur bei Einwilligung oder bestehendem Kontakt (§ 7 UWG).
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const Store = require('./datastore.js');

const TYPES = { mahnung: 'Mahnung', akquise: 'Akquise', angebot: 'Angebot', nachfass: 'Nachfass', antwort: 'Antwort', report: 'Report', bewertung: 'Bewertung', support: 'Support', willkommen: 'Willkommen', beitrag: 'Beitrag', termin: 'Termin', sonstiges: 'Sonstiges' };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$/i;
const now = () => new Date().toISOString();

function all() { return Store.load('outbox'); }

/* Entwurf anlegen. Mit key wird ein bestehender, noch nicht freigegebener Entwurf aktualisiert. */
function add(e) {
    const box = all();
    const existing = e.key ? box.find((x) => x.key === e.key && x.status !== 'verworfen') : null;
    if (existing) {
        if (existing.status === 'entwurf') Object.assign(existing, { to: e.to || existing.to, subject: e.subject, body: e.body, updatedAt: now() });
        Store.save('outbox', box);
        return existing;
    }
    const entry = {
        id: 'M-' + crypto.randomBytes(4).toString('hex'),
        key: e.key || null,
        type: TYPES[e.type] ? e.type : 'sonstiges',
        status: 'entwurf',
        to: e.to || '',
        subject: String(e.subject || '').slice(0, 300),
        body: String(e.body || '').slice(0, 30000),
        ref: e.ref || null,
        contactAllowed: e.contactAllowed || null,
        meta: e.meta || {},
        createdAt: now(),
        history: [{ at: now(), action: 'angelegt' }]
    };
    box.push(entry);
    Store.save('outbox', box);
    return entry;
}

/* Darf diese Mail überhaupt per E-Mail raus? Gibt den Grund zurück, wenn nicht. */
function blocker(e) {
    // Antwort auf eine Google-Bewertung: wird öffentlich im Unternehmensprofil veröffentlicht, keine Mail
    if (e.type === 'bewertung') {
        if (!e.meta || !e.meta.review) return 'Bewertung nicht zugeordnet.';
        if (!e.body || e.body.length < 10) return 'Antworttext fehlt.';
        if (e.body.length > 4000) return 'Antwort ist zu lang (höchstens 4000 Zeichen).';
        if (/BITTE (EINTRAGEN|PRÜFEN)/.test(e.body)) return 'Im Text stehen noch Platzhalter.';
        return null;
    }
    // Beitrag für Google-Unternehmensprofil (öffentlich) oder LinkedIn (Sie posten selbst)
    if (e.type === 'beitrag') {
        if (!e.meta || !['google', 'linkedin'].includes(e.meta.channel)) return 'Kanal fehlt.';
        if (!e.body || e.body.length < 40) return 'Beitragstext fehlt.';
        if (e.meta.channel === 'google' && e.body.length > 1500) return 'Google erlaubt höchstens 1500 Zeichen.';
        if (e.body.length > 3000) return 'Beitrag ist zu lang (höchstens 3000 Zeichen).';
        if (/BITTE (EINTRAGEN|PRÜFEN)/.test(e.body)) return 'Im Text stehen noch Platzhalter.';
        return null;
    }
    if (!EMAIL_RE.test(e.to || '')) return 'Keine gültige Empfänger-Adresse.';
    if (!e.subject || !e.body) return 'Betreff oder Text fehlt.';
    if (e.type === 'akquise' && !['einwilligung', 'bestehend'].includes(e.contactAllowed)) {
        return 'Akquise ohne Einwilligung oder bestehenden Kontakt: nur per Brief (§ 7 UWG).';
    }
    if (/BITTE (EINTRAGEN|PRÜFEN)/.test(e.body)) return 'Im Text stehen noch Platzhalter („BITTE EINTRAGEN“ oder „[BITTE PRÜFEN]“).';
    return null;
}

function change(id, fn) {
    const box = all();
    const e = box.find((x) => x.id === id);
    if (!e) throw new Error('Mail ' + id + ' nicht gefunden.');
    fn(e);
    e.updatedAt = now();
    Store.save('outbox', box);
    return e;
}

function edit(id, patch) {
    return change(id, (e) => {
        if (e.status === 'gesendet') throw new Error('Bereits gesendet, nicht mehr änderbar.');
        let changed = false;
        ['to', 'subject', 'body'].forEach((k) => {
            if (typeof patch[k] === 'string' && patch[k] !== e[k]) { e[k] = patch[k].slice(0, k === 'body' ? 30000 : 300); changed = true; }
        });
        if (changed && e.status === 'freigegeben') { e.status = 'entwurf'; e.history.push({ at: now(), action: 'geändert, Freigabe zurückgenommen' }); }
        else if (changed) e.history.push({ at: now(), action: 'geändert' });
    });
}

function approve(id, by) {
    return change(id, (e) => {
        if (e.status !== 'entwurf') throw new Error('Nur Entwürfe können freigegeben werden (Status: ' + e.status + ').');
        const why = blocker(e);
        if (why) throw new Error(why);
        e.status = 'freigegeben';
        e.approvedAt = now();
        e.history.push({ at: now(), action: 'freigegeben' + (by ? ' (' + by + ')' : '') });
    });
}

function discard(id) {
    return change(id, (e) => {
        if (e.status === 'gesendet') throw new Error('Bereits gesendet.');
        e.status = 'verworfen';
        e.history.push({ at: now(), action: 'verworfen' });
    });
}

function markSent(id, info) {
    return change(id, (e) => {
        e.status = 'gesendet';
        e.sentAt = now();
        e.messageId = info && info.messageId;
        e.history.push({ at: now(), action: 'gesendet' });
    });
}

function markFailed(id, msg) {
    return change(id, (e) => { e.history.push({ at: now(), action: 'Versand fehlgeschlagen: ' + String(msg).slice(0, 160) }); });
}

module.exports = { TYPES, all, add, blocker, edit, approve, discard, markSent, markFailed };
