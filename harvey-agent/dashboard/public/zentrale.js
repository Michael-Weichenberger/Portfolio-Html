/* =============================================================================
   KASI ZENTRALE · Oberfläche (lokal)
   Bereiche: Zentrale (Bento mit Orb und Postausgang) · Leads & Scout ·
   Finanzen & Mahnwesen · Termine · Kunden & Stammdaten
   Alle Texte werden nur über textContent gesetzt.
   ============================================================================= */
(function () {
    'use strict';

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const euro = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
    const euro0 = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
    const de = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '–');
    const when = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const hm = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const STATUS = { good: 'Gut', warn: 'Verbesserbar', bad: 'Kritisch', pending: 'offen' };
    const TYPE = { mahnung: 'Mahnung', akquise: 'Akquise', angebot: 'Angebot', nachfass: 'Nachfass', antwort: 'Antwort', report: 'Bericht', bewertung: 'Bewertung', support: 'Support', willkommen: 'Willkommen', beitrag: 'Beitrag', sonstiges: 'Mail' };
    const STAGE = { 1: 'Erinnerung', 2: 'Zahlungsaufforderung', 3: 'Letzte Mahnung' };
    const MAIL_STATE = { entwurf: 'Entwurf', freigegeben: 'freigegeben', gesendet: 'gesendet' };
    const LEAD_STATE = { neu: 'neu', gemessen: 'gemessen', angeschrieben: 'angeschrieben', antwort: 'Antwort erhalten', termin: 'Termin', kunde: 'Kunde', abgelegt: 'abgelegt', gesendet: 'Angebot raus', auftrag: 'Kunde', in_arbeit: 'in Arbeit' };

    let data = null;
    let agenda = null;
    let outboxFilter = 'open';
    const open = new Set();      // aufgeklappte Mails
    const drafts = new Map();    // ungespeicherte Änderungen je Mail-ID

    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        });
        kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c)); });
        return el;
    }
    const empty = (text, sub) => h('div', { class: 'empty' }, h('p', { text }), sub ? h('p', { class: 'muted small', text: sub }) : null);

    let toastT = null;
    function toast(msg, err) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.toggle('is-error', !!err);
        t.hidden = false;
        clearTimeout(toastT);
        toastT = setTimeout(() => { t.hidden = true; }, err ? 7000 : 3200);
    }

    async function api(path, body) {
        const res = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Harvey': '1' }, body: JSON.stringify(body) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Fehler ' + res.status);
        return d;
    }

    /* ---------- Navigation ---------- */
    const TABS = ['zentrale', 'leads', 'finanzen', 'termine', 'agenten', 'marketing', 'stammdaten'];
    const ALIAS = { dashboard: 'zentrale', kunden: 'stammdaten' };
    function route() {
        let id = (location.hash || '#zentrale').slice(1);
        id = ALIAS[id] || id;
        if (!TABS.includes(id)) id = 'zentrale';
        $$('.view').forEach((v) => { v.hidden = v.id !== id; });
        $$('.tabs a').forEach((a) => {
            const on = a.dataset.tab === id;
            a.classList.toggle('is-active', on);
            if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        window.scrollTo(0, 0);
    }
    function go(tab, anchor) {
        // Postausgang ist im Modus „Agenten“ ausgeblendet: dann in den Fokus wechseln
        if (anchor === 'postausgang' && $('#hud').dataset.mode === 'agenten') setMode('fokus');
        if (('#' + tab) !== location.hash) location.hash = '#' + tab; else route();
        if (anchor) setTimeout(() => { const el = document.getElementById(anchor); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 40);
    }

    function setCount(name, n) {
        const b = $('[data-count="' + name + '"]');
        if (b) b.textContent = n ? String(n) : '';
    }

    function tick() {
        const now = new Date();
        $('#clock').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        $('#clock').setAttribute('datetime', now.toISOString());
    }

    /* ---------- Einrichtung ---------- */
    function renderSetup() {
        const todo = data.setup.filter((s) => !s.ok);
        const box = $('#setup');
        box.hidden = !todo.length;
        setCount('setup', todo.filter((s) => s.action === 'stammdaten').length);
        if (!todo.length) return box.replaceChildren();
        box.replaceChildren(
            h('p', { class: 'setup-title' }, h('strong', { text: 'Einrichtung' }), ' · ' + todo.length + (todo.length === 1 ? ' Punkt offen' : ' Punkte offen')),
            h('ul', {}, todo.map((s) => h('li', {},
                h('span', { class: 'dot', 'aria-hidden': 'true' }),
                h('span', { class: 'setup-text' }, h('strong', { text: s.title + ': ' }), s.text),
                s.action === 'stammdaten' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { go('stammdaten'); setTimeout(focusFirstEmpty, 60); } }, 'Ergänzen') : null,
                s.link ? h('a', { class: 'btn btn-sm btn-ghost', href: s.link, target: '_blank', rel: 'noopener noreferrer' }, 'Bundesbank') : null)))
        );
    }

    /* ---------- Zentrale ---------- */
    function freshSuggestions() {
        if (!data.scout) return [];
        const known = new Set(data.leads.map((l) => l.domain));
        return data.scout.suggestions.filter((s) => !known.has(s.domain));
    }

    function stat(label, value, sub, opts) {
        const o = opts || {};
        return h(o.go ? 'button' : 'div', { class: 'tile tile-stat' + (o.alert ? ' is-alert' : '') + (o.cls ? ' ' + o.cls : ''), type: o.go ? 'button' : null, onclick: o.go ? () => go(o.go) : null },
            h('span', { class: 'stat-label', text: label }), h('strong', { class: 'num-display', text: value }), sub ? h('span', { class: 'stat-sub', text: sub }) : null);
    }

    function renderZentrale() {
        const k = data.kpis;
        const fresh = freshSuggestions();
        $('#greet-name').textContent = data.company.briefingName ? ', ' + data.company.briefingName : '';
        $('#today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        // Leads-Kachel
        $('#t-leads-n').textContent = String(fresh.length);
        $('#t-leads-sub').textContent = fresh.length === 1 ? 'neuer Betrieb mit Bedarf' : 'neue Betriebe mit Bedarf';
        $('#t-leads-value').textContent = data.scout
            ? 'Pipeline ' + euro0(fresh.length * data.company.basePrice) + ' · Basis ' + euro0(data.company.basePrice) + ' · ' + data.scout.cities.join(', ')
            : 'Noch kein Scout-Lauf. Gesucht wird im Raum Augsburg und München.';
        $('#t-leads-list').replaceChildren(...fresh.slice(0, 3).map((x) => h('li', {},
            h('span', { class: 'mini-name', text: x.name }), h('span', { class: 'pain', title: 'Leidensdruck', text: String(x.pain) }))));

        // Finanzen-Kachel
        const openInv = data.invoices.filter((i) => i.status === 'gestellt');
        const overdue = openInv.filter((i) => i.overdueDays > 0);
        $('#t-fin-open').textContent = euro0(k.openAmount);
        // im Zahlungsziel · überfällig ohne/mit Stufe 1 · Stufe 2 · Stufe 3
        const counts = [openInv.filter((i) => i.overdueDays <= 0).length, ...[1, 2, 3].map((s) => openInv.filter((i) => i.overdueDays > 0 && Math.max(1, i.stage || 0) === s).length)];
        const total = Math.max(1, openInv.length);
        $('#t-fin-stages').replaceChildren(...['im Ziel', 'Stufe 1', 'Stufe 2', 'Stufe 3'].map((label, i) => {
            const bar = h('i');
            bar.style.setProperty('--w', Math.round((counts[i] / total) * 100) + '%');
            return h('div', { class: 'stage-col s' + i }, h('span', { class: 'stage-bar' }, bar),
                h('span', { class: 'stage-n', text: String(counts[i]) }), h('span', { class: 'stage-l', text: label }));
        }));
        $('#t-fin-line').textContent = openInv.length
            ? openInv.length + (openInv.length === 1 ? ' Rechnung · ' : ' Rechnungen · ') + (overdue.length ? overdue.length + ' überfällig' : 'nichts überfällig') + (k.proposals ? ' · ' + k.proposals + ' Mahnvorschläge' : '')
            : 'Keine offenen Rechnungen.';

        setCount('outbox', k.outbox);
        setCount('finance', k.proposals || k.overdue);
        setCount('leads', fresh.length);

        // Als Nächstes
        const next = [];
        const ag = data.agents || { hot: [], preps: [], list: [] };
        // Heiße Leads zuerst: Anruf oder WhatsApp öffnen Sie selbst (nur bei eigenen Anfragen)
        ag.hot.slice(0, 3).forEach((l) => next.push(['Heiß · ' + l.score, l.name + ': ' + l.why.slice(0, 2).join(', ') + (l.inbound ? '' : ' (Kaltakquise: Brief oder Besuch)'), l.inbound ? null : () => go('leads'),
            [/^c:/.test(l.id) ? h('a', { class: 'link', href: '/akte/cloud/' + l.id.slice(2), target: '_blank', rel: 'noopener' }, 'Akte') : null, l.tel ? h('a', { class: 'link', href: l.tel }, 'Anrufen') : null, l.wa ? h('a', { class: 'link', href: l.wa, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp') : null]]));
        // Dringende Support-Tickets von Bestandskunden
        (data.tickets || []).filter((t) => t.status !== 'erledigt' && t.priority === 'hoch').slice(0, 3).forEach((t) => next.push(['Support', t.client + ': ' + t.summary + (t.check ? (t.check.ok ? ' (Seite von hier erreichbar)' : ' (Störung bestätigt)') : ''), () => go('agenten')]));
        // Cal.com: neue, verschobene und abgesagte Termine mit fertigem Entwurf zur Freigabe
        const openMail = (id) => () => { if (id) open.add(id); renderOutbox(); go('zentrale', 'postausgang'); };
        const STATE = { gebucht: 'Neuer Termin', verschoben: 'Verschoben', abgesagt: 'Abgesagt' };
        (ag.bookings || []).filter((b) => STATE[b.status]).forEach((b) => {
            const mail = b.draft && (data.outbox || []).find((m) => m.id === b.draft && ['entwurf', 'freigegeben'].includes(m.status));
            const clash = (b.conflicts || []).length ? ' · Überschneidung: ' + b.conflicts.join(', ') : '';
            if (!mail && !clash) return;
            next.push([STATE[b.status] + ' ' + (b.status === 'abgesagt' ? '' : new Date(b.start).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })), (b.name || b.email) + (b.status === 'abgesagt' ? ' hat abgesagt' : '') + clash + (mail ? ' · Entwurf bereit' : ''), null,
                [b.leadId ? h('a', { class: 'link', href: '/akte/cloud/' + b.leadId, target: '_blank', rel: 'noopener' }, 'Akte') : null,
                    mail ? h('button', { type: 'button', class: 'link', onclick: openMail(mail.id) }, 'Freigeben') : null]]);
        });
        ag.preps.filter((p) => Date.parse(p.at) > Date.now() - 3600000 && Date.parse(p.at) < Date.now() + 36 * 3600000).forEach((p) => next.push(['Termin ' + hm(p.at), p.name + ' · Hauptpunkt: ' + p.headline + ' · Vorlage: harvey-agent/' + p.file, () => go('termine')]));
        ag.list.forEach((a) => (a.notes || []).filter((n) => /Nachfass-Brief|nicht erreichbar|SSL|Domain .* läuft|defekte Links|Cal.com-Webhook prüfen/.test(n)).slice(0, 3).forEach((n) => next.push([a.name, n, () => go('agenten')])));
        if (k.outbox) next.push(['Postausgang', k.outbox + (k.outbox === 1 ? ' Mail wartet' : ' Mails warten') + ' auf Ihre Freigabe.', () => go('zentrale', 'postausgang')]);
        data.invoices.filter((i) => i.paused).forEach((i) => next.push(['Klären', i.client + ' hat zu ' + i.number + ' geantwortet. Mahnwesen pausiert.', () => go('finanzen')]));
        data.leads.filter((l) => l.status === 'antwort').forEach((l) => next.push(['Antwort', l.name + ' hat geantwortet.', () => go('leads')]));
        if (fresh.length) next.push(['Akquise', fresh.length + ' neue Betriebe mit Bedarf gefunden.', () => go('leads')]);
        const overdueNoDraft = data.invoices.filter((i) => i.status === 'gestellt' && i.overdueDays > 0 && !i.proposed && !i.paused).length;
        if (overdueNoDraft) next.push(['Finanzen', overdueNoDraft + ' überfällige Rechnungen, nächste Mahnstufe noch nicht erreicht.', () => go('finanzen')]);
        $('#next').replaceChildren(...(next.length ? next.slice(0, 9).map(([tag, text, fn, links]) => h('li', { class: /^Heiß/.test(tag) ? 'is-hot' : null },
            h('span', { class: 'tag', text: tag }), h('span', { class: 'todo-text', text }),
            h('span', { class: 'todo-acts' }, ...(links || []).filter(Boolean), fn ? h('button', { type: 'button', class: 'link', onclick: fn }, 'Öffnen') : null))) : [h('li', { class: 'is-empty', text: 'Alles erledigt.' })]));

        streamEvents();
        renderOutbox();
    }

    /* ---------- Postausgang ---------- */
    function blockerFix(text) {
        if (!/Platzhalter/.test(text)) return null;
        const companyOk = data.setup.find((s) => s.id === 'company').ok;
        return companyOk
            ? h('button', { type: 'button', class: 'link', onclick: refreshDrafts }, 'Text mit Firmendaten aktualisieren')
            : h('button', { type: 'button', class: 'link', onclick: () => go('stammdaten') }, 'Firmendaten ergänzen');
    }

    function captureDrafts() {
        $$('.mail.is-open').forEach((card) => {
            const id = card.dataset.id;
            const to = $('[name="to"]', card);
            if (!to) return;
            const v = { to: to.value, subject: $('[name="subject"]', card).value, body: $('[name="body"]', card).value };
            const e = data && data.outbox.find((x) => x.id === id);
            if (e && (v.to !== (e.to || '') || v.subject !== e.subject || v.body !== e.body)) drafts.set(id, v); else drafts.delete(id);
        });
    }

    function renderOutbox() {
        const list = data.outbox.filter((e) => (outboxFilter === 'sent' ? e.status === 'gesendet' : e.status !== 'gesendet'));
        const box = $('#outbox');
        if (!list.length) {
            box.replaceChildren(empty(outboxFilter === 'sent' ? 'Noch nichts gesendet.' : 'Keine offenen Mails.', outboxFilter === 'sent' ? null : 'Mahnentwürfe entstehen beim Mahn-Check, Akquise-Mails nur bei Kontakten mit Einwilligung.'));
            return;
        }
        box.replaceChildren(...list.map(mailCard));
    }

    function mailCard(e) {
        const done = e.status === 'gesendet';
        const isOpen = open.has(e.id);
        const d = drafts.get(e.id) || {};
        const who = (e.meta && e.meta.client) || e.ref || e.to || '';
        const card = h('article', { class: 'mail st-' + e.status + (isOpen ? ' is-open' : ''), 'data-id': e.id });

        const toggle = h('button', { type: 'button', class: 'mail-sum', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => {
            if (open.has(e.id)) { captureDrafts(); open.delete(e.id); } else open.add(e.id);
            renderOutbox();
        } },
            h('span', { class: 'pill t-' + e.type, text: TYPE[e.type] + (e.meta && e.meta.stage ? ' ' + e.meta.stage : '') }),
            h('span', { class: 'mail-who' }, h('strong', { text: who }), h('span', { class: 'muted', text: e.subject })),
            h('span', { class: 'chip c-' + (done ? 'gesendet' : e.blocker ? 'block' : e.status), text: done ? 'gesendet ' + when(e.sentAt) : (e.blocker ? 'braucht Angaben' : MAIL_STATE[e.status]) }),
            h('span', { class: 'chev', 'aria-hidden': 'true' }));
        card.append(toggle);
        if (!isOpen) return card;

        const to = h('input', { type: 'email', name: 'to', value: d.to !== undefined ? d.to : e.to || '', disabled: done, autocomplete: 'off' });
        const subject = h('input', { type: 'text', name: 'subject', value: d.subject !== undefined ? d.subject : e.subject, disabled: done });
        const body = h('textarea', { name: 'body', rows: '14', disabled: done, spellcheck: 'true' });
        body.value = d.body !== undefined ? d.body : e.body;
        const check = h('p', { class: 'check', role: 'status' });
        const m0 = e.meta || {};
        const post = e.type === 'beitrag';
        const linkedin = post && m0.channel === 'linkedin';
        const review = e.type === 'bewertung' || (post && !linkedin); // öffentlich bei Google, keine Mail
        const noMail = review || linkedin;
        const sendBtn = h('button', { type: 'button', class: 'btn btn-send' }, sendIcon(), linkedin ? 'Kopieren & als gepostet markieren' : review ? 'Freigeben & Veröffentlichen' : 'Freigeben & Senden');
        const confirmBar = h('div', { class: 'confirm', hidden: true });
        const m = e.meta || {};
        const meta = e.type === 'mahnung' && m.stage ? STAGE[m.stage] + ' zu ' + m.invoice
            : e.type === 'akquise' ? 'Kontaktweg: ' + (e.contactAllowed || 'unbekannt')
            : e.type === 'nachfass' ? 'Nachfass Stufe ' + m.stage + ' · Angebot vor ' + m.days + ' Tagen · endet automatisch bei Antwort oder Termin'
            : e.type === 'antwort' ? 'Eingeordnet als ' + (m.category || '–') + (m.summary ? ': ' + m.summary : '')
            : review ? '★'.repeat(m.stars || 0) + ' · ' + (m.location || '') + (m.comment ? ' · „' + m.comment.slice(0, 220) + '“' : ' · ohne Text') + ' · wird öffentlich im Google-Profil angezeigt'
            : post ? (linkedin ? 'LinkedIn · Sie posten selbst: Text wird kopiert, danach in LinkedIn einfügen' : 'Google-Unternehmensprofil MW IT-SERVICES · wird öffentlich als Neuigkeit angezeigt') + ' · ' + body.value.length + ' Zeichen'
            : e.type === 'support' ? 'Ticket ' + (m.ticket || '') + ' · Lösungsvorschlag, bitte prüfen'
            : e.type === 'termin' ? (m.cancelled ? 'Cal.com-Absage · Angebot für einen neuen Termin' : 'Cal.com-Termin ' + (m.start ? new Date(m.start).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + ' · Bestätigung an den Kunden') + (m.akte ? ' · Akte in der Zentrale' : '')
            : e.type === 'willkommen' ? 'Onboarding · Projektordner ' + (m.folder || '')
            : e.type === 'report' ? (m.kind === 'roi' ? 'Quartals-ROI ' + m.quarter + ' · Schätzung bitte prüfen' : 'Betreuungsbericht ' + (m.month || '')) : '';

        const paintCheck = (blocker) => {
            const miss = e.sendMissing || [];
            const reason = blocker || (miss.length ? (review ? 'Google ist nicht verbunden (Agenten → Einrichtung).' : 'Mailversand ist noch nicht eingerichtet (SMTP in harvey-agent/.env).') : '');
            sendBtn.disabled = !!reason || done;
            const chip = $('.mail-sum .chip', card);
            if (chip && !done) { chip.textContent = blocker ? 'braucht Angaben' : MAIL_STATE[e.status]; chip.className = 'chip c-' + (blocker ? 'block' : e.status); }
            check.replaceChildren(...(reason ? [h('span', { class: 'bad', text: reason }), blocker ? blockerFix(blocker) : null].filter(Boolean) : [h('span', { class: 'ok', text: linkedin ? 'Geprüft · bereit zum Posten' : review ? 'Geprüft · bereit zum Veröffentlichen' : 'Geprüft · bereit zum Senden' })]));
        };
        let checkT = null;
        const onInput = () => {
            drafts.set(e.id, { to: to.value, subject: subject.value, body: body.value });
            confirmBar.hidden = true;
            card.classList.remove('is-pending');
            clearTimeout(checkT);
            checkT = setTimeout(async () => {
                try { paintCheck((await api('outbox/' + e.id + '/check', { to: to.value.trim(), subject: subject.value, body: body.value })).blocker); } catch (err) { /* ignorieren */ }
            }, 350);
        };
        [to, subject, body].forEach((f) => f.addEventListener('input', onInput));

        sendBtn.addEventListener('click', () => {
            confirmBar.replaceChildren(
                linkedin ? h('span', { class: 'confirm-q' }, 'Text kopieren und als „auf LinkedIn gepostet“ vermerken?')
                    : post ? h('span', { class: 'confirm-q' }, 'Zweiter Blick: Beitrag jetzt öffentlich im ', h('strong', { text: 'Google-Profil von MW IT-SERVICES' }), ' veröffentlichen?')
                    : review ? h('span', { class: 'confirm-q' }, 'Zweiter Blick: Antwort jetzt öffentlich bei ', h('strong', { text: m.location || 'Google' }), ' veröffentlichen?')
                    : h('span', { class: 'confirm-q' }, 'Zweiter Blick: jetzt an ', h('strong', { text: to.value.trim() }), ' senden?'),
                h('div', { class: 'btns' },
                    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { confirmBar.hidden = true; card.classList.remove('is-pending'); sendBtn.focus(); } }, 'Abbrechen'),
                    h('button', { type: 'button', class: 'btn btn-send', 'data-confirm': '1', onclick: () => doSend(e, to, subject, body, confirmBar) }, linkedin ? 'Ja, kopieren' : review ? 'Ja, veröffentlichen' : 'Ja, senden')));
            confirmBar.hidden = false;
            card.classList.add('is-pending'); // erster Knopf tritt zurück, nur „Ja, senden“ sendet
            $('[data-confirm]', confirmBar).focus();
        });

        card.append(h('div', { class: 'mail-body' },
            meta ? h('p', { class: 'muted small', text: meta }) : null,
            post && m0.image ? h('img', { class: 'post-img', src: '/' + m0.image.replace(/^out\//, 'out/'), alt: 'Bild zum Beitrag (1080 × 1080), zum Hochladen auf LinkedIn oder im Google-Profil', loading: 'lazy', width: '180', height: '180' }) : null,
            noMail ? null : h('label', { class: 'row' }, h('span', { text: 'An' }), to),
            h('label', { class: 'row' }, h('span', { text: 'Betreff' }), subject),
            h('label', { class: 'row row-top' }, h('span', { class: 'visually-hidden', text: 'Text' }), body),
            done ? h('p', { class: 'muted small', text: 'Gesendet am ' + when(e.sentAt) + (e.repliedAt ? ' · Antwort erhalten ' + when(e.repliedAt) : '') }) : h('div', { class: 'mail-actions' },
                check,
                h('div', { class: 'btns' },
                    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => discard(e) }, 'Verwerfen'),
                    h('button', { type: 'button', class: 'btn', onclick: () => save(e, to, subject, body) }, 'Speichern'),
                    sendBtn),
                confirmBar)));
        if (!done) paintCheck(drafts.has(e.id) ? null : e.blocker);
        if (!done && drafts.has(e.id)) onInput();
        return card;
    }

    function sendIcon() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M4 12 20 4l-6 16-3-7-7-1z');
        svg.append(p);
        return svg;
    }

    async function refreshDrafts() {
        try {
            await api('run/billing', {});
            $$('.mail.is-open').forEach((c) => drafts.delete(c.dataset.id));
            toast('Entwürfe aktualisiert');
        } catch (err) { toast(err.message, true); }
        load();
    }

    async function save(e, to, subject, body) {
        try {
            await api('outbox/' + e.id + '/edit', { to: to.value.trim(), subject: subject.value, body: body.value });
            drafts.delete(e.id);
            toast('Gespeichert');
            load();
        } catch (err) { toast(err.message, true); }
    }
    async function discard(e) {
        if (!confirm('Diesen Entwurf verwerfen?')) return;
        try { await api('outbox/' + e.id + '/discard', {}); drafts.delete(e.id); open.delete(e.id); toast('Verworfen'); load(); } catch (err) { toast(err.message, true); }
    }
    async function doSend(e, to, subject, body, bar) {
        const btn = $('[data-confirm]', bar);
        btn.disabled = true;
        btn.textContent = 'Wird gesendet …';
        if (window.HarveyOrb) window.HarveyOrb.pulse(0.9);
        const li = e.type === 'beitrag' && e.meta && e.meta.channel === 'linkedin';
        try {
            if (li) { try { await navigator.clipboard.writeText(body.value); } catch (_) { body.select(); document.execCommand('copy'); } }
            await api('outbox/' + e.id + '/send', { to: to.value.trim(), subject: subject.value, body: body.value, confirm: true });
            drafts.delete(e.id);
            open.delete(e.id);
            toast(li ? 'Text kopiert: jetzt in LinkedIn einfügen' : e.type === 'bewertung' ? 'Antwort veröffentlicht' : e.type === 'beitrag' ? 'Beitrag veröffentlicht' : 'Gesendet an ' + to.value.trim());
            load();
        } catch (err) {
            bar.hidden = true;
            toast('Nicht gesendet: ' + err.message, true);
            load();
        }
    }

    /* ---------- Leads & Scout ---------- */
    function dots(points) {
        return h('span', { class: 'dots' }, (points || []).map((p) => h('i', { class: 'd-' + p.status, title: p.title + ': ' + STATUS[p.status] })));
    }

    const caseId = (f) => String(f || '').replace(/\\/g, '/').split('/').pop().replace(/\.md$/, '');
    const KINDS = { anfrage: 'Website-Check', paket: 'Projekt-Planer' };
    let inqLoaded = 0;
    async function loadInquiries(force) {
        if (!force && Date.now() - inqLoaded < 60000) return;
        inqLoaded = Date.now();
        const list = $('#inquiries');
        if (force) list.replaceChildren(h('li', { class: 'is-empty', text: 'Wird geladen …' }));
        let r;
        try { r = await api('inquiries' + (force ? '?refresh=1' : '')); } catch (err) { r = { rows: [], error: err.message }; }
        $('#cnt-inq').textContent = r.rows.length ? String(r.rows.filter((x) => x.status === 'neu').length || '') : '';
        list.replaceChildren(...(r.rows.length ? r.rows.map((x) => sysRow(x.status === 'neu' ? 'warn' : x.status === 'auftrag' ? 'good' : 'off',
            x.name + ' · ' + (KINDS[x.kind] || x.kind),
            [x.url ? x.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null, x.email, x.measured ? x.open + ' offene Punkte' : null, x.source ? 'über ' + x.source.source + (x.source.campaign ? ' / ' + x.source.campaign : '') : null].filter(Boolean).join(' · '),
            (LEAD_STATE[x.status] || x.status) + ' · ' + ago(x.createdAt),
            h('span', { class: 'btns' },
                h('a', { class: 'btn btn-sm btn-primary', href: '/akte/cloud/' + x.id, target: '_blank', rel: 'noopener' }, 'Akte'),
                x.url ? h('a', { class: 'btn btn-sm btn-ghost', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, 'Website') : null,
                x.phone ? h('a', { class: 'btn btn-sm btn-ghost', href: 'tel:' + String(x.phone).replace(/[^\d+]/g, '') }, 'Anrufen') : null)))
            : [h('li', { class: 'is-empty', text: r.error ? 'Web-Dashboard nicht erreichbar: ' + r.error : 'Noch keine Anfragen über die Website.' })]));
    }
    $('#inq-refresh').addEventListener('click', () => loadInquiries(true));
    document.querySelector('[data-sub="anfragen"]').addEventListener('click', () => loadInquiries(false));

    function renderLeads() {
        const s = data.scout;
        const known = new Set(data.leads.map((l) => l.domain));
        const fresh = freshSuggestions();
        $('#cnt-sugg').textContent = fresh.length ? String(fresh.length) : '';
        $('#cnt-leads').textContent = data.leads.length ? String(data.leads.length) : '';
        $('#scout-meta').textContent = s ? 'Letzter Lauf ' + when(s.createdAt) + ' · ' + s.cities.join(', ') + ' · ' + s.attribution : 'Quelle: OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL)';
        const contacted = data.leads.filter((l) => ['angeschrieben', 'antwort', 'termin'].includes(l.status)).length;
        $('#leads-kpis').replaceChildren(
            stat('Neue Vorschläge', String(fresh.length), s ? 'aus ' + s.suggestions.length + ' gemessenen Betrieben' : 'noch kein Lauf'),
            stat('Pipeline-Wert', euro0(fresh.length * data.company.basePrice), 'Basispreis ' + euro0(data.company.basePrice) + ' netto'),
            stat('Akquise-Liste', String(data.leads.length), contacted + ' angeschrieben oder im Gespräch'),
            stat('Termine', String(data.leads.filter((l) => l.status === 'termin').length), 'aus der Akquise'));

        $('#scout').replaceChildren(...(s && s.suggestions.length ? s.suggestions.map((x, i) => {
            const taken = known.has(x.domain);
            const a = x.approach[x.recommended];
            const channel = h('select', { 'aria-label': 'Kontaktweg für ' + x.name },
                h('option', { value: 'brief', text: 'Brief per Post' }), h('option', { value: 'persoenlich', text: 'Persönlich' }), h('option', { value: 'bestehend', text: 'Bestehender Kontakt' }));
            return h('article', { class: 'tile lead' + (taken ? ' is-taken' : '') },
                h('header', { class: 'lead-head' }, h('span', { class: 'rank', text: String(i + 1) }),
                    h('div', { class: 'lead-title' }, h('h3', { text: x.name }), h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: x.domain })),
                    h('span', { class: 'pain-big', title: 'Leidensdruck' }, h('b', { text: String(x.pain) }), h('small', { text: 'Druck' }))),
                h('div', { class: 'facts' }, h('span', {}, h('b', { text: x.signals.met + '/' + x.signals.total }), ' Signale'), dots(x.points)),
                h('p', { class: 'potential' }, 'Potenzial ', h('b', { text: euro0(x.potential.once) }), x.potential.month ? ' + ' + euro0(x.potential.month) + ' / Monat' : ''),
                h('ul', { class: 'weak' }, x.weaknesses.slice(0, 3).map((w) => h('li', { text: w.title }))),
                h('details', {}, h('summary', { text: 'Ansatz: ' + a.channel }), h('p', { class: 'muted small', text: a.note }), h('pre', { text: a.opener + '\n\n' + a.text })),
                taken ? h('p', { class: 'ok small', text: 'In der Akquise-Liste' }) : h('div', { class: 'tile-foot' }, channel,
                    h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async (ev) => {
                        ev.currentTarget.disabled = true;
                        const r = await api('scout/accept', { domain: x.domain, contact: channel.value }).catch((err) => ({ ok: false, output: err.message }));
                        toast(r.ok ? x.name + ' übernommen' : r.output, !r.ok);
                        load();
                    } }, 'Übernehmen')));
        }) : [h('div', { class: 'tile md:col-span-2 xl:col-span-3' }, empty('Noch keine Vorschläge.', '„Neue Betriebe suchen“ durchsucht OpenStreetMap nach Handwerksbetrieben und misst bis zu 8 Websites. Kontakt nur per Brief oder persönlich (§ 7 UWG).'))]));

        $('#leadgrid').replaceChildren(...(data.leads.length ? data.leads.map((l) => h('article', { class: 'tile lead lead-compact' },
            h('header', { class: 'lead-head' },
                h('div', { class: 'lead-title' }, h('h3', { text: l.name }), h('span', { class: 'muted small', text: l.domain })),
                h('span', { class: 'chip c-' + l.status, text: LEAD_STATE[l.status] || l.status })),
            h('dl', { class: 'kv' },
                h('div', {}, h('dt', { text: 'Signale' }), h('dd', { text: l.total ? l.met + '/' + l.total : '–' })),
                h('div', {}, h('dt', { text: 'Priorität' }), h('dd', { text: l.priority || '–' })),
                h('div', {}, h('dt', { text: 'Kontaktweg' }), h('dd', { text: l.contactAllowed || 'brief' }))),
            l.caseFile ? h('div', { class: 'tile-foot' },
                h('a', { class: 'btn btn-primary btn-sm', href: '/akte/local/' + caseId(l.caseFile), target: '_blank', rel: 'noopener' }, 'Gesprächsakte'),
                h('a', { class: 'btn btn-sm btn-ghost', href: 'https://' + l.domain + '/', target: '_blank', rel: 'noopener noreferrer' }, 'Website'))
                : h('p', { class: 'muted small', text: 'Akte nach „Akquise-Liste messen“' })))
            : [h('div', { class: 'tile md:col-span-2 xl:col-span-3' }, empty('Die Akquise-Liste ist leer.', 'Vorschläge übernehmen, dann „Akquise-Liste messen“.'))]));
    }

    /* ---------- Finanzen ---------- */
    function renderFinance() {
        const inv = data.invoices;
        const openInv = inv.filter((i) => i.status === 'gestellt');
        const overdue = openInv.filter((i) => i.overdueDays > 0);
        $('#fin-kpis').replaceChildren(
            stat('Offen', euro0(openInv.reduce((s, i) => s + i.open, 0)), openInv.length + (openInv.length === 1 ? ' Rechnung' : ' Rechnungen'), { cls: 'md:col-span-2 lg:col-span-3' }),
            stat('Überfällig', euro0(overdue.reduce((s, i) => s + i.open, 0)), overdue.length + (overdue.length === 1 ? ' Rechnung' : ' Rechnungen'), { alert: overdue.length > 0, cls: 'md:col-span-2 lg:col-span-3' }),
            stat('Mahnvorschläge', String(data.kpis.proposals), data.kpis.proposals ? 'im Postausgang prüfen' : 'keine', { go: data.kpis.proposals ? 'zentrale' : null, cls: 'md:col-span-2 lg:col-span-2' }));
        const lastBank = data.events.find((e) => ['invoice_paid', 'payment_matched', 'payment_unmatched'].includes(e.type));
        $('#bank-last').textContent = lastBank ? 'Zuletzt: ' + lastBank.label + ' · ' + when(lastBank.at) : 'Noch keine Zahlung automatisch erkannt.';

        const rows = inv.filter((i) => i.status !== 'bezahlt' || (i.paidAt && Date.now() - Date.parse(i.paidAt) < 30 * 86400000));
        const box = $('#invoices');
        if (!rows.length) return box.replaceChildren(h('div', { class: 'tile md:col-span-2 xl:col-span-3' }, empty('Keine offenen Rechnungen.')));
        box.replaceChildren(...rows.map((i) => {
            const cls = i.status === 'bezahlt' ? 'is-paid' : i.overdueDays > 0 ? 'is-overdue' : '';
            const stageText = i.status === 'bezahlt' ? 'bezahlt' : i.status === 'entwurf' ? 'Entwurf' : i.stage ? 'Stufe ' + i.stage + ' · ' + STAGE[i.stage] : i.overdueDays > 0 ? 'überfällig' : 'im Zahlungsziel';
            return h('article', { class: 'tile invoice ' + cls },
                h('header', { class: 'lead-head' },
                    h('div', { class: 'lead-title' }, h('h3', { text: i.client }), h('span', { class: 'muted small', text: i.number })),
                    h('strong', { class: 'inv-amount', text: euro(i.open) })),
                h('div', { class: 'stage-track', 'aria-label': stageText }, [1, 2, 3].map((s) => h('i', { class: (i.stage || 0) >= s ? 'on' : '' }))),
                h('dl', { class: 'kv' },
                    h('div', {}, h('dt', { text: 'Fällig' }), h('dd', { text: de(i.dueDate) })),
                    h('div', {}, h('dt', { text: 'Tage drüber' }), h('dd', { text: i.overdueDays > 0 ? String(i.overdueDays) : '–' })),
                    h('div', {}, h('dt', { text: 'Stand' }), h('dd', { text: stageText }))),
                h('p', { class: 'small next' }, i.paused ? h('span', { class: 'warn', text: 'Pausiert: ' + i.paused.reason }) : i.proposed
                    ? h('button', { type: 'button', class: 'link', onclick: () => go('zentrale', 'postausgang') }, 'Stufe ' + i.proposed + ' liegt im Postausgang') : h('span', { class: 'muted', text: i.reason || '' })),
                h('div', { class: 'tile-foot' },
                    i.status === 'gestellt' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => paid(i) }, 'Als bezahlt eintragen') : null,
                    i.paused ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => resume(i) }, 'Mahnwesen fortsetzen') : null));
        }));
    }
    async function paid(i) {
        if (!confirm(i.number + ' als vollständig bezahlt eintragen (' + euro(i.open) + ')? Offene Mahnungen werden gestoppt.')) return;
        const r = await api('invoice/' + encodeURIComponent(i.number) + '/paid', {}).catch((err) => ({ ok: false, output: err.message }));
        toast(r.ok ? 'Eingetragen, Mahnwesen beendet' : r.output, !r.ok);
        load();
    }
    async function resume(i) {
        const r = await api('invoice/' + encodeURIComponent(i.number) + '/resume', {}).catch((err) => ({ ok: false, output: err.message }));
        toast(r.ok ? 'Mahnwesen läuft wieder' : r.output, !r.ok);
        load();
    }

    /* ---------- Termine ---------- */
    const dayKey = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const todayKey = () => dayKey(new Date().toISOString());
    function dayLabel(key) {
        const d = new Date(key + 'T12:00:00');
        const diff = Math.round((new Date(key + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000);
        const base = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
        return diff === 0 ? 'Heute · ' + base : diff === 1 ? 'Morgen · ' + base : base;
    }
    function eventRow(e) {
        const live = !e.allDay && Date.parse(e.start) <= Date.now() && Date.parse(e.end) > Date.now();
        return h('li', { class: 'ag k-' + e.kind + (live ? ' is-live' : '') + (Date.parse(e.end) < Date.now() ? ' is-past' : '') },
            h('time', { text: e.allDay ? 'ganztags' : hm(e.start) }),
            h('span', { class: 'ag-title' }, h('strong', { text: e.title }), h('span', { class: 'muted small', text: [e.sourceName, e.location].filter(Boolean).join(' · ') }),
                (() => { const p = ((data && data.agents && data.agents.preps) || []).find((x) => x.at === e.start); return p ? h('span', { class: 'ag-prep', text: 'Vorbereitet · ' + p.headline + ' · harvey-agent/' + p.file }) : null; })()));
    }

    function renderAgenda() {
        if (!agenda) return;
        const events = agenda.events;
        const today = todayKey();
        const upcoming = events.filter((e) => Date.parse(e.end) > Date.now() || (e.allDay && dayKey(e.start) === today));
        const todays = events.filter((e) => dayKey(e.start) === today);
        setCount('today', todays.filter((e) => e.kind !== 'harvey' || /^Termin/.test(e.title)).length);

        // Kachel
        $('#t-cal-list').replaceChildren(...(upcoming.length ? upcoming.slice(0, 4).map((e) => {
            const row = eventRow(e);
            if (dayKey(e.start) !== today) row.querySelector('time').textContent = new Date(e.start).toLocaleDateString('de-DE', { weekday: 'short' }) + (e.allDay ? '' : ' ' + hm(e.start));
            return row;
        }) : [h('li', { class: 'is-empty', text: agenda.sources.length ? 'Keine Termine in den nächsten 14 Tagen.' : 'Noch kein Kalender angebunden.' })]));
        const errs = agenda.sources.filter((s) => s.error).length;
        $('#t-cal-sources').textContent = agenda.sources.length
            ? agenda.sources.filter((s) => s.enabled).map((s) => s.name).join(' · ') + (errs ? ' · ' + errs + ' nicht erreichbar' : '')
            : 'Google-Kalender unter „Termine“ anbinden.';

        // Ansicht
        const byDay = new Map();
        events.filter((e) => dayKey(e.start) >= today).forEach((e) => { const k = dayKey(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }); // heute inkl. vergangener Termine (abgeblendet)
        $('#agenda').replaceChildren(...(byDay.size ? Array.from(byDay.entries()).map(([k, list]) => h('section', { class: 'day' + (k === today ? ' is-today' : '') },
            h('h3', { text: dayLabel(k) }), h('ol', { class: 'agenda' }, list.map(eventRow))))
            : [empty('Keine Termine in den nächsten 14 Tagen.', agenda.sources.length ? null : 'Rechts einen Kalender über seine geheime iCal-Adresse anbinden.')]));

        $('#sources').replaceChildren(...(agenda.sources.length ? agenda.sources.map((s) => h('li', { class: 'source' + (s.enabled ? '' : ' is-off') },
            h('span', { class: 'src-dot k-' + s.kind, 'aria-hidden': 'true' }),
            h('span', { class: 'src-main' }, h('strong', { text: s.name }), h('span', { class: 'muted small', text: (s.kindLabel || 'Google-Verbindung') + ' · ' + (s.error ? 'Fehler: ' + s.error : s.count !== null && s.count !== undefined ? s.count + ' Einträge' : s.host) })),
            s.id === 'google' ? h('span', { class: 'muted small', text: 'über Google verbunden' }) : null,
            s.id === 'google' ? null : h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-pressed': s.enabled ? 'true' : 'false', onclick: () => calUpdate(s.id, { enabled: !s.enabled }) }, s.enabled ? 'Aktiv' : 'Aus'),
            s.id === 'google' ? null : h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-label': s.name + ' entfernen', onclick: () => { if (confirm('Kalender „' + s.name + '“ entfernen?')) calUpdate(s.id, { remove: true }); } }, 'Entfernen')))
            : [h('li', { class: 'is-empty', text: 'Noch kein Kalender angebunden.' })]),
            h('li', { class: 'source is-harvey' }, h('span', { class: 'src-dot k-harvey', 'aria-hidden': 'true' }),
                h('span', { class: 'src-main' }, h('strong', { text: 'Kasi' }), h('span', { class: 'muted small', text: 'Lead-Termine und Fälligkeiten, immer aktiv' }))));

        $('#calcom').replaceChildren(
            check(!!agenda.booking, 'Buchungslink', agenda.booking ? agenda.booking : 'BOOKING_URL in core/drafts.js eintragen, dann steht er in jeder Mail.'),
            check(agenda.calcomWebhook, 'Webhook-Secret', agenda.calcomWebhook ? 'lokal gesetzt' : 'Im Worker setzen (README, Abschnitt Cal.com). Lokal nicht prüfbar.', !agenda.calcomWebhook),
            check(agenda.sources.some((s) => s.kind === 'google' || s.kind === 'calcom'), 'Kalender-Feed', 'Buchungen erscheinen hier über den verbundenen Google-Kalender.'));
        $('#cal-meta').textContent = 'Nächste 14 Tage · ' + (agenda.sources.filter((s) => s.enabled).length + 1) + ' Quellen';
    }
    function check(ok, title, text, neutral) {
        return h('li', { class: ok ? 'is-ok' : neutral ? 'is-neutral' : 'is-todo' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, h('strong', { text: title }), h('span', { class: 'muted small', text })));
    }

    async function loadAgenda(force) {
        try {
            agenda = await api('calendar' + (force ? '?refresh=1' : ''));
            renderAgenda();
        } catch (err) {
            if (force) toast('Kalender nicht geladen: ' + err.message, true);
        }
    }
    async function calUpdate(id, patch) {
        try { await api('calendar/' + encodeURIComponent(id), patch); await loadAgenda(true); } catch (err) { toast(err.message, true); }
    }
    $('#cal-refresh').addEventListener('click', async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        await loadAgenda(true);
        b.disabled = false;
        toast('Kalender aktualisiert');
    });
    $('#cal-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const msg = $('#cal-msg');
        const btn = $('button[type="submit"]', f);
        msg.textContent = '';
        if (!f.url.value.trim()) { msg.textContent = 'Bitte die iCal-Adresse einfügen.'; f.url.focus(); return; }
        btn.disabled = true;
        try {
            await api('calendar/add', { name: f.name.value, kind: f.kind.value, url: f.url.value });
            f.reset();
            await loadAgenda(true);
            const added = agenda && agenda.sources[agenda.sources.length - 1];
            msg.textContent = added && added.error ? 'Angebunden, aber nicht lesbar: ' + added.error : 'Angebunden.';
        } catch (err) { msg.textContent = err.message; }
        btn.disabled = false;
    });

    /* ---------- Kunden & Stammdaten ---------- */
    const GROUP = (p) => (/^(briefing|scout)\./.test(p) ? 'zentrale' : /^(bank\.|taxNumber|vatId)/.test(p) ? 'bank' : /^(invoice|dunning)\./.test(p) ? 'billing' : 'company');
    let formDirty = false;

    function renderClients() {
        $('#clients-meta').textContent = data.clients.length + ' Kunden · ' + euro(data.kpis.mrr) + ' Betreuung pro Monat';
        $('#clients').replaceChildren(...(data.clients.length ? data.clients.map((c) => {
            const openInv = data.invoices.filter((i) => i.client === c.company && i.status === 'gestellt');
            const pkg = c.package ? [c.package.base, ...(c.package.extras || []), c.package.care].filter((x) => x && x !== 'none').join(' + ') : '';
            return h('li', { class: 'client' },
                h('div', { class: 'client-main' }, h('strong', { text: c.company }), h('span', { class: 'muted small', text: [c.id, c.email, (c.domains || []).join(', ')].filter(Boolean).join(' · ') }),
                    pkg ? h('span', { class: 'small', text: 'Paket: ' + pkg }) : null),
                h('span', { class: 'chip ' + (openInv.length ? 'c-warn' : 'c-ok'), text: openInv.length ? euro(openInv.reduce((s, i) => s + i.open, 0)) + ' offen' : 'ausgeglichen' }));
        }) : [h('li', { class: 'is-empty', text: 'Noch keine Kunden. Übernahme aus dem Web-Dashboard: npm run billing -- --import <export.json>' })]));
    }

    function renderCompany() {
        if (formDirty) return;
        const groups = { company: [], bank: [], billing: [], zentrale: [] };
        data.settings.forEach((f) => {
            const id = 'f-' + f.path.replace(/\./g, '-');
            const isEmpty = f.type !== 'checkbox' && (f.value === '' || f.value === undefined || f.value === null);
            const required = ['street', 'city', 'bank.iban'].includes(f.path) || (f.path === 'taxNumber' && !data.settings.find((x) => x.path === 'vatId').value);
            const input = f.type === 'checkbox'
                ? h('input', { id, type: 'checkbox', name: f.path, checked: f.value === true ? true : null })
                : h('input', { id, type: f.type === 'number' ? 'text' : f.type, inputmode: f.type === 'number' ? 'decimal' : null, name: f.path, value: f.value === undefined || f.value === null ? '' : String(f.value), autocomplete: 'off' });
            groups[GROUP(f.path)].push(h('div', { class: 'field' + (f.type === 'checkbox' ? ' field-check' : '') + (isEmpty && required ? ' is-missing' : '') },
                h('label', { for: id, text: f.label + (isEmpty && required ? ' · fehlt' : '') }), input));
        });
        Object.entries(groups).forEach(([g, els]) => $('[data-group="' + g + '"]').replaceChildren(...els));
    }

    function focusFirstEmpty() {
        const f = $('.field.is-missing input');
        if (f) f.focus();
    }

    $('#company-form').addEventListener('input', () => { formDirty = true; $('#company-msg').textContent = 'Nicht gespeichert'; });
    $('#company-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const body = {};
        $$('#company-form input').forEach((i) => { body[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
        try {
            await api('company', body);
            formDirty = false;
            $('#company-msg').textContent = 'Gespeichert';
            toast('Firmendaten gespeichert, Entwürfe werden aktualisiert');
            await api('run/billing', {}).catch(() => {});
            load();
        } catch (err) {
            $('#company-msg').textContent = err.message;
            toast(err.message, true);
        }
    });

    /* ---------- Läufe ---------- */
    const RUNS = { monitor: 'Kontoauszug-Abgleich', billing: 'Mahn-Check', scout: 'Neue Betriebe suchen', monthly: 'Betreuungs-Rechnungen', pipeline: 'Akquise-Liste messen',
        followup: 'Nachfass', termine: 'Termin-Vorbereitung', watch: 'Website-Wächter', report: 'Betreuungsberichte', roi: 'Quartals-ROI', inbox: 'Posteingang', alert: 'Heiße Leads', geo: 'KI-Sichtbarkeit', reviews: 'Bewertungen', daily: 'Morgenlauf', onboarding: 'Onboarding', buchhaltung: 'Buchhaltung', beitraege: 'Beiträge der Woche', marketing: 'Marketing-Auswertung', anzeigenbilder: 'Anzeigenbilder' };
    let running = null;
    async function run(job, skipConfirm) {
        if (!RUNS[job]) return;
        if (running) { toast(RUNS[running] + ' läuft noch.'); return; }
        if (job === 'scout' && !skipConfirm && !confirm('Kasi sucht in OpenStreetMap nach Betrieben und misst bis zu 8 Websites. Das dauert einige Minuten. Starten?')) return;
        running = job;
        const dlg = $('#run-dialog');
        $('#run-title').textContent = RUNS[job] + ' läuft …';
        $('#run-output').textContent = 'Startet …';
        const bar = $('#run-progress');
        bar.hidden = false; bar.removeAttribute('value');
        $('#run-meta').textContent = 'Läuft seit 0:00';
        if (!dlg.open) dlg.showModal();
        const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        const poll = setInterval(async () => {
            try {
                const l = await api('run-live');
                if (l.seconds === undefined) return;
                const out = $('#run-output');
                const atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
                out.textContent = l.output.trim() || 'Startet …';
                if (atEnd) out.scrollTop = out.scrollHeight;
                const steps = [...l.output.matchAll(/\[(\d+)\/(\d+)\]/g)].pop();
                if (steps) { bar.max = Number(steps[2]); bar.value = Number(steps[1]); }
                const waiting = !steps && /…\s*$/.test(l.output) ? (/OpenStreetMap/.test(l.output) ? ' · wartet auf OpenStreetMap, das dauert oft 30 bis 90 Sekunden' : ' · arbeitet') : '';
                $('#run-meta').textContent = 'Läuft seit ' + fmt(l.seconds) + (steps ? ' · ' + steps[1] + ' von ' + steps[2] + ' Websites gemessen' : '') + waiting;
            } catch (_) { /* nächster Versuch */ }
        }, 1000);
        $$('[data-run]').forEach((b) => { b.disabled = true; });
        if (window.HarveyOrb) window.HarveyOrb.mode('thinking');
        try {
            const r = await api('run/' + job, {});
            $('#run-title').textContent = RUNS[job] + (r.ok ? ': fertig' : ': Fehler');
            $('#run-output').textContent = r.output || '(keine Ausgabe)';
        } catch (err) {
            $('#run-title').textContent = RUNS[job] + ': Fehler';
            $('#run-output').textContent = err.message;
        } finally {
            clearInterval(poll);
            bar.hidden = true;
            $('#run-meta').textContent = '';
            running = null;
            $$('[data-run]').forEach((b) => { b.disabled = false; });
            if (window.HarveyOrb && document.body.dataset.voice !== 'speaking') window.HarveyOrb.mode('idle');
            load();
            if (job === 'billing' || job === 'monitor') loadAgenda(false);
        }
    }
    $$('[data-run]').forEach((b) => b.addEventListener('click', () => run(b.dataset.run)));

    $$('[data-outbox]').forEach((b) => b.addEventListener('click', () => {
        captureDrafts();
        outboxFilter = b.dataset.outbox;
        $$('[data-outbox]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        renderOutbox();
    }));
    $$('[data-sub]').forEach((b) => b.addEventListener('click', () => {
        $$('[data-sub]').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
        $$('[data-subview]').forEach((v) => { v.hidden = v.dataset.subview !== b.dataset.sub; });
    }));

    async function load() {
        captureDrafts();
        try {
            data = await api('state');
        } catch (err) {
            toast('Daten nicht geladen: ' + err.message, true);
            return false;
        }
        $('#company').textContent = data.company.name;
        renderSetup(); renderZentrale(); renderLeads(); renderFinance(); renderClients(); renderCompany(); renderAgents(); renderTickets(); renderBooks(); renderMarketing();
        if (agenda) renderAgenda();
        return true;
    }

    /* ---------- Fokus-Modi der Zentrale ---------- */
    const MODES = { uebersicht: 'Übersicht', fokus: 'Fokus', agenten: 'Agenten', finanzen: 'Finanzen' };
    const pref = { get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* privat */ } } };
    function setMode(m, quiet) {
        if (!MODES[m]) m = 'uebersicht';
        const hud = $('#hud');
        if (hud.dataset.mode !== m) {
            hud.dataset.mode = m;
            hud.classList.remove('is-switching');
            void hud.offsetWidth; // Animation neu starten
            hud.classList.add('is-switching');
        }
        $$('[data-mode]', $('.seg-modes')).forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === m ? 'true' : 'false'));
        pref.set('harvey.mode', m);
        if (!quiet) logLocal('Ansicht · ' + MODES[m]);
    }
    $$('.seg-modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    setMode(pref.get('harvey.mode') || 'uebersicht', true);

    /* ---------- Projekte & Agenten ---------- */
    let projects = null;
    const ago = (iso) => {
        if (!iso) return 'noch nie';
        const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
        return m < 1 ? 'gerade eben' : m < 60 ? 'vor ' + m + ' Min.' : m < 1440 ? 'vor ' + Math.round(m / 60) + ' Std.' : 'vor ' + Math.round(m / 1440) + ' Tagen';
    };
    const gb = (b) => (b / 1073741824).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' GB';
    function sysRow(level, title, sub, right, action) {
        return h('li', { class: 'sys lv-' + level },
            h('span', { class: 'sys-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'sys-main' }, h('strong', { text: title }), sub ? h('span', { class: 'muted small', text: sub }) : null),
            right ? h('span', { class: 'sys-right', text: right }) : null, action || null);
    }
    function renderProjects() {
        if (!projects) return;
        const p = projects;
        const up = p.sites.filter((s) => s.ok).length;
        const repo = p.repos[0];
        setCount('agents', p.sites.length - up);
        $('#hud-meta').textContent = 'Dienste ' + up + '/' + p.sites.length + ' online · RAM ' + p.machine.memPct + ' % · geprüft ' + hm(p.checkedAt);

        // Kachel in der Zentrale
        $('#t-agents').replaceChildren(
            ...p.sites.slice(0, 4).map((s) => sysRow(s.level, s.name, null, s.ok ? s.ms + ' ms' : s.error || 'gestört')),
            repo ? sysRow(repo.level || 'bad', 'GitHub · ' + (repo.repo || repo.name), null, repo.ok ? (repo.changes ? repo.changes + ' offen' : 'sauber') : repo.error) : null,
            sysRow(p.docker.available ? (p.docker.containers.some((c) => c.level !== 'good') ? 'warn' : 'good') : 'off', 'Docker', null,
                p.docker.available ? p.docker.containers.filter((c) => c.state === 'running').length + '/' + p.docker.containers.length + ' laufen' : 'nicht installiert'),
            // im Modus „Agenten“ zusätzlich sichtbar
            ...p.agents.filter((a) => a.run).map((a) => {
                const row = sysRow(a.last ? 'good' : 'off', 'Agent · ' + a.name, a.task, ago(a.last),
                    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => run(a.run) }, 'Starten'));
                row.classList.add('sys-extra');
                return row;
            }),
            ...(repo && repo.ok ? [Object.assign(sysRow(repo.level, 'Letzter Commit · ' + repo.last.hash, repo.last.subject, ago(repo.last.date)), { className: 'sys sys-extra lv-' + repo.level })] : []),
            Object.assign(sysRow(p.machine.memPct > 90 ? 'bad' : p.machine.memPct > 75 ? 'warn' : 'good', 'Rechner · ' + p.machine.host, p.machine.cpus + ' Kerne · Node ' + p.machine.node, 'RAM ' + p.machine.memPct + ' %'), { className: 'sys sys-extra lv-' + (p.machine.memPct > 90 ? 'bad' : p.machine.memPct > 75 ? 'warn' : 'good') }));
        $('#t-agents-line').textContent = 'Rechner ' + p.machine.host + ' · RAM ' + p.machine.memPct + ' % · läuft seit ' + p.machine.uptimeH + ' Std.';

        // Ansicht „Agenten“
        $('#sites-meta').textContent = 'geprüft ' + hm(p.checkedAt);
        $('#sites').replaceChildren(...p.sites.map((s) => sysRow(s.level, s.name, s.url.replace(/^https:\/\//, ''), s.ok ? 'HTTP ' + s.status + ' · ' + s.ms + ' ms' : s.error || 'HTTP ' + s.status)));
        $('#repos').replaceChildren(...p.repos.map((r) => (r.ok
            ? sysRow(r.level, r.name, r.branch + ' · ' + r.last.hash + ' · ' + r.last.subject, (r.changes ? r.changes + ' Änderungen' : 'sauber') + (r.ahead ? ' · ' + r.ahead + ' nicht gepusht' : '') + (r.behind ? ' · ' + r.behind + ' zurück' : ''),
                r.github && r.github.url ? h('a', { class: 'link small', href: r.github.url, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub') : null)
            : sysRow('bad', r.name, null, r.error))),
        ...p.repos.filter((r) => r.github).map((r) => sysRow(r.github.error ? 'warn' : 'good', 'GitHub · ' + r.repo, r.github.error || 'letzter Push ' + ago(r.github.pushedAt) + (r.github.private ? ' · privat' : ' · öffentlich'), r.github.error ? null : r.github.issues + ' offene Issues')));
        $('#docker').replaceChildren(...(p.docker.available
            ? (p.docker.containers.length ? p.docker.containers.map((c) => sysRow(c.level, c.name, c.image, c.status)) : [sysRow('off', 'Keine Container', 'docker ps zeigt nichts an')])
            : [sysRow('off', 'Docker nicht gefunden', p.docker.disabled ? 'in data/projects.json abgeschaltet' : 'Docker Desktop installieren oder in data/projects.json „docker“: false setzen')]));
        const pct = p.machine.memPct;
        $('#machine').replaceChildren(
            h('div', { class: 'gauge-ring lv-' + (pct > 90 ? 'bad' : pct > 75 ? 'warn' : 'good') }, h('strong', { class: 'num-display', text: pct + ' %' }), h('span', { class: 'muted small', text: 'Arbeitsspeicher' })),
            h('dl', { class: 'kv kv-2' },
                h('div', {}, h('dt', { text: 'Belegt' }), h('dd', { text: gb(p.machine.memUsed) + ' / ' + gb(p.machine.memTotal) })),
                h('div', {}, h('dt', { text: 'Kerne' }), h('dd', { text: String(p.machine.cpus) })),
                h('div', {}, h('dt', { text: 'Läuft seit' }), h('dd', { text: p.machine.uptimeH + ' Std.' })),
                h('div', {}, h('dt', { text: 'Node' }), h('dd', { text: p.machine.node }))));
        $('#machine').style.setProperty('--pct', pct);
        $('#harvey-agents').replaceChildren(...p.agents.map((a) => sysRow(a.last ? (Date.now() - Date.parse(a.last) > 8 * 86400000 ? 'warn' : 'good') : 'off', a.name, a.task, a.run ? ago(a.last) : 'wartet auf Sie',
            a.run ? h('button', { type: 'button', class: 'btn btn-sm', 'data-run': a.run, onclick: () => run(a.run) }, 'Starten') : h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => go('zentrale', 'postausgang') }, 'Postausgang'))));
    }
    async function loadProjects(force) {
        try { projects = await api('projects' + (force ? '?refresh=1' : '')); renderProjects(); } catch (err) { if (force) toast('Prüfung fehlgeschlagen: ' + err.message, true); }
        pullStream();
    }
    $('#agents-refresh').addEventListener('click', async (ev) => {
        const b = ev.currentTarget; b.disabled = true; await loadProjects(true); b.disabled = false; toast('Geprüft');
    });

    /* ---------- Live-Aktivität (Ticker am Rand) ---------- */
    const streamLog = $('#stream-log');
    const seen = new Set();
    let streamSeq = 0;
    function streamLine(at, level, text, key) {
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        const t = new Date(at);
        const li = h('li', { class: 'st-' + level }, h('time', { text: t.toLocaleTimeString('de-DE') }), h('span', { text }));
        // nach Zeit einsortieren, neueste unten
        const after = Array.from(streamLog.children).find((x) => x.dataset.at > at);
        li.dataset.at = at;
        streamLog.insertBefore(li, after || null);
        while (streamLog.children.length > 80) streamLog.firstChild.remove();
        if (!after) { streamLog.scrollTop = streamLog.scrollHeight; $('#stream-last').textContent = text.slice(0, 60); }
    }
    function streamEvents() {
        data.events.slice(0, 15).forEach((ev) => streamLine(ev.at, /paid|matched/.test(ev.type) ? 'good' : /unmatched|paused/.test(ev.type) ? 'warn' : 'info',
            '◆ ' + ev.label + [ev.invoice, ev.name, ev.to, ev.amount ? euro(ev.amount) : null].filter(Boolean).map((x) => ' · ' + x).join(''), 'ev' + ev.at + ev.type));
    }
    function logLocal(text, level) { streamLine(new Date().toISOString(), level || 'info', '› ' + text); }
    async function pullStream() {
        try {
            const r = await api('activity?since=' + streamSeq);
            r.items.forEach((i) => streamLine(i.at, i.level, i.text, 'a' + i.seq));
            streamSeq = r.seq;
        } catch (err) { /* Server kurz weg */ }
    }
    const streamBox = $('#stream');
    const toggleBtn = $('#stream-toggle');
    const setStream = (open) => { streamBox.classList.toggle('is-collapsed', !open); toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); pref.set('harvey.stream', open ? '1' : '0'); };
    toggleBtn.addEventListener('click', () => setStream(streamBox.classList.contains('is-collapsed')));
    setStream(pref.get('harvey.stream') !== '0' && window.matchMedia('(min-width: 1500px)').matches);

    /* ---------- Vertriebs- & Betreuungs-Agenten ---------- */
    // Nicht eingerichtet ist kein Fehler: grau statt Warnung
    const notSetUp = (a) => !a.ok && /nicht eingerichtet|nicht verbunden|fehlt in .env|ANTHROPIC_API_KEY fehlt/i.test(a.summary || '');
    function renderAgents() {
        const ag = data.agents;
        if (!ag) return;
        setCount('agents', (projects ? projects.sites.filter((s) => !s.ok).length : 0) + ag.list.filter((a) => a.lastRun && !a.ok && !notSetUp(a)).length);
        $('#agent-list').replaceChildren(...ag.list.map((a) => {
            const level = !a.lastRun || notSetUp(a) ? 'off' : a.ok ? 'good' : 'warn';
            const row = sysRow(level, a.name, a.lastRun ? a.summary : a.task, a.lastRun ? ago(a.lastRun) : 'noch nie',
                a.job ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(a.job) }, 'Starten') : h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => $('#video-domain').focus() }, 'Aufnehmen'));
            if (a.notes && a.notes.length) {
                row.append(h('details', { class: 'sys-notes' }, h('summary', { text: a.notes.length + (a.notes.length === 1 ? ' Hinweis' : ' Hinweise') }), h('ul', {}, a.notes.map((n) => h('li', { text: n })))));
            }
            return row;
        }));
        $('#agent-setup').replaceChildren(...ag.setup.map((s) => h('li', { class: s.ok ? 'is-ok' : s.optional ? 'is-neutral' : 'is-todo' }, h('span', { class: 'dot', 'aria-hidden': 'true' }),
            h('span', {}, h('strong', { text: s.title }), h('span', { class: 'muted small', text: s.text }),
                s.action === 'google' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: connectGoogle }, 'Google verbinden') : null,
                s.action === 'bank' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { $('#bank-form').hidden = false; $('#bank-name').focus(); } }, 'Bank verbinden') : null))));
        $('#videos').replaceChildren(...(ag.videos.length ? ag.videos.slice(0, 8).map((v) => sysRow('good', v.domain, 'harvey-agent/' + v.dir + '/', ago(v.at),
            h('span', { class: 'btns' },
                h('a', { class: 'btn btn-sm btn-primary', href: '/' + v.dir + '/pitch-desktop.webm', target: '_blank', rel: 'noopener' }, 'Desktop'),
                h('a', { class: 'btn btn-sm', href: '/' + v.dir + '/pitch-handy.webm', target: '_blank', rel: 'noopener' }, 'Handy'),
                h('a', { class: 'btn btn-sm btn-ghost', href: '/' + v.dir + '/sprechtext.md', target: '_blank', rel: 'noopener' }, 'Sprechtext'),
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => api('open-folder', { domain: v.domain }).then(() => toast('Ordner geöffnet')).catch((err) => toast(err.message, true)) }, 'Ordner'))))
            : [h('li', { class: 'is-empty', text: 'Noch keine Videos.' })]));
    }
    const TCAT = { ausfall: 'Website nicht erreichbar', fehler: 'Fehler auf der Website', aenderung: 'Änderungswunsch', email: 'E-Mail / Postfach', rechnung: 'Rechnung', frage: 'Frage', sonstiges: 'Sonstiges' };
    const TSTATE = { offen: 'offen', in_arbeit: 'in Arbeit', erledigt: 'erledigt' };
    function renderTickets() {
        const list = data.tickets || [];
        const open = list.filter((t) => t.status !== 'erledigt');
        setCount('agents', (projects ? projects.sites.filter((s) => !s.ok).length : 0) + data.agents.list.filter((a) => a.lastRun && !a.ok && !notSetUp(a)).length + open.filter((t) => t.priority === 'hoch').length);
        $('#tickets').replaceChildren(...(list.length ? list.map((t) => {
            const level = t.status === 'erledigt' ? 'off' : t.priority === 'hoch' ? 'bad' : t.priority === 'normal' ? 'warn' : 'good';
            const chk = t.check ? (t.check.ok ? ' · Seite von hier erreichbar (' + t.check.ms + ' ms)' : ' · Störung bestätigt' + (t.check.status ? ' (HTTP ' + t.check.status + ')' : '')) : '';
            const mail = (data.outbox || []).find((e) => e.meta && e.meta.ticket === t.id && e.status !== 'gesendet');
            const next = t.status === 'offen' ? ['in_arbeit', 'In Arbeit'] : t.status === 'in_arbeit' ? ['erledigt', 'Erledigt'] : ['offen', 'Wieder öffnen'];
            return sysRow(level, t.client + ' · ' + TCAT[t.category], t.summary + chk, TSTATE[t.status] + ' · ' + t.priority + ' · ' + ago(t.createdAt),
                h('span', { class: 'btns' },
                    mail ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => window.Harvey.openMail(mail.id) }, 'Vorschlag') : null,
                    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ticketStatus(t.id, next[0]) }, next[1])));
        }) : [h('li', { class: 'is-empty', text: 'Keine Tickets. Mails von Bestandskunden landen hier, sobald das Postfach eingerichtet ist.' })]));
    }
    async function ticketStatus(id, status) {
        try { await api('ticket/' + id, { status }); toast('Ticket ' + TSTATE[status]); load(); } catch (err) { toast(err.message, true); }
    }
    function renderBooks() {
        const acc = (data.agents && data.agents.accounting) || {};
        const months = acc.months || [];
        $('#books-meta').textContent = acc.lexware ? 'Lexware Office verbunden' : 'ohne Lexware: DATEV-Export';
        $('#books').replaceChildren(...(months.length ? months.map((m) => sysRow(m.count ? 'good' : 'off', 'Monat ' + m.month, m.count + (m.count === 1 ? ' Buchung' : ' Buchungen') + ' · harvey-agent/' + m.dir + '/', ''))
            : [h('li', { class: 'is-empty', text: 'Noch nicht vorbereitet. Läuft im Morgenlauf mit.' })]));
        const pending = acc.pending || [];
        const btn = $('#lexware-push');
        btn.hidden = !(acc.lexware && pending.length);
        btn.textContent = 'An Lexware übertragen (' + pending.length + ')';
    }
    $('#lexware-push').addEventListener('click', async () => {
        const pending = ((data.agents && data.agents.accounting) || {}).pending || [];
        if (!confirm('Zweiter Blick: ' + pending.length + (pending.length === 1 ? ' gestellte Rechnung' : ' gestellte Rechnungen') + ' (' + pending.slice(0, 5).join(', ') + (pending.length > 5 ? ' …' : '') + ') an Lexware Office übertragen?')) return;
        try { const r = await api('accounting/push', { confirm: true }); toast(r.ok ? 'An Lexware übertragen' : 'Fehler: ' + (r.output || '').split('\n').pop(), !r.ok); } catch (err) { toast(err.message, true); }
        await api('run/buchhaltung', {}).catch(() => {});
        load();
    });
    /* ---------- Marketing ---------- */
    const LP = { 'webdesign-augsburg': 'Webdesign Augsburg', 'webdesign-muenchen': 'Webdesign München', 'website-fuer-maler': 'Website für Maler', 'website-fuer-handwerksbetriebe': 'Website für Handwerksbetriebe' };
    const CSTATE = { entwurf: 'Entwurf', aktiv: 'läuft', pausiert: 'pausiert', beendet: 'beendet' };
    const BRAND = [['positioning', 'Positionierung'], ['promise', 'Versprechen'], ['audience', 'Zielgruppe'], ['proof', 'Belege'], ['tone', 'Tonalität'], ['colors', 'Farben & Schrift']];
    const n1 = (n, one, many) => (n || 0) + ' ' + ((n || 0) === 1 ? one : many);
    const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
    async function copyText(text, label) {
        try { await navigator.clipboard.writeText(text); toast((label || 'Text') + ' kopiert'); } catch (_) { toast('Kopieren nicht möglich', true); }
    }
    function renderMarketing() {
        const m = data.marketing;
        if (!m) return;
        const run = m.run || {};
        const stats = run.stats || [];
        const total = stats.reduce((a, s) => a + s.leads, 0);
        const PAID = ['instagram', 'meta', 'facebook'];
        const paid = stats.filter((s) => PAID.includes(s.source) && s.medium !== 'bio').reduce((a, s) => a + s.leads, 0);
        const seo = stats.filter((s) => s.source === 'website').reduce((a, s) => a + s.leads, 0);
        const spend = m.campaigns.reduce((a, c) => a + (Number(c.spend) || 0), 0);
        setCount('marketing', (run.reminders || []).length);
        $('#mkt-meta').textContent = run.lastRun ? 'Stand ' + ago(run.lastRun) + ' · ' + run.summary : 'Noch keine Auswertung. Läuft im Morgenlauf mit.';
        $('#mkt-kpis').replaceChildren(...[
            ['Anfragen gesamt', String(total), 'aus dem Web-Dashboard'],
            ['über Anzeigen', String(paid), spend ? eur(spend) + ' ausgegeben' + (paid ? ' · ' + eur(spend / paid) + ' je Anfrage' : '') : 'noch keine Ausgaben eingetragen'],
            ['über Unterseiten', String(seo), 'Regionen und Branchen'],
            ['Bewertungen offen', String((run.reminders || []).length), 'persönlich anfragen']
        ].map(([t, v, sub]) => stat(t, v, sub, { cls: 'lg:col-span-3' })));

        renderVisits(run.visits);
        renderGoogleData(run.google);
        const imgs = run.creatives || [];
        $('#campaigns').replaceChildren(...m.campaigns.map((c) => {
            const r = c.result || {};
            const status = h('select', { 'aria-label': 'Status der Kampagne' }, ...Object.entries(CSTATE).map(([k, v]) => h('option', { value: k, selected: c.status === k ? 'selected' : null }, v)));
            const spendIn = h('input', { type: 'number', min: '0', step: '1', value: String(c.spend || 0), inputmode: 'decimal', 'aria-label': 'Ausgaben bisher in Euro' });
            const save = async () => { try { await api('marketing/campaign/' + c.id, { status: status.value, spend: spendIn.value }); toast('Kampagne gespeichert'); load(); } catch (err) { toast(err.message, true); } };
            status.addEventListener('change', save);
            spendIn.addEventListener('change', save);
            return h('article', { class: 'campaign' },
                h('header', { class: 'campaign-head' },
                    h('div', {}, h('h3', { text: c.name }), h('p', { class: 'muted small', text: c.start + ' bis ' + c.end + ' · ' + eur(c.budgetDay) + ' pro Tag · Ziel: ' + c.objective })),
                    h('div', { class: 'campaign-ctl' }, h('label', {}, h('span', { class: 'small muted', text: 'Status' }), status), h('label', {}, h('span', { class: 'small muted', text: 'Ausgaben €' }), spendIn))),
                h('p', { class: 'campaign-result', text: n1(r.leads, 'Anfrage', 'Anfragen') + ' · ' + n1(r.termin, 'Termin', 'Termine') + ' · ' + n1(r.auftrag, 'Auftrag', 'Aufträge') + (r.costPerLead ? ' · ' + eur(r.costPerLead) + ' je Anfrage' : '') }),
                h('div', { class: 'ads' }, ...(c.ads || []).map((ad) => {
                    const pics = imgs.filter((f) => f.includes('/' + c.id + '/' + ad.id + '-'));
                    const n = stats.find((s) => s.campaign === c.id);
                    const hits = n && n.content ? n.content[ad.id] || 0 : 0;
                    return h('div', { class: 'ad' },
                        pics.length ? h('div', { class: 'ad-pics' }, ...pics.map((f) => h('a', { href: '/' + f, target: '_blank', rel: 'noopener', title: 'Bild öffnen' }, h('img', { src: '/' + f, alt: 'Anzeigenbild ' + ad.title + (f.includes('story') ? ' (Story)' : ' (Feed)'), loading: 'lazy', class: f.includes('story') ? 'is-story' : '' })))) : h('p', { class: 'muted small', text: 'Noch keine Bilder: „Anzeigenbilder erstellen“' }),
                        h('h4', { text: ad.headline }),
                        h('p', { class: 'ad-text', text: ad.primary }),
                        h('p', { class: 'muted small', text: 'Beschreibung: ' + ad.description + ' · Button: ' + ad.cta + ' · ' + hits + (hits === 1 ? ' Anfrage' : ' Anfragen') }),
                        h('div', { class: 'btns' },
                            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(ad.primary, 'Anzeigentext') }, 'Text kopieren'),
                            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(ad.headline, 'Überschrift') }, 'Überschrift'),
                            h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => copyText(ad.url, 'Link') }, 'Link kopieren')));
                })),
                h('details', { class: 'sys-notes' }, h('summary', { text: 'Zielgruppe & Einstellungen' }), h('ul', {}, c.targeting.map((t) => h('li', { text: t })))),
                h('details', { class: 'sys-notes' }, h('summary', { text: 'Checkliste vor dem Start' }), h('ul', {}, c.checklist.map((t) => h('li', { text: t })))));
        }));

        $('#mkt-sources-meta').textContent = stats.length ? 'Anfragen seit Start des Web-Dashboards' : '';
        $('#mkt-sources').replaceChildren(...(stats.length ? [
            h('thead', {}, h('tr', {}, ...['Herkunft', 'Anfragen', 'Termine', 'Aufträge', 'Umsatz'].map((t) => h('th', { scope: 'col', text: t })))),
            h('tbody', {}, ...stats.map((s) => h('tr', {},
                h('th', { scope: 'row', text: s.source === 'instagram' && s.medium === 'bio' ? 'Instagram · Bio-Link' : s.source === 'website' && LP[s.campaign] ? 'Unterseite · ' + LP[s.campaign] : (m.campaigns.find((c) => c.id === s.campaign) || {}).name || s.key }),
                h('td', { text: String(s.leads) }), h('td', { text: String(s.termin) }), h('td', { text: String(s.auftrag) }),
                h('td', { text: s.valueOnce || s.valueMonth ? eur(s.valueOnce) + (s.valueMonth ? ' + ' + eur(s.valueMonth) + '/Mon.' : '') : '–' }))))
        ] : [h('tbody', {}, h('tr', {}, h('td', { class: 'muted', text: 'Noch keine Auswertung. „Auswertung aktualisieren“ oder der Morgenlauf holt die Zahlen.' })))]));

        const pages = run.pages || Object.keys(LP).map((slug) => ({ slug }));
        $('#lp-pages').replaceChildren(...pages.map((p) => {
            const n = stats.find((s) => s.source === 'website' && s.campaign === p.slug);
            return sysRow(p.ok === undefined ? 'off' : p.ok ? 'good' : 'bad', LP[p.slug] || p.slug, 'mw-itservices.de/' + p.slug + '/' + (n ? ' · ' + n.leads + (n.leads === 1 ? ' Anfrage' : ' Anfragen') : ''),
                p.ok === undefined ? 'noch nicht geprüft' : p.ok ? p.ms + ' ms' : 'nicht erreichbar',
                h('a', { class: 'btn btn-sm btn-ghost', href: 'https://mw-itservices.de/' + p.slug + '/', target: '_blank', rel: 'noopener noreferrer' }, 'Öffnen'));
        }));

        const form = $('#brand-form');
        if (!form.dataset.dirty) {
            form.replaceChildren(...BRAND.map(([k, label]) => h('label', { class: 'row row-top' }, h('span', { text: label }), (() => { const t = h('textarea', { name: k, rows: '2' }); t.value = m.brand[k] || ''; return t; })())),
                h('label', { class: 'row row-top' }, h('span', { text: 'Slogans (je Zeile einer)' }), (() => { const t = h('textarea', { name: 'claims', rows: '3' }); t.value = (m.brand.claims || []).join('\n'); return t; })()),
                h('div', { class: 'btns' }, h('span', { class: 'muted small', id: 'brand-msg' }), h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Marke speichern')));
        }

        const rem = new Set((run.reminders || []).map((r) => r.id));
        $('#review-list').replaceChildren(...(m.clients.length ? m.clients.map((c) => sysRow(c.reviewAskedAt ? 'good' : rem.has(c.id) ? 'warn' : 'off', c.company,
            (c.reviewAskedAt ? 'Bewertung angefragt am ' + c.reviewAskedAt : rem.has(c.id) ? 'jetzt persönlich nach einer Bewertung fragen' : 'nach dem Livegang fragen') + ' · Referenz ' + (c.reference ? 'freigegeben' : 'nicht freigegeben'), '',
            h('span', { class: 'btns' },
                c.reviewAskedAt ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => mktClient(c.id, { asked: true }) }, 'Gefragt'),
                h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => mktClient(c.id, { reference: !c.reference }) }, c.reference ? 'Freigabe zurücknehmen' : 'Referenz freigegeben'))))
            : [h('li', { class: 'is-empty', text: 'Noch keine Kunden. Nach dem ersten Auftrag erscheinen sie hier.' })]));
    }
    const EVT = { check: 'Website-Check gestartet', planer: 'Planer geöffnet', anfrage: 'Anfrage gesendet', tel: 'Telefon angetippt', mail: 'Mail angetippt', whatsapp: 'WhatsApp', instagram: 'Instagram', termin: 'Erstgespräch' };
    const SRC = { direkt: 'direkt / Lesezeichen', google: 'Google', suche: 'andere Suchmaschine', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', ki: 'KI-Assistent', verweis: 'andere Website', signatur: 'Mail-Signatur', website: 'eigene Unterseiten' };
    const bars = (rows, label, max) => h('ul', { class: 'bars' }, ...rows.map(([k, n]) => h('li', {},
        h('span', { class: 'bar-label', text: label(k) }), h('span', { class: 'bar' }, h('i', { style: 'width:' + Math.max(3, Math.round(n / (max || 1) * 100)) + '%' })), h('b', { text: String(n) }))));
    function renderVisits(v) {
        const box = $('#visits');
        if (!v) return box.replaceChildren(h('p', { class: 'muted small', text: 'Noch keine Zahlen. Die Zählung startet, sobald die Website mit dem Zähler live ist; Auswertung im Morgenlauf.' }));
        const dayMax = Math.max(1, ...v.days.map((d) => d[1]));
        box.replaceChildren(
            h('p', { class: 'visits-total' }, h('b', { text: String(v.views) }), ' Seitenaufrufe seit ' + new Date(v.since).toLocaleDateString('de-DE')),
            h('div', { class: 'spark', role: 'img', 'aria-label': 'Seitenaufrufe pro Tag' }, ...v.days.map(([d, n]) => h('i', { style: 'height:' + Math.max(4, Math.round(n / dayMax * 100)) + '%', title: new Date(d).toLocaleDateString('de-DE') + ': ' + n }))),
            h('div', { class: 'visits-grid' },
                h('div', {}, h('h3', { text: 'Herkunft' }), v.sources.length ? bars(v.sources, (k) => SRC[k] || k, v.sources[0][1]) : h('p', { class: 'muted small', text: '–' })),
                h('div', {}, h('h3', { text: 'Seiten' }), v.pages.length ? bars(v.pages, (k) => k === '/' ? 'Startseite' : LP[k.replace(/\//g, '')] || k, v.pages[0][1]) : h('p', { class: 'muted small', text: '–' })),
                h('div', {}, h('h3', { text: 'Klicks' }), v.events.length ? bars(v.events, (k) => EVT[k] || k, v.events[0][1]) : h('p', { class: 'muted small', text: 'Noch keine Klicks.' }))));
    }
    function renderGoogleData(g) {
        const box = $('#gdata');
        $('#gdata-meta').textContent = g && g.connected ? 'Search Console und Unternehmensprofil' : 'nicht verbunden';
        if (!g || !g.connected) return box.replaceChildren(h('p', { class: 'muted small', text: 'Google ist noch nicht verbunden (Agenten → Einrichtung → „Google verbinden“). Dann stehen hier Klicks und Suchbegriffe aus der Google-Suche und Aufrufe, Anrufe und Routen aus dem Unternehmensprofil.' }));
        const parts = [];
        if (g.search) {
            const t = g.search.totals;
            parts.push(h('h3', { text: 'Google-Suche (28 Tage)' }), h('p', { class: 'gnums' }, h('span', {}, h('b', { text: String(t.clicks) }), ' Klicks'), h('span', {}, h('b', { text: String(t.impressions) }), ' Einblendungen'), t.position ? h('span', {}, h('b', { text: String(t.position).replace('.', ',') }), ' Ø Position') : null));
            if (g.search.queries.length) parts.push(h('table', { class: 'mkt-table' }, h('thead', {}, h('tr', {}, ...['Suchbegriff', 'Klicks', 'Einbl.', 'Pos.'].map((x) => h('th', { scope: 'col', text: x })))),
                h('tbody', {}, ...g.search.queries.slice(0, 10).map((q) => h('tr', {}, h('th', { scope: 'row', text: q.key }), h('td', { text: String(q.clicks) }), h('td', { text: String(q.impressions) }), h('td', { text: q.position ? String(q.position).replace('.', ',') : '–' }))))));
        } else parts.push(h('p', { class: 'muted small', text: 'Search Console: ' + (g.searchNote || 'keine Daten') }));
        if (g.profile) {
            const m = g.profile.metrics;
            parts.push(h('h3', { text: 'Unternehmensprofil (28 Tage)' }), h('p', { class: 'gnums' }, h('span', {}, h('b', { text: String(m.viewsSearch + m.viewsMaps) }), ' Aufrufe'), h('span', {}, h('b', { text: String(m.calls) }), ' Anrufe'), h('span', {}, h('b', { text: String(m.websiteClicks) }), ' Website-Klicks'), h('span', {}, h('b', { text: String(m.directions) }), ' Routen')));
            if ((g.profile.keywords || []).length) parts.push(h('p', { class: 'muted small', text: 'Gefunden über: ' + g.profile.keywords.slice(0, 8).map((k) => k.keyword).join(', ') }));
        } else parts.push(h('p', { class: 'muted small', text: 'Unternehmensprofil: ' + (g.profileNote || 'keine Daten') }));
        box.replaceChildren(...parts);
    }
    async function mktClient(id, body) {
        try { await api('marketing/client/' + id, body); toast('Gespeichert'); load(); } catch (err) { toast(err.message, true); }
    }
    $('#brand-form').addEventListener('input', () => { $('#brand-form').dataset.dirty = '1'; });
    $('#brand-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const body = {};
        BRAND.forEach(([k]) => { body[k] = f.elements[k].value; });
        body.claims = f.elements.claims.value.split('\n').map((x) => x.trim()).filter(Boolean);
        try { await api('marketing/brand', body); delete f.dataset.dirty; $('#brand-msg').textContent = 'Gespeichert'; load(); } catch (err) { $('#brand-msg').textContent = err.message; }
    });

    async function connectGoogle() {
        try { const r = await api('google/connect', {}); window.open(r.url, '_blank', 'noopener'); toast('Google-Anmeldung im neuen Fenster abschließen, dann hier neu laden.'); } catch (err) { toast(err.message, true); }
    }
    $('#bank-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const msg = $('#bank-msg');
        try { const r = await api('bank/connect', { bank: $('#bank-name').value }); window.open(r.url, '_blank', 'noopener'); msg.textContent = 'Bei der Bank freigeben, dann die Adresse der Zielseite unten einfügen.'; } catch (err) { msg.textContent = err.message; }
    });
    $('#bank-finish').addEventListener('click', async () => {
        const msg = $('#bank-msg');
        try { const r = await api('bank/code', { code: $('#bank-code').value }); msg.textContent = 'Verbunden: ' + r.accounts + ' Konto/Konten.'; $('#bank-form').hidden = true; load(); } catch (err) { msg.textContent = err.message; }
    });
    $('#video-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = $('#video-domain').value.trim();
        if (!d) { $('#video-domain').focus(); return; }
        const b = $('button', ev.currentTarget);
        b.disabled = true; b.textContent = 'Wird aufgenommen …';
        logLocal('Video-Pitch · ' + d);
        try {
            const r = await api('video', { domain: d });
            toast(r.ok ? 'Video fertig: harvey-agent/out/video/' + d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') + '/' : (r.output || 'Fehler').split('\n').pop(), !r.ok);
        } catch (err) { toast(err.message, true); }
        b.disabled = false; b.textContent = 'Video aufnehmen';
        load();
    });

    window.Harvey = { data: () => data, agenda: () => agenda, projects: () => projects, go, run, reload: load, setMode, modes: MODES, api, toast, log: logLocal,
        openMail(id) { open.add(id); outboxFilter = 'open'; renderOutbox(); go('zentrale', 'postausgang'); } };

    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => { captureDrafts(); if (drafts.size || formDirty) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
    route();
    tick();
    setInterval(tick, 15000);
    /* Morgenlauf beim ersten Besuch am Tag: läuft im Hintergrund, Stand an der Kugel,
       danach frische Daten und erst dann das Briefing */
    async function morningRun() {
        let status;
        try { status = (await api('morning', {})).status; } catch (_) { return; }
        if (status === 'done') return;
        const box = $('#morning');
        const bar = $('#morning-bar');
        box.hidden = false;
        if (window.HarveyOrb) window.HarveyOrb.mode('thinking');
        await new Promise((resolve) => {
            const tick = async () => {
                try {
                    const l = await api('run-live?slot=daily');
                    const steps = [...(l.output || '').matchAll(/\[(\d+)\/(\d+)\] ([^\n…]+)/g)].pop();
                    if (steps) { bar.max = Number(steps[2]); bar.value = Number(steps[1]) - (l.done ? 0 : 0.5); }
                    $('#morning-text').textContent = l.done ? 'Morgenlauf fertig' : 'Morgenlauf' + (steps ? ' · ' + steps[1] + ' von ' + steps[2] + ': ' + steps[3].trim() : ' startet …');
                    if (l.done) return resolve();
                } catch (_) { /* nächster Versuch */ }
                setTimeout(tick, 1200);
            };
            tick();
        });
        bar.value = bar.max;
        await Promise.all([load(), loadAgenda(false)]);
        if (window.HarveyOrb && document.body.dataset.voice !== 'speaking') window.HarveyOrb.mode('idle');
        setTimeout(() => { box.hidden = true; }, 4000);
    }

    setInterval(() => loadAgenda(false), 5 * 60000);
    setInterval(() => loadProjects(false), 5 * 60000);
    setInterval(() => { if (!document.hidden) pullStream(); }, 4000);
    (async () => {
        const ok = await load();
        await Promise.all([loadAgenda(false), loadProjects(false)]);
        if (!ok) return;
        await morningRun();
        document.dispatchEvent(new CustomEvent('harvey:ready'));
    })();
}());
