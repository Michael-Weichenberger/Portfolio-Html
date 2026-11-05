/* =============================================================================
   KASI DASHBOARD · Oberfläche
   Liste links, Eintrag rechts (auf dem Handy nacheinander). Alle Daten kommen
   aus /api (dashboard/worker.mjs). Texte werden nur als textContent gesetzt.

   Erweitern: neue Bereiche/Status kommen aus core/store.js (KINDS, STATUSES),
   neue Mail-Texte aus core/drafts.js (BLOCKS). Hier muss dafür nichts geändert werden.
   ============================================================================= */
(function () {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const app = $('#app');
    const SITE = 'https://mw-itservices.de';
    const STATUS_CLASS = { good: 'is-good', warn: 'is-warn', bad: 'is-bad', pending: 'is-pending' };

    // view: overview | all | due | kunden | kind
    const state = { config: null, view: 'overview', kind: '', status: '', q: '', items: [], lead: null, loadingList: false };

    /* ---------- Helfer ---------- */
    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        });
        children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c)); });
        return el;
    }
    function icon(id) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ic');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#' + id);
        svg.append(use);
        return svg;
    }
    const euro = (n) => new Intl.NumberFormat('de-DE').format(n) + ' €';
    const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const shortDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
    function when(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const diff = (Date.now() - d.getTime()) / 60000;
        if (diff < 1) return 'gerade eben';
        if (diff < 60) return 'vor ' + Math.round(diff) + ' Min.';
        if (diff < 60 * 24 && new Date().getDate() === d.getDate()) return 'heute ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return shortDate.format(d);
    }
    const kindLabel = (id) => ((state.config && state.config.kinds.find((k) => k.id === id)) || { label: id }).label;
    const statusLabel = (id) => ((state.config && state.config.statuses.find((s) => s.id === id)) || { label: id }).label;

    let toastTimer = null;
    function toast(msg, isError) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.toggle('is-error', !!isError);
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 2600);
    }

    async function api(path, opts = {}) {
        const res = await fetch('/api/' + path, {
            method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Harvey': '1' },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) { window.location.reload(); throw new Error('Nicht angemeldet'); }
        if (!res.ok) throw new Error(data.message || 'Fehler ' + res.status);
        return data;
    }

    async function copyText(text, done) {
        try {
            await navigator.clipboard.writeText(text);
            toast(done);
        } catch (err) {
            toast('Kopieren nicht möglich. Bitte Text markieren und kopieren.', true);
        }
    }

    /* ---------- Navigation ---------- */
    function count(kind, status) {
        return (state.config ? state.config.counts.byKindStatus : [])
            .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
            .reduce((a, c) => a + c.n, 0);
    }

    function navButton(label, iconId, active, n, onClick, extraClass) {
        return h('button', { type: 'button', class: 'nav-item' + (active ? ' is-active' : '') + (extraClass ? ' ' + extraClass : ''), 'aria-current': active ? 'true' : null, onclick: onClick },
            iconId ? icon(iconId) : null, h('span', { class: 'nav-label', text: label }), n ? h('span', { class: 'nav-count', text: String(n) }) : null);
    }

    const KIND_ICON = { anfrage: 'i-gauge', paket: 'i-mail', akquise: 'i-send' };

    const VIEW_TITLE = { all: 'Alle Einträge', due: 'Heute fällig', kunden: 'Kunden' };

    function renderNav() {
        const v = state.view;
        const kinds = $('#nav-kinds');
        kinds.replaceChildren(
            navButton('Übersicht', 'i-home', v === 'overview', 0, () => setFilter({ view: 'overview', kind: '', status: '' })),
            navButton('Heute fällig', 'i-clock', v === 'due', state.config.counts.due, () => setFilter({ view: 'due', kind: '', status: '' }), state.config.counts.due ? 'has-due' : ''),
            navButton('Alle Einträge', 'i-inbox', v === 'all', count('', 'neu'), () => setFilter({ view: 'all', kind: '' })),
            ...state.config.kinds.map((k) => navButton(k.label, KIND_ICON[k.id] || 'i-inbox', v === 'kind' && state.kind === k.id, count(k.id, 'neu'), () => setFilter({ view: 'kind', kind: k.id }))),
            navButton('Kunden', 'i-users', v === 'kunden', count('', 'auftrag'), () => setFilter({ view: 'kunden', kind: '', status: '' }), 'nav-plain')
        );
        const statuses = $('#nav-status');
        const showStatus = v === 'all' || v === 'kind';
        $('.nav-group').hidden = !showStatus;
        statuses.replaceChildren(
            navButton('Alle', null, !state.status, 0, () => setFilter({ status: '' }), 'nav-sub'),
            ...state.config.statuses.map((st) => navButton(st.label, null, state.status === st.id, count(state.kind, st.id), () => setFilter({ status: st.id }), 'nav-sub st-' + st.id))
        );
        const kind = state.config.kinds.find((k) => k.id === state.kind);
        $('#list-title').textContent = v === 'kind' && kind ? kind.label : VIEW_TITLE[v] || 'Alle Einträge';
        $('#prospect-form').hidden = !(v === 'all' || (v === 'kind' && state.kind === 'akquise'));
        app.dataset.mode = v === 'overview' ? 'overview' : 'list';
    }

    function setFilter(patch) {
        if (patch.view && patch.view !== 'all' && patch.view !== 'kind' && !('status' in patch)) patch.status = '';
        Object.assign(state, patch);
        renderNav();
        if (state.view === 'overview') {
            if (window.location.hash !== '#/') history.replaceState(null, '', '#/');
            state.lead = null;
            loadOverview();
            return;
        }
        loadList();
        if (state.lead) { state.lead = null; history.replaceState(null, '', '#/liste'); }
        renderEmpty();
    }

    /* ---------- Liste ---------- */
    function dots(points) {
        return h('span', { class: 'dots', 'aria-hidden': 'true' }, (points || []).map((p) => h('i', { class: STATUS_CLASS[p.status] || 'is-pending' })));
    }

    const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const todayIso = () => new Date().toISOString().slice(0, 10);
    function followText(d) {
        if (!d) return '';
        const t = todayIso();
        if (d < t) return 'überfällig seit ' + dayFmt.format(new Date(d + 'T12:00:00'));
        if (d === t) return 'heute fällig';
        return 'Wiedervorlage ' + dayFmt.format(new Date(d + 'T12:00:00'));
    }
    function moneyLine(v) {
        if (!v || (v.once === null && v.month === null)) return '';
        return [v.once ? (v.estimated ? '≈ ' : '') + euro(v.once) : '', v.month ? euro(v.month) + '/Mtl.' : ''].filter(Boolean).join(' + ');
    }

    function itemSubline(it) {
        if (it.status === 'auftrag') return [moneyLine(it.value), it.progress ? 'Projekt ' + it.progress.done + '/' + it.progress.total : ''].filter(Boolean).join(' · ');
        if (it.kind === 'paket') return it.topic || it.email || '';
        return it.total ? it.met + ' von ' + it.total + ' Signalen' : 'noch nicht gemessen';
    }

    function renderList() {
        const ul = $('#items');
        if (state.loadingList && !state.items.length) {
            ul.replaceChildren(...[0, 1, 2, 3].map(() => h('li', { class: 'item is-skeleton' }, h('span'), h('span'))));
            return;
        }
        if (!state.items.length) {
            const hint = state.q ? 'Keine Treffer für „' + state.q + '“.'
                : state.view === 'due' ? 'Nichts fällig. Setzen Sie im Eintrag eine Wiedervorlage, dann erscheint er hier am gewählten Tag.'
                : state.view === 'kunden' ? 'Noch keine Kunden. Setzen Sie einen Eintrag auf „Kunde“, dann erscheint er hier mit Auftragswert und Projekt-Checkliste.'
                : state.kind === 'akquise' ? 'Noch keine Akquise-Kontakte. Tragen Sie oben eine Domain ein, Kasi misst sie und schreibt einen Brief.'
                : state.kind === 'paket' ? 'Noch keine Paket-Anfragen. Sie erscheinen hier, sobald jemand das Anfrageformular oder den Projekt-Planer absendet.'
                : 'Noch keine Einträge. Anfragen aus dem Website-Test und dem Anfrageformular erscheinen hier automatisch.';
            ul.replaceChildren(h('li', { class: 'list-empty', text: hint }));
            return;
        }
        ul.replaceChildren(...state.items.map((it) => {
            const active = state.lead && state.lead.id === it.id;
            return h('li', {},
                h('a', { class: 'item' + (active ? ' is-active' : '') + (it.status === 'neu' ? ' is-new' : ''), href: '#/lead/' + it.id, 'aria-current': active ? 'true' : null },
                    h('span', { class: 'item-top' },
                        h('strong', { class: 'item-name', text: it.name }),
                        h('time', { class: 'item-time', datetime: it.createdAt, text: when(it.createdAt) })),
                    h('span', { class: 'item-sub' },
                        h('span', { class: 'item-kind k-' + it.kind, text: kindLabel(it.kind) }),
                        h('span', { class: 'item-info', text: itemSubline(it) })),
                    it.followUp ? h('span', { class: 'item-follow' + (it.followUp <= todayIso() ? ' is-due' : ''), text: followText(it.followUp) }) : null,
                    h('span', { class: 'item-bottom' },
                        it.kind === 'paket' ? h('span', { class: 'item-money', text: it.status === 'auftrag' ? '' : moneyLine(it.value) }) : dots(it.points),
                        h('span', { class: 'chip st-' + it.status, text: statusLabel(it.status) }))));
        }));
    }

    let listReq = 0;
    async function loadList() {
        const my = ++listReq;
        state.loadingList = true;
        renderList();
        const qs = new URLSearchParams();
        if (state.kind) qs.set('kind', state.kind);
        if (state.status) qs.set('status', state.status);
        if (state.q) qs.set('q', state.q);
        if (state.view === 'due' || state.view === 'kunden') qs.set('view', state.view);
        try {
            const items = await api('leads?' + qs);
            if (my !== listReq) return;
            state.items = items;
        } catch (err) {
            toast(err.message, true);
        } finally {
            if (my === listReq) {
                state.loadingList = false;
                renderList();
            }
        }
    }

    async function refreshCounts() {
        try {
            state.config = await api('config');
            renderNav();
        } catch (err) { /* Zähler sind nicht kritisch */ }
    }

    /* ---------- Übersicht ---------- */
    function ovItem(it, extra) {
        return h('li', {}, h('a', { class: 'ov-item', href: '#/lead/' + it.id },
            h('span', { class: 'ov-name', text: it.name }),
            h('span', { class: 'ov-sub' },
                h('span', { class: 'item-kind k-' + it.kind, text: kindLabel(it.kind) }),
                h('span', { text: extra || statusLabel(it.status) }))));
    }
    function ovEmpty(text) { return h('li', { class: 'ov-empty', text }); }

    let ovReq = 0;
    async function loadOverview() {
        const my = ++ovReq;
        app.dataset.mode = 'overview';
        app.dataset.view = 'detail';
        if (!$('.overview', detail)) detail.replaceChildren(h('div', { class: 'detail-loading' }, h('span'), h('span'), h('span')));
        let o;
        try {
            o = await api('overview');
        } catch (err) {
            toast(err.message, true);
            return;
        }
        if (my !== ovReq || state.view !== 'overview') return;
        const root = $('#tpl-overview').content.firstElementChild.cloneNode(true);
        const k = (name) => $('[data-k="' + name + '"]', root);
        const f = (name) => $('[data-f="' + name + '"]', root);
        f('date').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
        k('fresh').textContent = o.kpis.fresh;
        k('due').textContent = o.kpis.due;
        k('open').textContent = o.kpis.open;
        k('pipeline').textContent = o.kpis.pipelineOnce || o.kpis.pipelineMonth ? '≈ ' + euro(o.kpis.pipelineOnce) + (o.kpis.pipelineMonth ? ' + ' + euro(o.kpis.pipelineMonth) + '/Mtl.' : '') : 'noch ohne Wert';
        k('customers').textContent = o.kpis.customers;
        k('mrr').textContent = euro(o.kpis.mrr) + ' / Monat Betreuung';
        k('wonMonthOnce').textContent = euro(o.kpis.wonMonthOnce);
        k('wonMonth').textContent = o.kpis.wonMonth === 1 ? '1 Auftrag' : o.kpis.wonMonth + ' Aufträge';
        if (o.kpis.due) root.querySelector('[data-go="due"]').classList.add('is-alert');

        f('due-count').textContent = o.due.length ? o.due.length + ' offen' : '';
        f('due').replaceChildren(...(o.due.length ? o.due.map((x) => ovItem(x, followText(x.followUp))) : [ovEmpty('Nichts fällig.')]));
        f('fresh').replaceChildren(...(o.fresh.length ? o.fresh.map((x) => ovItem(x, when(x.createdAt))) : [ovEmpty('Keine unbearbeiteten Anfragen.')]));
        f('upcoming').replaceChildren(...(o.upcoming.length ? o.upcoming.map((x) => ovItem(x, followText(x.followUp))) : [ovEmpty('Keine Wiedervorlagen geplant.')]));
        f('projects').replaceChildren(...(o.projects.length ? o.projects.map((x) => ovItem(x, 'Projekt ' + x.progress.done + ' von ' + x.progress.total)) : [ovEmpty('Keine offenen Projekte.')]));
        const max = Math.max(1, ...o.funnel.map((x) => x.n));
        f('funnel').replaceChildren(...o.funnel.map((x) => h('li', { class: 'st-' + x.id },
            h('button', { type: 'button', class: 'funnel-row', onclick: () => setFilter(x.id === 'auftrag' ? { view: 'kunden' } : { view: 'all', kind: '', status: x.id }) },
                h('span', { class: 'funnel-label', text: x.label }),
                h('span', { class: 'funnel-bar' }, h('i', { 'data-w': String(Math.round((x.n / max) * 100)) })),
                h('strong', { text: String(x.n) })))));
        $$('.funnel-bar i', root).forEach((i) => { i.style.width = i.dataset.w + '%'; });
        f('recent').replaceChildren(...(o.recent.length ? o.recent.map((a) => h('li', { class: 't-' + a.type },
            h('time', { datetime: a.at, text: when(a.at) }),
            h('span', {}, h('a', { href: '#/lead/' + a.id, text: a.name }), ' · ' + a.text))) : [ovEmpty('Noch nichts passiert.')]));
        root.addEventListener('click', (e) => {
            const go = e.target.closest('[data-go]');
            if (!go) return;
            const t = go.dataset.go;
            if (t === 'due') setFilter({ view: 'due' });
            else if (t === 'kunden') setFilter({ view: 'kunden' });
            else if (t === 'pipeline') setFilter({ view: 'all', kind: '', status: 'gesendet' });
            else if (t.startsWith('status:')) setFilter({ view: 'all', kind: '', status: t.slice(7) });
        });
        detail.replaceChildren(root);
    }

    /* ---------- Detail ---------- */
    const detail = $('#detail');
    let saveTimer = null;
    let pending = {};

    function showList() { app.dataset.view = 'list'; }
    function showDetail() { app.dataset.view = 'detail'; }

    function setSaved(text) {
        const el = $('[data-f="saved"]', detail);
        if (el) el.textContent = text;
    }

    function queueSave(patch) {
        Object.assign(pending, patch);
        setSaved('Änderungen …');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 700);
    }

    async function flushSave() {
        clearTimeout(saveTimer);
        if (!state.lead || !Object.keys(pending).length) return;
        const patch = pending;
        const id = state.lead.id;
        pending = {};
        try {
            const lead = await api('leads/' + id, { method: 'PATCH', body: patch });
            if (state.lead && state.lead.id === id) Object.assign(state.lead, patch, { updatedAt: lead.updatedAt });
            setSaved('Gespeichert');
            syncListItem(lead);
        } catch (err) {
            Object.assign(pending, patch);
            setSaved('Nicht gespeichert');
            toast('Speichern fehlgeschlagen: ' + err.message, true);
        }
    }

    function syncListItem(lead) {
        const i = state.items.findIndex((x) => x.id === lead.id);
        if (i >= 0) {
            state.items[i] = { ...state.items[i], status: lead.status, email: lead.email, met: lead.met, total: lead.total, points: lead.points, sentAt: lead.sentAt };
            renderList();
        }
    }

    function mailLinks(lead) {
        const to = lead.email || '';
        const gmail = 'https://mail.google.com/mail/?view=cm&fs=1'
            + '&to=' + encodeURIComponent(to) + '&su=' + encodeURIComponent(lead.subject || '') + '&body=' + encodeURIComponent(lead.body || '');
        const mailto = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(lead.subject || '') + '&body=' + encodeURIComponent(lead.body || '');
        return { gmail, mailto };
    }

    function updateMailButtons(root, lead) {
        const links = mailLinks(lead);
        const noMail = !lead.email;
        const g = $('[data-act="gmail"]', root);
        const m = $('[data-act="mailto"]', root);
        [g, m].forEach((a) => {
            a.classList.toggle('is-disabled', noMail);
            if (noMail) { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); } else a.removeAttribute('aria-disabled');
        });
        if (!noMail) { g.href = links.gmail; m.href = links.mailto; }
        g.title = noMail ? 'Erst eine E-Mail-Adresse eintragen' : '';
    }

    function renderPoints(root, lead) {
        const ul = $('[data-f="points"]', root);
        const report = lead.report;
        $('[data-f="met"]', root).textContent = report && report.total ? String(report.met) : '–';
        $('[data-f="total"]', root).textContent = report && report.total ? 'von ' + report.total + ' Signalen' : 'nicht gemessen';
        if (!report) {
            ul.replaceChildren(h('li', { class: 'point-empty', text: 'Für diese Adresse liegt noch keine Messung vor. „Neu messen“ holt sie nach (dauert bis zu einer Minute).' }));
            return;
        }
        ul.replaceChildren(...report.points.map((p) => h('li', { class: 'point ' + (STATUS_CLASS[p.status] || '') },
            h('span', { class: 'point-state' }, h('i', { 'aria-hidden': 'true' }), state.config.statusText[p.status] || p.status),
            h('strong', { text: p.title }),
            h('span', { class: 'point-value', text: p.value }))));
    }

    function renderFindings(root, lead) {
        const ol = $('[data-f="findings"]', root);
        $('[data-f="measured"]', root).textContent = lead.measuredAt ? 'gemessen ' + dateFmt.format(new Date(lead.measuredAt)) : '';
        if (!lead.findings.length) {
            ol.replaceChildren(h('li', { class: 'finding-empty', text: lead.report ? 'Keine fehlenden Signale.' : 'Noch keine Messung.' }));
            return;
        }
        ol.replaceChildren(...lead.findings.map((f) => h('li', { class: 'finding sev-' + f.severity },
            h('span', { class: 'sev', title: ['', 'Gering', 'Mittel', 'Hoch'][f.severity] + 'e Wirkung' }, h('span', { class: 'visually-hidden', text: 'Wirkung ' + f.severity + ' von 3' })),
            h('div', {},
                h('strong', { text: f.title }),
                h('p', { text: f.evidence }),
                h('p', { class: 'fix' }, h('span', { text: 'Lösung: ' }), f.fix)))));
    }

    /* Angebots-Auswahl (nur Paket-Anfragen); Preise kommen aus offer-rules.js über /api/config */
    function readSelection(root) {
        const base = ($('input[name="o-base"]:checked', root) || {}).value;
        if (!base) return null;
        return {
            base,
            extras: $$('input[name="o-extra"]:checked', root).map((i) => i.value),
            care: ($('input[name="o-care"]:checked', root) || {}).value || 'none'
        };
    }

    function option(type, name, value, label, price, checked) {
        return h('label', { class: 'opt' },
            h('input', { type, name, value, checked: checked ? true : null }),
            h('span', { class: 'opt-label', text: label }),
            h('span', { class: 'opt-price', text: price }));
    }

    let quoteReq = 0;
    async function updateQuote(root) {
        const sel = readSelection(root);
        const once = $('[data-f="sum-once"]', root);
        const month = $('[data-f="sum-month"]', root);
        const note = $('[data-f="sum-note"]', root);
        if (!sel) { once.textContent = '–'; month.textContent = '–'; note.textContent = 'Keine Auswahl: Kasi antwortet ohne Preise.'; return; }
        const my = ++quoteReq;
        try {
            const q = await api('quote', { method: 'POST', body: { selection: sel } });
            if (my !== quoteReq) return;
            const prefix = q.from ? 'ab ' : '';
            once.textContent = prefix + euro(q.once) + ' netto';
            month.textContent = q.month ? euro(q.month) + ' netto' : '–';
            note.textContent = (q.promo ? 'Black-Friday-Preis aktiv. ' : '') + 'Brutto: ' + prefix + euro(q.onceGross) + (q.month ? ' + ' + euro(q.monthGross) + ' / Mtl.' : '');
        } catch (err) {
            note.textContent = 'Summe nicht berechnet: ' + err.message;
        }
    }

    function renderOffer(root, lead) {
        const P = state.config.prices;
        const sel = lead.selection;
        $('[data-f="offer-hint"]', root).textContent = sel ? 'Auswahl aus dem Projekt-Planer' : 'Kein Paket gewählt';
        $('[data-f="opt-base"]', root).replaceChildren(...Object.entries(P.base).map(([k, v]) =>
            option('radio', 'o-base', k, v.label, v.once ? (v.from ? 'ab ' : '') + euro(v.once) : '–', sel && sel.base === k)));
        $('[data-f="opt-extra"]', root).replaceChildren(...Object.entries(P.extra).map(([k, v]) =>
            option('checkbox', 'o-extra', k, v.label, euro(v.once), sel && sel.extras.includes(k))));
        $('[data-f="opt-care"]', root).replaceChildren(...Object.entries(P.care).map(([k, v]) =>
            option('radio', 'o-care', k, v.label, v.month ? euro(v.month) + ' / Mtl.' : '–', sel ? sel.care === k : k === 'none')));
        $('[data-f="offer-block"]', root).addEventListener('change', () => updateQuote(root));
        updateQuote(root);
    }

    function fillDetail(lead) {
        const root = $('#tpl-detail').content.firstElementChild.cloneNode(true);
        const f = (name) => $('[data-f="' + name + '"]', root);
        const isPaket = lead.kind === 'paket';
        const isAkquise = lead.kind === 'akquise';

        f('kind').textContent = kindLabel(lead.kind);
        f('kind').className = 'lead-kind k-' + lead.kind;
        f('name').textContent = lead.name;
        if (lead.url) { f('url').href = lead.url; f('url').textContent = lead.url.replace(/^https?:\/\//, '').replace(/\/$/, ''); } else f('url').remove();
        f('email').textContent = lead.email || '';
        f('created').textContent = dateFmt.format(new Date(lead.createdAt));

        const select = f('status');
        state.config.statuses.forEach((s) => select.append(h('option', { value: s.id, text: s.label, selected: s.id === lead.status ? true : null })));
        select.className = 'st-' + lead.status;
        select.addEventListener('change', () => {
            select.className = 'st-' + select.value;
            lead.status = select.value;
            queueSave({ status: select.value });
            flushSave().then(async () => {
                refreshCounts();
                const fresh = await api('leads/' + lead.id);
                openLead(fresh, true);
            });
        });

        // Bereiche je nach Art
        f('request-block').hidden = !isPaket;
        f('offer-block').hidden = !isPaket;
        f('points-block').hidden = isPaket;
        f('findings-block').hidden = isPaket;
        f('teaser-block').hidden = !isAkquise;
        $('[data-act="measure"]', root).hidden = isPaket;
        f('draft-title').textContent = isPaket ? 'Angebots-Mail' : isAkquise ? 'Brief' : 'Report-Mail';

        if (isPaket) {
            f('topic').textContent = lead.topic || '–';
            if (lead.phone) { f('phone').textContent = lead.phone; f('phone').href = 'tel:' + lead.phone.replace(/[^\d+]/g, ''); } else f('phone').textContent = '–';
            if (lead.message) f('message').textContent = lead.message; else f('message-row').hidden = true;
            renderOffer(root, lead);
        } else {
            renderPoints(root, lead);
            renderFindings(root, lead);
        }

        if (isAkquise) {
            const c = f('compliance');
            c.hidden = false;
            c.textContent = 'Ohne Einwilligung keine Werbe-Mail (§ 7 UWG). Diesen Text per Post, persönlich oder an bestehende Kontakte schicken.';
            const link = SITE + '/?check=' + lead.id + '#sichtbarkeit';
            f('teaser').textContent = link;
            f('published').checked = lead.published;
            f('published').addEventListener('change', (e) => {
                queueSave({ published: e.target.checked });
                flushSave();
                toast(e.target.checked ? 'Teaser-Link ist jetzt öffentlich.' : 'Teaser-Link ist wieder privat.');
            });
            $('[data-act="copy-link"]', root).addEventListener('click', () => copyText(link, 'Link kopiert'));
        }

        // Entwurf
        const to = f('to');
        const subject = f('subject');
        const body = f('body');
        to.value = lead.email || '';
        subject.value = lead.subject || '';
        body.value = lead.body || '';
        to.addEventListener('input', () => { lead.email = to.value.trim(); updateMailButtons(root, lead); queueSave({ email: lead.email }); });
        subject.addEventListener('input', () => { lead.subject = subject.value; updateMailButtons(root, lead); queueSave({ subject: subject.value }); });
        body.addEventListener('input', () => { lead.body = body.value; updateMailButtons(root, lead); queueSave({ body: body.value }); });
        f('notes').value = lead.notes || '';
        f('notes').addEventListener('input', (e) => queueSave({ notes: e.target.value }));
        updateMailButtons(root, lead);
        if (lead.sentAt) setSentState(root, lead.sentAt);

        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if ((act === 'gmail' || act === 'mailto') && btn.classList.contains('is-disabled')) { e.preventDefault(); to.focus(); toast('Bitte zuerst eine E-Mail-Adresse eintragen.', true); return; }
            if (act === 'gmail' || act === 'mailto') { flushSave(); return; }
            e.preventDefault();
            actions[act] && actions[act](btn, root, lead);
        });
        renderNext(root, lead);
        renderDeal(root, lead);
        renderTimeline(root, lead);
        return root;
    }

    /* Wiedervorlage */
    function addDays(n) {
        const d = new Date();
        d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function renderNext(root, lead) {
        const input = $('[data-f="follow"]', root);
        const hint = $('[data-f="next-hint"]', root);
        const done = $('[data-f="follow-done"]', root);
        const paint = () => {
            input.value = lead.followUp || '';
            hint.textContent = lead.followUp ? followText(lead.followUp) : 'keine geplant';
            hint.classList.toggle('is-due', !!lead.followUp && lead.followUp <= todayIso());
            done.hidden = !lead.followUp;
        };
        const set = async (v) => {
            lead.followUp = v;
            paint();
            queueSave({ followUp: v });
            await flushSave();
            refreshCounts();
            reloadTimeline(root, lead.id);
        };
        input.addEventListener('change', () => set(input.value || null));
        $$('[data-follow]', root).forEach((b) => b.addEventListener('click', () => {
            const n = Number(b.dataset.follow);
            set(n ? addDays(n) : null);
            toast(n ? followText(addDays(n)) : 'Wiedervorlage erledigt');
        }));
        paint();
    }

    /* Auftrag: Wert, Start, Projekt-Checkliste */
    function renderDeal(root, lead) {
        const block = $('[data-f="deal-block"]', root);
        const isCustomer = lead.status === 'auftrag';
        const show = isCustomer || ['gesendet', 'termin'].includes(lead.status) || lead.valueOnce !== null || lead.valueMonth !== null;
        block.hidden = !show;
        if (!show) return;
        $('[data-f="deal-title"]', root).textContent = isCustomer ? 'Kunde & Projekt' : 'Erwarteter Auftrag';
        $('[data-f="deal-hint"]', root).textContent = lead.wonAt ? 'Kunde seit ' + new Date(lead.wonAt).toLocaleDateString('de-DE') : lead.value.estimated ? 'Wert aus dem Angebot berechnet' : '';
        const once = $('[data-f="value-once"]', root);
        const month = $('[data-f="value-month"]', root);
        const start = $('[data-f="start"]', root);
        once.value = lead.valueOnce !== null ? lead.valueOnce : '';
        month.value = lead.valueMonth !== null ? lead.valueMonth : '';
        once.placeholder = lead.value.once !== null ? String(lead.value.once) : '0';
        month.placeholder = lead.value.month !== null ? String(lead.value.month) : '0';
        start.value = lead.startAt || '';
        $('[data-f="start-wrap"]', root).hidden = !isCustomer;
        once.addEventListener('input', () => queueSave({ valueOnce: once.value === '' ? null : Number(once.value) }));
        month.addEventListener('input', () => queueSave({ valueMonth: month.value === '' ? null : Number(month.value) }));
        start.addEventListener('change', () => { queueSave({ startAt: start.value || null }); flushSave(); });

        const wrap = $('[data-f="steps-wrap"]', root);
        wrap.hidden = !isCustomer;
        if (!isCustomer) return;
        const done = new Set(lead.checklist || []);
        const ul = $('[data-f="steps"]', root);
        const paint = () => {
            const n = state.config.steps.filter((x) => done.has(x.id)).length;
            $('[data-f="steps-count"]', root).textContent = n + ' von ' + state.config.steps.length + ' erledigt';
            $('[data-f="steps-bar"]', root).style.width = Math.round((n / state.config.steps.length) * 100) + '%';
        };
        ul.replaceChildren(...state.config.steps.map((st) => h('li', {}, h('label', { class: 'check' },
            h('input', { type: 'checkbox', value: st.id, checked: done.has(st.id) ? true : null,
                onchange: async (e) => {
                    if (e.target.checked) done.add(st.id); else done.delete(st.id);
                    paint();
                    lead.checklist = [...done];
                    queueSave({ checklist: lead.checklist });
                    await flushSave();
                    reloadTimeline(root, lead.id);
                } }),
            h('span', { text: st.label })))));
        paint();
    }

    /* Verlauf */
    const TYPE_LABEL = { booking: 'Termin', created: 'Eingang', status: 'Status', sent: 'Gesendet', followup: 'Wiedervorlage', step: 'Projekt', offer: 'Angebot', measure: 'Messung', draft: 'Vorschlag' };
    function renderTimeline(root, lead) {
        const ol = $('[data-f="timeline"]', root);
        const acts = lead.activities || [];
        ol.replaceChildren(...(acts.length ? acts.map((a) => h('li', { class: 't-' + a.type },
            h('time', { datetime: a.at, text: dateFmt.format(new Date(a.at)) }),
            h('span', {}, h('strong', { text: (TYPE_LABEL[a.type] || a.type) + ': ' }), a.text))) : [h('li', { class: 'ov-empty', text: 'Noch keine Einträge.' })]));
    }
    async function reloadTimeline(root, id) {
        try {
            const fresh = await api('leads/' + id);
            if (state.lead && state.lead.id === id) {
                state.lead.activities = fresh.activities;
                renderTimeline(root, fresh);
            }
        } catch (err) { /* Verlauf ist nicht kritisch */ }
    }

    function setSentState(root, iso) {
        const btn = $('[data-act="sent"]', root);
        btn.classList.add('is-sent');
        $('span', btn).textContent = 'Gesendet am ' + dateFmt.format(new Date(iso));
    }

    async function busy(btn, label, fn) {
        const span = $('span', btn);
        const before = span.textContent;
        btn.disabled = true;
        btn.classList.add('is-busy');
        span.textContent = label;
        try {
            return await fn();
        } finally {
            btn.disabled = false;
            btn.classList.remove('is-busy');
            span.textContent = before;
        }
    }

    const actions = {
        back() { state.lead = null; renderList(); history.replaceState(null, '', '#/liste'); if (state.view === 'overview') loadOverview(); else showList(); },
        copy(btn, root, lead) { copyText((lead.subject ? 'Betreff: ' + lead.subject + '\n\n' : '') + lead.body, 'Text kopiert'); },
        print(btn, root, lead) { printLetter(lead); },
        async redraft(btn, root, lead) {
            if (!window.confirm('Den aktuellen Text durch einen neuen Vorschlag aus den Bausteinen ersetzen?')) return;
            await flushSave();
            await busy(btn, 'Wird erstellt …', async () => {
                const updated = await api('leads/' + lead.id + '/draft', { method: 'POST' });
                openLead(updated, true);
                toast('Neuer Vorschlag erstellt');
            }).catch((err) => toast(err.message, true));
        },
        async offer(btn, root, lead) {
            const sel = readSelection(root);
            if (!sel) { toast('Bitte eine Website-Option wählen oder „Ohne Paket antworten“.', true); return; }
            await flushSave();
            await busy(btn, 'Wird erstellt …', async () => {
                const updated = await api('leads/' + lead.id + '/offer', { method: 'POST', body: { selection: sel } });
                openLead(updated, true);
                toast('Angebot neu erstellt');
                const b = $('[data-f="body"]', detail);
                if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }).catch((err) => toast(err.message, true));
        },
        async ['offer-none'](btn, root, lead) {
            await flushSave();
            await busy(btn, 'Wird erstellt …', async () => {
                const updated = await api('leads/' + lead.id + '/offer', { method: 'POST', body: { selection: null } });
                openLead(updated, true);
                toast('Antwort ohne Paket erstellt');
            }).catch((err) => toast(err.message, true));
        },
        async sent(btn, root, lead) {
            const iso = new Date().toISOString();
            queueSave({ sentAt: iso, status: lead.status === 'neu' || lead.status === 'in_arbeit' ? 'gesendet' : lead.status });
            await flushSave();
            const updated = await api('leads/' + lead.id);
            openLead(updated, true);
            refreshCounts();
            toast('Als gesendet markiert');
        },
        async measure(btn, root, lead) {
            await flushSave();
            const redraft = !lead.body || window.confirm('Nach der Messung auch den Text neu vorschlagen? (Abbrechen: Text bleibt, nur Messung wird aktualisiert)');
            await busy(btn, 'Messung läuft (bis 1 Min.) …', async () => {
                const updated = await api('leads/' + lead.id + '/measure', { method: 'POST', body: { redraft } });
                openLead(updated, true);
                syncListItem(updated);
                toast('Messung aktualisiert');
            }).catch((err) => toast(err.message, true));
        },
        async delete(btn, root, lead) {
            if (!window.confirm('„' + lead.name + '“ endgültig löschen? Das lässt sich nicht rückgängig machen.')) return;
            try {
                await api('leads/' + lead.id, { method: 'DELETE' });
                state.lead = null;
                state.items = state.items.filter((x) => x.id !== lead.id);
                renderList();
                renderEmpty();
                refreshCounts();
                history.replaceState(null, '', '#/');
                toast('Gelöscht');
            } catch (err) { toast(err.message, true); }
        }
    };

    /* Drucken: nur Betreff und Text (siehe @media print in app.css) */
    function printLetter(lead) {
        const area = $('#print-area');
        area.replaceChildren(h('h1', { text: lead.subject || '' }), h('div', { class: 'letter', text: lead.body || '' }));
        window.print();
    }

    function renderEmpty() {
        detail.replaceChildren($('#detail-empty') || h('div', { class: 'empty' }));
        const empty = $('#tpl-empty');
        if (empty) detail.replaceChildren(empty.content.cloneNode(true));
        showList();
    }

    function openLead(lead, keepView) {
        state.lead = lead;
        pending = {};
        detail.replaceChildren(fillDetail(lead));
        renderList();
        if (!keepView) {
            showDetail();
            detail.scrollTop = 0;
            detail.focus({ preventScroll: true });
        }
    }

    async function loadLead(id) {
        await flushSave();
        detail.replaceChildren(h('div', { class: 'detail-loading' }, h('span'), h('span'), h('span')));
        showDetail();
        try {
            openLead(await api('leads/' + encodeURIComponent(id)));
        } catch (err) {
            detail.replaceChildren(h('div', { class: 'empty' }, h('h2', { text: 'Eintrag nicht gefunden' }), h('p', { text: err.message })));
        }
    }

    /* ---------- Akquise: neue Domain prüfen ---------- */
    $('#prospect-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#prospect-url');
        const btn = $('#prospect-btn');
        const msg = $('#prospect-msg');
        const url = input.value.trim();
        if (url.length < 4) { input.focus(); input.setAttribute('aria-invalid', 'true'); msg.hidden = false; msg.textContent = 'Bitte eine Domain eintragen, z. B. huber-maler.de.'; return; }
        input.removeAttribute('aria-invalid');
        msg.hidden = false;
        msg.classList.remove('is-error');
        msg.textContent = 'Kasi misst ' + url + ' … das dauert bis zu einer Minute.';
        await busy(btn, 'Misst …', async () => {
            const lead = await api('prospects', { method: 'POST', body: { url } });
            input.value = '';
            msg.hidden = true;
            if (state.view === 'kind' && state.kind !== 'akquise') state.kind = 'akquise';
            await refreshCounts();
            await loadList();
            window.location.hash = '#/lead/' + lead.id;
        }).catch((err) => {
            msg.classList.add('is-error');
            msg.textContent = err.message;
        });
    });

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadList(); }, 250);
    });

    /* ---------- Routing ---------- */
    function route() {
        const m = window.location.hash.match(/^#\/lead\/([a-z0-9-]{3,90})$/);
        if (m) {
            if (state.view === 'overview') { state.view = 'all'; renderNav(); loadList(); }
            app.dataset.mode = 'list';
            loadLead(m[1]);
            return;
        }
        if (state.lead) { state.lead = null; renderList(); }
        if (state.view === 'overview') loadOverview();
        else renderEmpty();
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => {
        if (Object.keys(pending).length) { flushSave(); e.preventDefault(); }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { flushSave(); return; }
        refreshCounts();
        if (state.view === 'overview' && !state.lead) loadOverview(); else loadList();
    });

    /* ---------- Start ---------- */
    const emptyTpl = document.createElement('template');
    emptyTpl.id = 'tpl-empty';
    emptyTpl.content.append($('#detail-empty').cloneNode(true));
    document.body.append(emptyTpl);

    (async function start() {
        try {
            state.config = await api('config');
        } catch (err) {
            toast('Kasi nicht erreichbar: ' + err.message, true);
            return;
        }
        if (window.location.hash.startsWith('#/lead/')) state.view = 'all';
        renderNav();
        if (state.view !== 'overview') await loadList();
        route();
    }());
}());
