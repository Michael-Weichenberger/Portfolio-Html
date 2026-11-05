/* =============================================================================
   KASI ZENTRALE · Command Palette (Strg+K / Cmd+K)
   Befehle und Spotlight-Suche über Leads, Vorschläge, Kunden, Rechnungen,
   Mails und Termine. Zwei Befehle haben ein kleines Formular in der Palette:
   „Neuen Lead anlegen“ und „Rechnung generieren“.
   Senden ist hier bewusst kein Befehl: „Postausgang öffnen“ führt zur
   Freigabe per Klick (Vier-Augen-Prinzip).
   ============================================================================= */
(function () {
    'use strict';

    const $ = (s, r = document) => r.querySelector(s);
    const dlg = $('#palette');
    const input = $('#pal-input');
    const list = $('#pal-list');
    const body = $('#pal-body');
    if (!dlg || !input) return;
    const H = () => window.Harvey;
    const V = () => window.HarveyVoice;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const hint = $('#kbd-hint');
    if (hint) hint.textContent = isMac ? '⌘ K' : 'Strg K';

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
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

    /* ---------- Befehle ---------- */
    const COMMANDS = [
        { g: 'Aktion', t: 'Neuen Lead anlegen', k: 'lead hinzufügen domain betrieb akquise neu', run: () => leadForm() },
        { g: 'Aktion', t: 'Rechnung generieren', k: 'rechnung entwurf erstellen kunde invoice', run: () => invoicePick() },
        { g: 'Aktion', t: 'Briefing wiederholen', k: 'briefing vorlesen zusammenfassung morgen', run: () => V() && V().briefing(false) },
        { g: 'Aktion', t: 'Status vorlesen', k: 'status lage sprechen', run: () => V() && V().handle('Status') },
        { g: 'Aktion', t: 'Spracheingabe starten', k: 'mikrofon sprechen voice alt m', hint: 'Alt M', run: () => $('#mic') && $('#mic').click() },
        { g: 'Agent', t: 'Kontoauszug abgleichen', k: 'monitor zahlung bank csv', run: () => H().run('monitor') },
        { g: 'Agent', t: 'Mahn-Check ausführen', k: 'billing mahnung mahnstufen offene posten', run: () => H().run('billing') },
        { g: 'Agent', t: 'Betreuungs-Rechnungen entwerfen', k: 'monatlich care monthly', run: () => H().run('monthly') },
        { g: 'Agent', t: 'Neue Betriebe suchen (Scout)', k: 'scout osm suche betriebe', run: () => H().run('scout') },
        { g: 'Agent', t: 'Akquise-Liste messen', k: 'pipeline messen analyse', run: () => H().run('pipeline') },
        { g: 'Agent', t: 'Morgenlauf jetzt starten (alle Agenten)', k: 'daily alle agenten morgen', run: () => H().run('daily') },
        { g: 'Agent', t: 'Posteingang einordnen', k: 'inbox antworten mails einordnen', run: () => H().run('inbox') },
        { g: 'Agent', t: 'Angebote nachfassen', k: 'nachfass followup angebot erinnerung', run: () => H().run('followup') },
        { g: 'Agent', t: 'Termine vorbereiten', k: 'termin vorbereitung gespräch', run: () => H().run('termine') },
        { g: 'Agent', t: 'Heiße Leads prüfen', k: 'alarm hot leads whatsapp', run: () => H().run('alert') },
        { g: 'Agent', t: 'Kunden-Websites prüfen (Wächter)', k: 'watch wächter uptime ssl', run: () => H().run('watch') },
        { g: 'Agent', t: 'Betreuungsberichte entwerfen', k: 'report bericht monat betreuung', run: () => H().run('report') },
        { g: 'Agent', t: 'Quartals-ROI-Berichte entwerfen', k: 'roi quartal wert', run: () => H().run('roi') },
        { g: 'Agent', t: 'KI-Sichtbarkeit prüfen', k: 'geo ki chatgpt sichtbarkeit', run: () => H().run('geo') },
        { g: 'Agent', t: 'Google-Bewertungen prüfen', k: 'reviews bewertungen google', run: () => H().run('reviews') },
        { g: 'Agent', t: 'Onboarding neuer Kunden', k: 'onboarding willkommen kunde neu ordner', run: () => H().run('onboarding') },
        { g: 'Agent', t: 'Buchhaltung vorbereiten (DATEV, Lexware)', k: 'buchhaltung datev lexware lexoffice steuerberater export', run: () => H().run('buchhaltung') },
        { g: 'Agent', t: 'Beiträge der Woche schreiben (Google, LinkedIn)', k: 'beitraege beitrag social linkedin google post content seo', run: () => H().run('beitraege') },
        { g: 'Ansicht', t: 'Support-Tickets', k: 'support tickets kunden probleme', run: () => { H().go('agenten'); setTimeout(() => { const t = document.getElementById('h-tickets'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); } },
        { g: 'Agent', t: 'Video-Pitch aufnehmen', k: 'video loom pitch aufnahme', run: () => { H().go('agenten'); setTimeout(() => $('#video-domain') && $('#video-domain').focus(), 60); } },
        { g: 'Agent', t: 'Projekte und Server jetzt prüfen', k: 'monitor websites github docker server agenten', run: () => { H().go('agenten'); $('#agents-refresh').click(); } },
        { g: 'Ansicht', t: 'Postausgang öffnen (Freigeben & Senden)', k: 'senden mails freigeben postausgang', run: () => { H().setMode('fokus'); H().go('zentrale', 'postausgang'); } },
        ...[['uebersicht', 'Übersicht'], ['fokus', 'Fokus'], ['agenten', 'Agenten'], ['finanzen', 'Finanzen']].map(([m, n]) => ({ g: 'Modus', t: 'Zentrale: ' + n, k: 'modus ansicht ' + n, run: () => { H().go('zentrale'); H().setMode(m); } })),
        ...[['leads', 'Leads & Scout'], ['finanzen', 'Finanzen & Mahnwesen'], ['termine', 'Termine'], ['agenten', 'Projekte & Agenten'], ['stammdaten', 'Kunden & Stammdaten']].map(([v, n]) => ({ g: 'Ansicht', t: n, k: 'öffnen gehe zu ' + v, run: () => H().go(v) })),
        { g: 'Ansicht', t: 'Kalender anbinden', k: 'ical google cal.com termine kalender hinzufügen', run: () => { H().go('termine'); setTimeout(() => $('#cal-url') && $('#cal-url').focus(), 60); } },
        { g: 'Ansicht', t: 'Firmendaten bearbeiten', k: 'stammdaten iban steuer adresse einstellungen', run: () => H().go('stammdaten') },
        { g: 'Ansicht', t: 'Live-Aktivität ein/aus', k: 'ticker stream log terminal', run: () => $('#stream-toggle').click() }
    ];

    /* ---------- Spotlight: Daten durchsuchen ---------- */
    function searchData(q) {
        const d = H() && H().data();
        if (!d || q.length < 2) return [];
        const hit = (...f) => f.some((x) => norm(x).includes(q));
        const out = [];
        (d.scout ? d.scout.suggestions : []).forEach((s) => { if (hit(s.name, s.domain)) out.push({ g: 'Vorschlag', t: s.name, sub: s.domain + ' · Druck ' + s.pain, run: () => H().go('leads') }); });
        d.leads.forEach((l) => { if (hit(l.name, l.domain, l.city)) out.push({ g: 'Lead', t: l.name || l.domain, sub: l.domain + ' · ' + l.status, run: () => { H().go('leads'); const b = $('[data-sub="akquise"]'); if (b) b.click(); } }); });
        d.clients.forEach((c) => { if (hit(c.company, c.id, c.email, (c.domains || []).join(' '))) out.push({ g: 'Kunde', t: c.company, sub: c.id + (c.email ? ' · ' + c.email : ''), run: () => H().go('stammdaten') }); });
        d.invoices.forEach((i) => { if (hit(i.number, i.client)) out.push({ g: 'Rechnung', t: i.number + ' · ' + i.client, sub: i.status + ' · ' + new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(i.open), run: () => H().go('finanzen') }); });
        d.outbox.forEach((e) => { if (hit(e.subject, e.to, e.ref, e.meta && e.meta.client)) out.push({ g: 'Mail', t: e.subject, sub: (e.to || '') + ' · ' + e.status, run: () => { H().setMode('fokus'); H().openMail(e.id); } }); });
        const ag = H().agenda();
        (ag ? ag.events : []).forEach((e) => { if (hit(e.title, e.location)) out.push({ g: 'Termin', t: e.title, sub: new Date(e.start).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), run: () => H().go('termine') }); });
        return out.slice(0, 12);
    }

    let items = [];
    let active = 0;
    function score(c, q) {
        const t = norm(c.t);
        const k = norm(c.k || '');
        if (t.startsWith(q)) return 3;
        if (t.includes(q)) return 2;
        return q.split(/\s+/).every((w) => t.includes(w) || k.split(' ').some((x) => x.startsWith(w))) ? 1 : 0;
    }
    function render() {
        const q = norm(input.value.trim());
        const cmds = q ? COMMANDS.map((c) => [c, score(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c) : COMMANDS.filter((c) => c.g !== 'Modus' || true);
        items = [...cmds.slice(0, q ? 10 : 30), ...searchData(q)];
        if (/senden|verschick|abschick/.test(q)) items.unshift({ g: 'Hinweis', t: 'Senden geht nur im Postausgang per Klick', sub: 'Mail öffnen, prüfen, „Freigeben & Senden“, dann bestätigen', run: () => { H().setMode('fokus'); H().go('zentrale', 'postausgang'); } });
        active = Math.min(active, Math.max(0, items.length - 1));
        let lastGroup = '';
        list.replaceChildren(...(items.length ? items.flatMap((c, i) => {
            const nodes = [];
            if (c.g !== lastGroup) { nodes.push(h('li', { class: 'pal-group', role: 'presentation', text: c.g })); lastGroup = c.g; }
            nodes.push(h('li', { id: 'pal-' + i, class: 'pal-item' + (i === active ? ' is-active' : ''), role: 'option', 'aria-selected': i === active ? 'true' : 'false',
                onmousemove: () => { if (active !== i) { active = i; paintActive(); } }, onclick: () => exec(i) },
            h('span', { class: 'pal-t' }, h('strong', { text: c.t }), c.sub ? h('span', { class: 'muted small', text: c.sub }) : null),
            c.hint ? h('kbd', { text: c.hint }) : h('span', { class: 'pal-enter', 'aria-hidden': 'true', text: '↵' })));
            return nodes;
        }) : [h('li', { class: 'pal-empty', text: 'Nichts gefunden. Probieren Sie „Lead“, „Rechnung“ oder einen Firmennamen.' })]));
        paintActive();
    }
    function paintActive() {
        list.querySelectorAll('.pal-item').forEach((el) => {
            const on = el.id === 'pal-' + active;
            el.classList.toggle('is-active', on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) el.scrollIntoView({ block: 'nearest' });
        });
        input.setAttribute('aria-activedescendant', items.length ? 'pal-' + active : '');
    }
    function exec(i) {
        const c = items[i];
        if (!c) return;
        const keepOpen = c.run === undefined;
        if (H() && H().log) H().log('Befehl · ' + c.t);
        const r = c.run && c.run();
        if (!keepOpen && !(r && r.keep)) close();
    }

    /* ---------- Formulare in der Palette ---------- */
    function panel(title, ...content) {
        body.replaceChildren(h('div', { class: 'pal-form' },
            h('div', { class: 'pal-form-head' }, h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: back }, '← Zurück'), h('strong', { text: title })),
            ...content));
        input.hidden = true;
        $('.pal-search', dlg).classList.add('is-form');
    }
    function back() {
        input.hidden = false;
        $('.pal-search', dlg).classList.remove('is-form');
        body.replaceChildren(list);
        input.focus();
        render();
    }
    function leadForm() {
        const msg = h('p', { class: 'form-msg', role: 'status' });
        const f = h('form', { class: 'form form-compact', novalidate: true },
            field('Domain', h('input', { name: 'domain', type: 'text', inputmode: 'url', placeholder: 'huber-maler.de', required: true, autocomplete: 'off', spellcheck: 'false' })),
            field('Name', h('input', { name: 'name', type: 'text', placeholder: 'Malerbetrieb Huber', autocomplete: 'off' })),
            field('Ort', h('input', { name: 'city', type: 'text', placeholder: 'Augsburg', autocomplete: 'off' })),
            field('Kontaktweg', h('select', { name: 'contact' },
                h('option', { value: 'brief', text: 'Brief per Post' }), h('option', { value: 'persoenlich', text: 'Persönlich' }),
                h('option', { value: 'bestehend', text: 'Bestehender Kontakt' }), h('option', { value: 'einwilligung', text: 'Einwilligung liegt vor (E-Mail erlaubt)' }))),
            h('p', { class: 'muted small', text: 'Werbe-Mails nur mit Einwilligung (§ 7 UWG). Gemessen wird beim nächsten „Akquise-Liste messen“.' }),
            msg, h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Lead anlegen'));
        f.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const btn = f.querySelector('button[type="submit"]');
            btn.disabled = true; msg.textContent = 'Wird angelegt …';
            try {
                const r = await H().api('lead/add', { domain: f.domain.value, name: f.name.value, city: f.city.value, contact: f.contact.value });
                msg.textContent = r.output || (r.ok ? 'Angelegt.' : 'Fehler');
                if (r.ok) { H().toast('Lead angelegt'); H().reload(); setTimeout(close, 700); }
            } catch (err) { msg.textContent = err.message; }
            btn.disabled = false;
        });
        panel('Neuen Lead anlegen', f);
        f.domain.focus();
        return { keep: true };
    }
    function invoicePick() {
        const d = H().data();
        const msg = h('p', { class: 'form-msg', role: 'status' });
        const clients = d ? d.clients : [];
        panel('Rechnung generieren',
            clients.length ? h('ul', { class: 'pal-list' }, clients.map((c) => h('li', { class: 'pal-item', role: 'button', tabindex: '0',
                onclick: () => draft(c), onkeydown: (ev) => { if (ev.key === 'Enter') draft(c); } },
            h('span', { class: 'pal-t' }, h('strong', { text: c.company }), h('span', { class: 'muted small', text: c.id + (c.package ? ' · Paket ' + [c.package.base, ...(c.package.extras || [])].filter(Boolean).join(' + ') : '') })),
            h('span', { class: 'pal-enter', 'aria-hidden': 'true', text: '↵' }))))
                : h('p', { class: 'muted', text: 'Noch keine Kunden. Übernahme aus dem Web-Dashboard: npm run billing -- --import <export.json>' }),
            h('p', { class: 'muted small', text: 'Kasi legt einen Entwurf aus dem gebuchten Paket an. Gestellt wird er erst mit „--issue“ nach Prüfung der Pflichtangaben.' }), msg);
        const first = body.querySelector('.pal-item'); if (first) first.focus();
        async function draft(c) {
            msg.textContent = 'Entwurf für ' + c.company + ' wird erstellt …';
            try {
                const r = await H().api('invoice/draft', { clientId: c.id });
                msg.textContent = (r.output || '').split('\n').slice(-3).join(' ');
                if (r.ok) { H().toast('Rechnungsentwurf erstellt'); H().reload(); }
            } catch (err) { msg.textContent = err.message; }
        }
        return { keep: true };
    }
    function field(label, el) {
        const id = 'pf-' + el.name;
        el.id = id;
        return h('div', { class: 'field' }, h('label', { for: id, text: label }), el);
    }

    /* ---------- Öffnen / Schließen ---------- */
    let lastFocus = null;
    function openPalette(mode) {
        if (dlg.open) { if (!mode) return close(); }
        lastFocus = document.activeElement;
        back();
        input.value = '';
        active = 0;
        render();
        if (!dlg.open) dlg.showModal();
        input.focus();
        if (mode === 'lead') leadForm();
        if (mode === 'invoice') invoicePick();
    }
    function close() { if (dlg.open) dlg.close(); }
    dlg.addEventListener('close', () => { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) close(); }); // Klick neben das Fenster
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(items.length - 1, active + 1); paintActive(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); exec(active); }
    });
    document.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); openPalette(); }
    });
    const btn = $('#palette-btn');
    if (btn) btn.addEventListener('click', () => openPalette());
    document.addEventListener('click', (ev) => {
        const t = ev.target.closest && ev.target.closest('[data-palette]');
        if (t) openPalette(t.dataset.palette);
    });

    window.HarveyPalette = { open: openPalette, close };
}());
