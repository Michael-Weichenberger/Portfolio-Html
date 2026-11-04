/* ==========================================================================
   MW IT-SERVICES · script.js
   Module: Navigation · Reveal · Planer · Anfrage-Dialog · Sichtbarkeit · Rechner · Pipeline · Tilt
   Keine Tracker, keine Cookies, kein Browser-Speicher. Einzige Verbindung nach
   außen: der Formularversand an EmailJS, und nur beim Absenden.
   ========================================================================== */
(function () {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const euro = (n) => new Intl.NumberFormat('de-DE').format(n) + ' €';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    /* ======================================================================
       PREISE (netto, zzgl. 19 % MwSt.) · eine Quelle für Planer und Anfrage
       ====================================================================== */
    const PRICES = {
        base: {
            starter:   { label: 'Digital Starter', once: 599 },
            multipage: { label: 'Multipage & Enterprise', once: 1490, from: true },
            none:      { label: 'Keine neue Website', once: 0 }
        },
        extra: {
            geo:    { label: 'GEO & KI-Sichtbarkeit', once: 490 },
            office: { label: 'Büro-Digitalisierung', once: 800 },
            career: { label: 'Karriereseite & Bewerberformular', once: 390, includedIn: 'multipage' },
            gbp:    { label: 'Google-Unternehmensprofil', once: 190 }
        },
        care: {
            none: { label: 'Keine Betreuung', month: 0 },
            tech: { label: 'Technik-Wartung', month: 99 },
            care: { label: 'Pflege & Local SEO', month: 250 },
            plus: { label: 'Local SEO Plus', month: 399 }
        }
    };

    // Black-Friday-Aktion: gilt für Digital Starter + Pflege & Local SEO
    const PROMO = {
        until: new Date('2026-11-30T23:59:59+01:00'),
        base: 'starter',
        care: 'care',
        once: 479,
        month: 199,
        months: 6,
        term: 12
    };
    const promoActive = () => Date.now() <= PROMO.until.getTime();

    /* ======================================================================
       GOOGLE-UNTERNEHMENSPROFIL: hier die beiden Links eintragen
       profile: Link zum Profil (Google Maps → Profil → Teilen → Link kopieren)
       review:  Bewertungslink (Profil → „Rezensionen anfordern“ → Link kopieren)
       Solange review leer ist, bleiben alle Bewertungs-Buttons unsichtbar.
       ====================================================================== */
    const GOOGLE = {
        profile: '',
        review: ''
    };
    const VAT = 0.19;
    const gross = (n) => Math.round(n * (1 + VAT));

    /* ======================================================================
       1. NAVIGATION
       ====================================================================== */
    function initNav() {
        const nav = $('#site-nav');
        const toggle = $('#menu-toggle');
        const drawer = $('#mobile-nav');

        // Über dem dunklen Hero bleibt die Navigation dunkel
        const darkZones = $$('.hero');
        const onScroll = () => {
            const edge = nav.offsetHeight;
            const overDark = darkZones.some((el) => {
                const r = el.getBoundingClientRect();
                return r.top < edge && r.bottom > edge;
            });
            nav.classList.toggle('on-dark', overDark);
            nav.classList.toggle('is-scrolled', !overDark && window.scrollY > 8);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        const setMenu = (open) => {
            drawer.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        };
        toggle.addEventListener('click', () => setMenu(drawer.hidden));
        drawer.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) { setMenu(false); toggle.focus(); } });
        window.addEventListener('resize', () => { if (window.innerWidth > 1100) setMenu(false); });

        // aktiven Abschnitt in der Navigation markieren
        const links = $$('.nav-links a');
        if (!('IntersectionObserver' in window) || !links.length) return;
        const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                links.forEach((a) => a.classList.remove('is-current'));
                const link = byId.get(entry.target.id);
                if (link) link.classList.add('is-current');
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
    }

    /* ======================================================================
       2. SCROLL-REVEAL
       ====================================================================== */
    // Ausblenden erst, wenn dieses Skript läuft: lädt es nicht, bleibt alles sichtbar.
    // Zwei Wege blenden ein (Observer und Scroll-Prüfung), damit nichts hängen bleibt.
    function initReveal() {
        let items = $$('.reveal');
        if (reducedMotion || !items.length) return;
        document.documentElement.classList.add('reveal-ready');

        const show = (el) => el.classList.add('in-view');
        const check = () => {
            const line = window.innerHeight * 0.94;
            items = items.filter((el) => {
                const r = el.getBoundingClientRect();
                if (r.top < line && r.bottom > 0) { show(el); return false; }
                if (r.bottom <= 0) { show(el); return false; }      // übersprungen (Anker, Sprung nach unten)
                return true;
            });
            if (!items.length) window.removeEventListener('scroll', onScroll);
        };
        let ticking = false;
        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            const run = () => { if (!ticking) return; ticking = false; check(); };
            requestAnimationFrame(run);
            setTimeout(run, 120);           // falls rAF pausiert (Hintergrund-Tab)
        };
        check();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        window.addEventListener('load', check);
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach((entry) => { if (entry.isIntersecting) { show(entry.target); io.unobserve(entry.target); } });
            }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
            items.forEach((el) => io.observe(el));
        }
    }

    /* Google-Links aus der Konfiguration oben setzen */
    function initGoogleLinks() {
        if (GOOGLE.profile) $$('[data-google-profile]').forEach((a) => { a.href = GOOGLE.profile; });
        if (!GOOGLE.review) return;
        $$('[data-google-review]').forEach((a) => { a.href = GOOGLE.review; a.hidden = false; });
        $$('[data-google-review-box]').forEach((el) => { el.hidden = false; });
    }

    /* Leistungsfelder: das Feld in der Bildschirmmitte wird markiert */
    function initServiceProgress() {
        const rows = $$('.service-row');
        if (!rows.length || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                rows.forEach((r) => r.classList.toggle('is-current', r === entry.target));
            });
        }, { rootMargin: '-42% 0px -42% 0px' });
        rows.forEach((r) => io.observe(r));
    }

    /* ======================================================================
       3. PROJEKT-PLANER (Stepped UI + Live-Berechnung)
       ====================================================================== */
    let plannerSummaryText = '';

    function initPlanner() {
        const form = $('#planner');
        if (!form) return;

        const panels = $$('.planner-panel', form);
        const tabs = $$('.step-tab', form);
        const prev = $('[data-step-prev]', form);
        const next = $('[data-step-next]', form);
        const nextLabel = next.innerHTML;
        let step = 1;

        const stepsBar = $('.planner-steps', form);
        function goTo(n, scroll) {
            step = Math.min(Math.max(n, 1), panels.length);
            // auf kleinen Bildschirmen den neuen Schritt ins Bild holen
            if (scroll && stepsBar.getBoundingClientRect().top < -40) {
                stepsBar.scrollIntoView({ block: 'start', behavior: 'auto' });
            }
            panels.forEach((p) => p.classList.toggle('is-active', Number(p.dataset.step) === step));
            tabs.forEach((t) => {
                const s = Number(t.dataset.goto);
                t.classList.toggle('is-active', s === step);
                t.classList.toggle('is-done', s < step);
                if (s === step) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
            });
            prev.disabled = step === 1;
            next.innerHTML = step === panels.length
                ? 'Auswahl anfragen <svg class="ico" aria-hidden="true"><use href="#i-arrow-right"/></svg>'
                : nextLabel;
        }

        function readState() {
            return {
                base: (form.querySelector('input[name="base"]:checked') || {}).value || 'starter',
                extras: $$('input[name="extra"]:checked', form).map((i) => i.value),
                care: (form.querySelector('input[name="care"]:checked') || {}).value || 'none'
            };
        }

        function render() {
            const s = readState();
            const base = PRICES.base[s.base];
            const care = PRICES.care[s.care];
            const promo = promoActive() && s.base === PROMO.base && s.care === PROMO.care;

            // Karriereseite ist im Multipage-Paket enthalten
            const careerPrice = $('[data-price-career]', form);
            const careerIncluded = s.base === PRICES.extra.career.includedIn;
            careerPrice.classList.toggle('is-included', careerIncluded);
            careerPrice.innerHTML = careerIncluded ? 'inklusive <small>im Multipage-Paket</small>' : '390 € <small>einmalig</small>';

            const lines = [];
            let once = promo ? PROMO.once : base.once;
            if (s.base !== 'none') lines.push({ label: base.label, value: (base.from ? 'ab ' : '') + euro(promo ? PROMO.once : base.once), remove: 'base=none' });

            s.extras.forEach((key) => {
                const ex = PRICES.extra[key];
                const included = ex.includedIn === s.base;
                if (!included) once += ex.once;
                lines.push({ label: ex.label, value: included ? 'inklusive' : euro(ex.once), muted: included, remove: 'extra=' + key });
            });

            const month = promo ? PROMO.month : care.month;
            if (s.care !== 'none') lines.push({ label: care.label, value: euro(month) + ' / Mtl.', remove: 'care=none' });
            if (!lines.length) lines.push({ label: 'Noch nichts ausgewählt', value: '–', muted: true });

            $('#summary-lines').innerHTML = lines.map((l) =>
                '<li' + (l.muted ? ' class="is-muted"' : '') + '><span>' + l.label + '</span><span>' + l.value + '</span>'
                + (l.remove ? '<button type="button" class="summary-remove" data-remove="' + l.remove + '" aria-label="' + l.label + ' entfernen">×</button>' : '')
                + '</li>'
            ).join('');

            const prefix = base.from ? 'ab ' : '';
            $('#sum-once').innerHTML = (promo ? '<s>' + euro(base.once + (once - PROMO.once)) + '</s>' : '') + prefix + euro(once);
            $('#sum-month').innerHTML = (promo ? '<s>' + euro(care.month) + '</s>' : '') + euro(month);
            $('#sum-gross').textContent = 'inkl. 19 % MwSt.: ' + prefix + euro(gross(once)) + ' einmalig' + (month ? ' · ' + euro(gross(month)) + ' / Mtl.' : '');
            $('#sum-note').textContent = promo
                ? 'Black-Friday-Preis bis ' + PROMO.until.toLocaleDateString('de-DE') + ': ' + euro(PROMO.month) + ' in den ersten ' + PROMO.months + ' Monaten, danach ' + euro(care.month) + ' / Mtl. · ' + PROMO.term + ' Monate Laufzeit.'
                : (base.from ? 'Der Endpreis richtet sich nach Seitenzahl und Umfang.' : '');

            plannerSummaryText = 'Planer: ' + lines.filter((l) => !l.muted || l.value === 'inklusive').map((l) => l.label).join(' + ')
                + ' | einmalig ' + prefix + euro(once)
                + (month ? ' + ' + euro(month) + '/Mtl.' : '')
                + (promo ? ' (Black-Friday-Preis)' : '')
                + ' | netto zzgl. 19 % MwSt.';
        }

        form.addEventListener('change', render);

        // Auswahl in der Zusammenfassung wieder entfernen
        $('#summary-lines').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            const [name, value] = btn.dataset.remove.split('=');
            if (name === 'extra') {
                const box = form.querySelector('input[name="extra"][value="' + value + '"]');
                if (box) box.checked = false;
            } else {
                const radio = form.querySelector('input[name="' + name + '"][value="' + value + '"]');
                if (radio) radio.checked = true;
            }
            render();
        });
        tabs.forEach((t) => t.addEventListener('click', () => goTo(Number(t.dataset.goto))));
        prev.addEventListener('click', () => goTo(step - 1, true));
        next.addEventListener('click', () => {
            if (step < panels.length) goTo(step + 1, true);
            else Booking.open(plannerSummaryText);
        });
        $('#planner-cta').addEventListener('click', () => Booking.open(plannerSummaryText));

        // Voreinstellungen aus den Leistungs-Links (data-preset="base=starter")
        const STEP_OF = { base: 1, extra: 2, care: 3 };
        $$('[data-preset]').forEach((link) => link.addEventListener('click', () => {
            const [name, value] = link.dataset.preset.split('=');
            const input = form.querySelector('input[name="' + name + '"][value="' + value + '"]');
            if (input) input.checked = true;
            render();
            goTo(STEP_OF[name] || 1);
        }));

        // Aktion übernehmen
        const promoEls = $$('[data-promo]');
        if (!promoActive()) promoEls.forEach((el) => { el.hidden = true; });
        $$('[data-apply-promo]').forEach((link) => link.addEventListener('click', () => {
            form.querySelector('input[name="base"][value="' + PROMO.base + '"]').checked = true;
            form.querySelector('input[name="care"][value="' + PROMO.care + '"]').checked = true;
            render();
            goTo(3);
        }));

        render();
        goTo(1);
    }

    /* ======================================================================
       4. ANFRAGE-DIALOG + VERSAND (EmailJS-REST, erst beim Absenden)
       ====================================================================== */
    const EMAILJS = {
        endpoint: 'https://api.emailjs.com/api/v1.0/email/send',
        serviceId: 'service_0dbskyt',
        templateId: 'template_fw5wf4x',
        publicKey: 'yp4kKratoM3VsQhBg'
    };
    const CONTACT_EMAIL = 'info@mw-itservices.de';

    async function sendMail(params) {
        const res = await fetch(EMAILJS.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: EMAILJS.serviceId,
                template_id: EMAILJS.templateId,
                user_id: EMAILJS.publicKey,
                template_params: params
            })
        });
        if (!res.ok) throw new Error('EmailJS antwortet mit Status ' + res.status);
    }

    const Booking = (function () {
        const dialog = $('#booking');
        const form = $('#booking-form');
        const formArea = $('#booking-form-area');
        const success = $('#booking-success');
        const errorBox = $('#form-error');
        const submitBtn = $('#submit-btn');
        const submitLabel = submitBtn ? submitBtn.textContent : '';
        let sending = false;
        let lastSentAt = 0;

        function reset() {
            form.reset();
            formArea.hidden = false;
            success.hidden = true;
            errorBox.hidden = true;
            $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
        }

        function open(topic) {
            if (!dialog) return;
            if (!success.hidden) reset();
            $('#pkg-input').value = topic || 'Allgemeine Anfrage';
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
            setTimeout(() => $('#client-name').focus(), 60);
        }

        function close() {
            if (sending) return;
            if (dialog.open && typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
        }

        function showError(msg) {
            errorBox.textContent = msg;
            errorBox.hidden = false;
        }

        async function submit(event) {
            event.preventDefault();
            if (sending) return;
            errorBox.hidden = true;

            const fields = $$('input[required], textarea[required]', form);
            let firstInvalid = null;
            fields.forEach((f) => {
                const ok = f.type === 'checkbox' ? f.checked : f.value.trim() !== '' && f.checkValidity();
                if (ok) f.removeAttribute('aria-invalid');
                else { f.setAttribute('aria-invalid', 'true'); firstInvalid = firstInvalid || f; }
            });
            if (firstInvalid) {
                showError('Bitte füllen Sie alle Pflichtfelder aus.');
                firstInvalid.focus();
                return;
            }
            if ($('#hp-website').value.trim()) return;
            if (Date.now() - lastSentAt < 30000) { showError('Bitte warten Sie kurz vor einer weiteren Anfrage.'); return; }

            const params = {
                package: $('#pkg-input').value.trim().slice(0, 400),
                client_name: $('#client-name').value.trim().slice(0, 120),
                client_email: $('#client-email').value.trim().slice(0, 120),
                client_phone: $('#client-phone').value.trim().slice(0, 40),
                client_message: $('#client-msg').value.trim().slice(0, 1000) || 'Keine Nachricht hinterlassen.'
            };

            sending = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Wird gesendet …';
            try {
                await sendMail(params);
                lastSentAt = Date.now();
                formArea.hidden = true;
                success.hidden = false;
                success.focus();
            } catch (err) {
                console.error('Formularversand fehlgeschlagen:', err);
                showError('Der Versand hat leider nicht geklappt. Bitte schreiben Sie direkt an ' + CONTACT_EMAIL + '.');
            } finally {
                sending = false;
                submitBtn.disabled = false;
                submitBtn.textContent = submitLabel;
            }
        }

        if (dialog) {
            form.addEventListener('submit', submit);
            $$('[data-close-booking]', dialog).forEach((b) => b.addEventListener('click', close));
            dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
            dialog.addEventListener('cancel', (e) => { if (sending) e.preventDefault(); });
            document.addEventListener('click', (e) => {
                const trigger = e.target.closest('[data-book]');
                if (!trigger) return;
                e.preventDefault();
                open(trigger.dataset.book);
            });
        }

        return { open, close };
    })();

    /* ======================================================================
       5. SICHTBARKEITS-CHECK (Teaser nach 60 Sekunden, Report per E-Mail)
       ====================================================================== */
    /* Live-Test der eingegebenen Website.
       1. Voller Test über den Cloudflare Worker (harvey-agent/cloudflare): PageSpeed + Strukturanalyse,
          bewertet mit vis-rules.js, also identisch mit dem Harvey-Agent.
       2. Fallback ohne Worker: nur Google PageSpeed direkt aus dem Browser. Lokale Suche und
          KI-Readiness lassen sich so nicht prüfen und bleiben "im Report".
       Bewertung, Schwellen und Signale stehen ausschließlich in vis-rules.js (window.VisRules). */
    const ANALYZE_ENDPOINT = 'https://mw-sichtbarkeit.harvey-agent.workers.dev/analyze';
    const PSI_API_KEY = 'AIzaSyA8uDRhCVUSscnF7UndGk-N8dnTqpIAilk'; // nur für mw-itservices.de und localhost:5517 freigegeben
    const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const PSI_TIMEOUT_MS = 90000;

    async function runFullCheck(url, signal) {
        let res;
        try {
            res = await fetch(ANALYZE_ENDPOINT + '?url=' + encodeURIComponent(url), { signal, headers: { Accept: 'application/json' } });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw Object.assign(new Error('network'), { kind: 'unavailable' });
        }
        let data = null;
        try { data = await res.json(); } catch (err) { data = null; }
        if (res.status === 422) throw Object.assign(new Error('unreachable'), { kind: 'unreachable' });
        if (!res.ok || !data) throw Object.assign(new Error((data && data.error) || 'HTTP ' + res.status), { kind: 'unavailable' });
        return data;
    }

    function toTestUrl(raw) {
        let s = String(raw || '').trim().replace(/\s+/g, '');
        if (!s) return null;
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        try {
            const u = new URL(s);
            if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/i.test(u.hostname)) return null;
            return { url: u.origin + u.pathname, name: u.hostname.replace(/^www\./i, '') };
        } catch (err) {
            return null;
        }
    }

    async function runPageSpeed(url, signal) {
        const params = new URLSearchParams({ url, strategy: 'mobile', locale: 'de' });
        ['performance', 'seo', 'accessibility', 'best-practices'].forEach((c) => params.append('category', c));
        if (PSI_API_KEY) params.set('key', PSI_API_KEY);
        let res;
        try {
            res = await fetch(PSI_ENDPOINT + '?' + params.toString(), { signal });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw Object.assign(new Error('network'), { kind: 'unavailable' });
        }
        let data = null;
        try { data = await res.json(); } catch (err) { data = null; }
        if (!res.ok || !data || !data.lighthouseResult) {
            const msg = (data && data.error && data.error.message) || '';
            const kind = res.status === 429 || res.status === 403 ? 'unavailable'
                : /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|NO_FCP|NOT_HTML|unable to resolve|Unable to process/i.test(msg) ? 'unreachable'
                : 'unavailable';
            throw Object.assign(new Error(msg || 'HTTP ' + res.status), { kind });
        }
        return data.lighthouseResult;
    }

    function initVisibility() {
        const root = $('#sichtbarkeit');
        if (!root) return;
        const Rules = window.VisRules;
        if (!Rules) throw new Error('vis-rules.js nicht geladen');

        const form = $('#vis-form');
        const scan = $('#vis-scan');
        const result = $('#vis-result');
        const queryInput = $('#vis-query');
        const formError = $('#vis-form-error');
        const countEl = $('#vis-count');
        const scanRing = $('#vis-scan-ring');
        const scanName = $('#vis-scan-name');
        const statusEl = $('#vis-status');
        const steps = $$('#vis-steps li');
        const thanksName = $('#vis-thanks-name');
        const scoreRing = $('#vis-score-ring');
        const scoreValue = $('#vis-score-value');
        const scoreLabel = $('#vis-score-label');
        const scoreKicker = $('#vis-score-kicker');
        const resultHeading = $('#vis-result-heading');
        const scoreNote = $('#vis-score-note');
        const pointsEl = $('#vis-points');
        const unlock = $('#vis-unlock');
        const thanks = $('#vis-thanks');
        const mailError = $('#vis-mail-error');
        const sendBtn = $('#vis-send');
        const sendLabel = sendBtn.innerHTML;
        const panelEl = $('#vis-panel');
        const STATUS = [
            'Google PageSpeed ruft Ihre Website auf.',
            'Die Seite wird wie auf einem Smartphone im Mobilfunknetz geladen.',
            'Core Web Vitals werden ausgewertet.',
            'Titel, Beschreibung und Indexierung werden geprüft.',
            'Verschlüsselung und Sicherheit werden geprüft.',
            'Ergebnis steht bereit.'
        ];
        const MIN_SCAN_MS = 5000;

        let timer = 0;
        let startedAt = 0;
        let target = null;
        let report = null;
        let controller = null;
        let runId = 0;
        let sending = false;
        let lastSentAt = 0;
        let lastStep = -1;

        function show(stage) {
            if (panelEl) panelEl.dataset.stage = stage;
            form.hidden = stage !== 'form';
            scan.hidden = stage !== 'scan';
            result.hidden = stage !== 'result';
        }

        function formatTime(ms) {
            const sec = Math.floor(ms / 1000);
            return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
        }

        function stopTimer() {
            if (timer) {
                clearInterval(timer);
                timer = 0;
            }
        }

        function paint(elapsed, done) {
            const progress = done ? 1 : Math.min(0.94, 1 - Math.exp(-elapsed / 16000));
            countEl.textContent = formatTime(elapsed);
            scanRing.style.setProperty('--p', String(progress));
            const last = steps.length - 1;
            const step = done ? last : Math.min(last - 1, Math.floor((progress / 0.94) * last));
            steps.forEach((li, i) => {
                li.classList.toggle('is-done', i < step || done);
                li.classList.toggle('is-current', i === step && !done);
            });
            if (step !== lastStep) {
                lastStep = step;
                statusEl.textContent = STATUS[Math.min(step, STATUS.length - 1)];
            }
        }

        function setFormError(text) {
            queryInput.setAttribute('aria-invalid', 'true');
            formError.textContent = text;
            formError.hidden = false;
        }

        /* Ein Kernpunkt: offen mit Ampel (Weckruf) oder geblurrt mit Schloss. */
        function pointItem(p) {
            const li = document.createElement('li');
            const open = p.open && p.status !== 'pending';
            const measured = p.status !== 'pending';
            // Auch verdeckte Punkte zeigen ihre Ampel, damit der Bedarf sofort sichtbar ist; nur die Details bleiben im Report.
            li.className = 'vis-point ' + (open ? 'is-open' : 'is-blurred') + (measured ? ' is-' + p.status : '');
            const k = document.createElement('p');
            k.className = 'vis-point-kicker';
            if (open) {
                const dot = document.createElement('span');
                dot.className = 'vis-point-dot';
                dot.setAttribute('aria-hidden', 'true');
                k.append(dot, document.createTextNode(Rules.STATUS_TEXT[p.status] + ' · ' + p.value));
            } else if (measured) {
                const dot = document.createElement('span');
                dot.className = 'vis-point-dot';
                dot.setAttribute('aria-hidden', 'true');
                k.append(dot, document.createTextNode(Rules.STATUS_TEXT[p.status]));
                k.insertAdjacentHTML('beforeend', '<svg class="ico vis-point-lock" aria-hidden="true"><use href="#i-lock"/></svg>');
            } else {
                k.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg>';
                k.append(document.createTextNode('Im vollständigen Report'));
            }
            const h = document.createElement('h3');
            h.textContent = p.title;
            const body = document.createElement('p');
            body.textContent = p.text;
            if (open) {
                li.append(k, h, body);
                return li;
            }
            const veil = document.createElement('div');
            veil.className = 'vis-veil';
            veil.setAttribute('aria-hidden', 'true');
            const val = document.createElement('span');
            val.className = 'vis-veil-value';
            val.textContent = p.value;
            veil.append(val, body);
            const sr = document.createElement('span');
            sr.className = 'visually-hidden';
            sr.textContent = 'Ergebnis im vollständigen Report.';
            li.append(k, h, veil, sr);
            return li;
        }

        function openText(points) {
            const open = points.filter((p) => p.open).length;
            const rest = points.length - open;
            const words = ['Kein', 'Ein', 'Zwei', 'Drei', 'Vier'];
            const restWords = ['keine', 'ein', 'zwei', 'drei', 'vier'];
            if (!rest) return 'Alle Punkte sind offen.';
            return (words[open] || open) + (open === 1 ? ' Punkt ist' : ' Punkte sind') + ' offen, ' + (restWords[rest] || rest) + ' weitere' + (rest === 1 ? 'r steht' : ' stehen') + ' im vollständigen Report.';
        }

        /* Zeigt einen Report im Format von vis-rules.js (Live-Test oder Harvey-JSON). */
        function renderReport(r) {
            pointsEl.textContent = '';
            const measured = r.points.filter((p) => p.status !== 'pending');
            const hasCount = typeof r.total === 'number' && r.total > 0;
            scoreRing.style.setProperty('--p', String(hasCount ? r.met / r.total : 0));
            scoreValue.textContent = hasCount ? String(r.met) : '–';
            scoreLabel.textContent = hasCount ? 'von ' + r.total : 'offen';
            scoreKicker.textContent = hasCount ? 'Sichtbarkeits-Signale erfüllt' : 'Live-Test';
            resultHeading.textContent = r.headline;

            scoreNote.textContent = '';
            if (!measured.length) {
                scoreNote.textContent = 'Für ' + r.name + ' kam gerade keine Messung zustande. Ich prüfe die Seite gern von Hand und schicke Ihnen alle vier Punkte.';
            } else {
                const date = new Date(r.measuredAt);
                const when = isNaN(date) ? '' : ' am ' + date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
                const strong = document.createElement('strong');
                strong.textContent = r.name;
                scoreNote.append(document.createTextNode('Gemessen für '), strong,
                    document.createTextNode(when + ' (' + r.source + '). ' + openText(r.points)));
            }
            r.points.filter((p) => p.open).concat(r.points.filter((p) => !p.open)).forEach((p) => pointsEl.appendChild(pointItem(p)));
        }

        function present(r) {
            report = r;
            target = { url: r.url, name: r.name };
            renderReport(r);
            thanksName.textContent = r.name;
            unlock.hidden = false;
            thanks.hidden = true;
            mailError.hidden = true;
            show('result');
        }

        async function begin(t) {
            target = t;
            report = null;
            const id = ++runId;
            scanName.textContent = t.name;
            startedAt = Date.now();
            lastStep = -1;
            steps.forEach((li) => li.classList.remove('is-done', 'is-current'));
            paint(0, false);
            show('scan');
            stopTimer();
            timer = setInterval(() => paint(Date.now() - startedAt, false), reducedMotion ? 1000 : 200);

            if (controller) controller.abort();
            controller = new AbortController();
            const timeout = setTimeout(() => controller && controller.abort(), PSI_TIMEOUT_MS);
            let full = null;
            let psi = null;
            let failure = null;
            try {
                if (ANALYZE_ENDPOINT) {
                    try {
                        full = Rules.sanitizeReport(await runFullCheck(t.url, controller.signal));
                        if (!full) throw Object.assign(new Error('format'), { kind: 'unavailable' });
                    } catch (err) {
                        if (err.kind === 'unreachable' || err.name === 'AbortError') throw err;
                        console.warn('Voller Test nicht verfügbar, nur PageSpeed:', err.message || err);
                    }
                }
                if (!full) psi = Rules.metricsFromLighthouse(await runPageSpeed(t.url, controller.signal));
            } catch (err) {
                failure = err;
            } finally {
                clearTimeout(timeout);
            }
            if (id !== runId) return; // abgebrochen oder neu gestartet
            const wait = MIN_SCAN_MS - (Date.now() - startedAt);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            if (id !== runId) return;

            stopTimer();
            if (failure && failure.kind === 'unreachable') {
                show('form');
                setFormError('Google konnte ' + t.name + ' nicht aufrufen. Stimmt die Adresse?');
                queryInput.focus();
                return;
            }
            if (failure) console.warn('PageSpeed-Test nicht möglich:', failure.message || failure);
            paint(Date.now() - startedAt, true);
            // Voller Report vom Worker, sonst nur PageSpeed; ohne Messung bleiben alle 4 Punkte im Report.
            present(full || Rules.buildReport({ url: t.url, name: t.name, psi, structure: null }));
            resultHeading.focus();
        }

        function reset() {
            runId++;
            if (controller) controller.abort();
            controller = null;
            stopTimer();
            show('form');
            formError.hidden = true;
            queryInput.removeAttribute('aria-invalid');
            queryInput.focus();
        }

        /* Vorbereiteter Report aus dem Harvey-Agent: ?check=<id> lädt reports/<id>.json.
           Status und Score kommen fertig aus dem JSON, hier wird nichts neu bewertet. */
        function loadPrepared() {
            const id = new URLSearchParams(window.location.search).get('check');
            if (!id || !/^[a-z0-9-]{3,90}$/.test(id)) return;
            fetch('reports/' + id + '.json', { cache: 'no-cache' })
                .then((res) => (res.ok ? res.json() : null))
                .then((d) => {
                    const r = Rules.sanitizeReport(d);
                    if (!r) {
                        if (d) console.warn('Report ' + id + ' hat ein unbekanntes Format.');
                        return;
                    }
                    queryInput.value = r.name;
                    present(r);
                })
                .catch((err) => console.warn('Report ' + id + ' nicht geladen:', err));
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const value = queryInput.value.trim();
            const t = toTestUrl(value.slice(0, 200));
            if (!t) {
                setFormError(value.length < 2
                    ? 'Bitte tragen Sie die Adresse Ihrer Website ein.'
                    : 'Für den Test brauche ich die Website-Adresse, z. B. huber-maler.de. Noch keine Website? Dann sprechen Sie mich direkt an.');
                queryInput.focus();
                return;
            }
            queryInput.removeAttribute('aria-invalid');
            formError.hidden = true;
            begin(t);
        });

        $('#vis-cancel').addEventListener('click', reset);
        $('#vis-restart').addEventListener('click', () => {
            if (sending) return;
            unlock.reset();
            reset();
        });

        unlock.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (sending || !target) return;
            mailError.hidden = true;
            const email = $('#vis-email');
            const consent = $('#vis-consent');
            let invalid = null;
            if (!email.value.trim() || !email.checkValidity()) {
                email.setAttribute('aria-invalid', 'true');
                invalid = email;
            } else email.removeAttribute('aria-invalid');
            if (!consent.checked) {
                consent.setAttribute('aria-invalid', 'true');
                invalid = invalid || consent;
            } else consent.removeAttribute('aria-invalid');
            if (invalid) {
                mailError.textContent = consent.checked
                    ? 'Bitte geben Sie eine gültige E-Mail-Adresse ein.'
                    : 'Bitte bestätigen Sie die Einwilligung, damit ich Ihnen den Report schicken darf.';
                mailError.hidden = false;
                invalid.focus();
                return;
            }
            if ($('#vis-hp').value.trim()) return;
            if (Date.now() - lastSentAt < 30000) {
                mailError.textContent = 'Bitte warten Sie kurz vor einer weiteren Anfrage.';
                mailError.hidden = false;
                return;
            }

            const summary = report
                ? 'Signale ' + (report.total ? report.met + '/' + report.total : 'offen') + (report.id ? ' (Report ' + report.id + ')' : '') + '. '
                    + report.points.map((p) => p.title + ': ' + p.value + ' (' + Rules.STATUS_TEXT[p.status] + ')'
                        + (p.signals && p.signals.some((s) => !s.ok) ? ', fehlt: ' + p.signals.filter((s) => !s.ok).map((s) => s.label).join(', ') : '')).join('; ') + '.'
                : 'Keine Messung vorhanden, bitte von Hand prüfen.';

            sending = true;
            sendBtn.disabled = true;
            sendBtn.innerHTML = 'Wird gesendet …';
            try {
                await sendMail({
                    package: 'Website-Test: vollständiger Report',
                    client_name: target.name.slice(0, 120),
                    client_email: email.value.trim().slice(0, 120),
                    client_phone: 'nicht angegeben',
                    client_message: ('Bitte um den persönlichen Sichtbarkeits-Report für ' + target.url + '. ' + summary + ' DSGVO-Einwilligung: ja.').slice(0, 1500)
                });
                lastSentAt = Date.now();
                unlock.hidden = true;
                thanks.hidden = false;
                thanks.focus();
            } catch (err) {
                console.error('Sichtbarkeits-Report fehlgeschlagen:', err);
                mailError.textContent = 'Der Versand hat leider nicht geklappt. Bitte schreiben Sie direkt an ' + CONTACT_EMAIL + '.';
                mailError.hidden = false;
            } finally {
                sending = false;
                sendBtn.disabled = false;
                sendBtn.innerHTML = sendLabel;
            }
        });

        loadPrepared();
    }
    /* ======================================================================
       6. ERSPARNIS-RECHNER
       ====================================================================== */
    const AUTOMATION_PRICE = 1190;   // komplette Workflow-Einrichtung, netto
    const AUTOMATION_SHARE = 0.3;    // vorsichtige Annahme: 30 % der Routinearbeit
    const WEEKS_PER_MONTH = 4.33;

    function formatAmortization(moneyPerMonth) {
        if (moneyPerMonth <= 0) return '–';
        const weeks = (AUTOMATION_PRICE / moneyPerMonth) * WEEKS_PER_MONTH;
        if (weeks < 1) return '< 1 Woche';
        if (weeks <= 10) { const w = Math.round(weeks); return '~ ' + w + (w === 1 ? ' Woche' : ' Wochen'); }
        const m = Math.round(weeks / WEEKS_PER_MONTH);
        return '~ ' + m + (m === 1 ? ' Monat' : ' Monate');
    }

    function initCalculator() {
        const hoursEl = $('#calc-hours');
        const rateEl = $('#calc-rate');
        if (!hoursEl || !rateEl) return;

        const fill = (el) => el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');

        function update() {
            const hours = Number(hoursEl.value);
            const rate = Number(rateEl.value);
            const savedHours = Math.round(hours * WEEKS_PER_MONTH * AUTOMATION_SHARE);
            const savedMoney = savedHours * rate;
            $('#hours-val').textContent = hours + ' Std.';
            $('#rate-val').textContent = rate + ' €';
            $('#res-hours').textContent = savedHours + ' Std.';
            $('#res-money').textContent = euro(savedMoney);
            $('#res-amort').textContent = formatAmortization(savedMoney);
            fill(hoursEl);
            fill(rateEl);
        }
        hoursEl.addEventListener('input', update);
        rateEl.addEventListener('input', update);
        update();
    }

    /* ======================================================================
       6. PIPELINE (läuft nur, solange sie sichtbar ist)
       ====================================================================== */
    function initPipeline() {
        const steps = $$('#pipeline .pipe-step');
        if (!steps.length) return;
        let active = 2;
        let timer = null;

        const render = () => steps.forEach((s, i) => s.classList.toggle('is-active', i === active));
        const stop = () => { clearInterval(timer); timer = null; };
        const start = () => {
            stop();
            if (reducedMotion || document.hidden) return;
            timer = setInterval(() => { active = (active + 1) % steps.length; render(); }, 2800);
        };

        steps.forEach((s, i) => {
            const pick = () => { active = i; render(); start(); };
            s.addEventListener('mouseenter', pick);
            s.addEventListener('click', pick);
        });
        document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
        if ('IntersectionObserver' in window) {
            new IntersectionObserver((entries) => (entries[0].isIntersecting ? start() : stop()), { threshold: 0.3 })
                .observe($('#pipeline'));
        }
        render();
    }

    /* ======================================================================
       7. 3D-TILT mit Feder-Physik
       Jede Karte federt zum Zielwinkel (Masse-Feder-Dämpfer), Ebenen mit
       data-depth schweben je nach Tiefe vor der Karte.
       ====================================================================== */
    function initTilt() {
        if (!finePointer || reducedMotion) return;

        const STIFFNESS = 0.11;
        const DAMPING = 0.74;
        const KEYS = ['rx', 'ry', 'lift', 'gx', 'gy'];

        $$('[data-tilt]').forEach((el) => {
            const max = Number(el.dataset.tiltMax) || 3;
            const flat = el.hasAttribute('data-tilt-flat');
            let pressed = false;

            const glare = document.createElement('span');
            glare.className = 'tilt-glare';
            glare.setAttribute('aria-hidden', 'true');
            if (!flat) glare.dataset.depth = '1.4';
            el.appendChild(glare);
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
            $$('[data-depth]', el).forEach((layer) => layer.style.setProperty('--z', layer.dataset.depth));

            const pos = { rx: 0, ry: 0, lift: 0, gx: 50, gy: 50 };
            const vel = { rx: 0, ry: 0, lift: 0, gx: 0, gy: 0 };
            const tgt = { rx: 0, ry: 0, lift: 0, gx: 50, gy: 50 };
            let raf = 0;

            function apply() {
                el.style.setProperty('--rx', pos.rx.toFixed(3) + 'deg');
                el.style.setProperty('--ry', pos.ry.toFixed(3) + 'deg');
                el.style.setProperty('--lift', pos.lift.toFixed(3));
                el.style.setProperty('--gx', pos.gx.toFixed(1) + '%');
                el.style.setProperty('--gy', pos.gy.toFixed(1) + '%');
                el.style.setProperty('--sx', (-pos.ry * 6).toFixed(1) + 'px');
                el.style.setProperty('--sy', (10 + pos.rx * 4).toFixed(1) + 'px');
            }

            function tick() {
                let moving = false;
                KEYS.forEach((k) => {
                    vel[k] = (vel[k] + (tgt[k] - pos[k]) * STIFFNESS) * DAMPING;
                    pos[k] += vel[k];
                    if (Math.abs(vel[k]) > 0.001 || Math.abs(tgt[k] - pos[k]) > 0.001) moving = true;
                    else { pos[k] = tgt[k]; vel[k] = 0; }
                });
                apply();
                if (moving) { raf = requestAnimationFrame(tick); return; }
                raf = 0;
                if (tgt.lift === 0) {
                    el.classList.remove('is-tilting');
                    ['--rx', '--ry', '--lift', '--gx', '--gy', '--sx', '--sy'].forEach((p) => el.style.removeProperty(p));
                }
            }
            const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

            // Während ein Klick läuft, steht die Karte still: sonst wandert das
            // Ziel unter dem Mauszeiger weg und der Klick geht verloren.
            el.addEventListener('pointerdown', () => { pressed = true; });
            window.addEventListener('pointerup', () => { pressed = false; });

            el.addEventListener('pointermove', (e) => {
                if (e.pointerType !== 'mouse' || pressed) return;
                const r = el.getBoundingClientRect();
                const nx = (e.clientX - r.left) / r.width;
                const ny = (e.clientY - r.top) / r.height;
                el.classList.add('is-tilting');
                tgt.ry = (nx - 0.5) * 2 * max;
                tgt.rx = -(ny - 0.5) * 2 * max;
                tgt.gx = nx * 100;
                tgt.gy = ny * 100;
                tgt.lift = 1;
                kick();
            });
            el.addEventListener('pointerleave', () => {
                pressed = false;
                tgt.rx = 0; tgt.ry = 0; tgt.lift = 0; tgt.gx = 50; tgt.gy = 50;
                kick();
            });
        });
    }

    /* ======================================================================
       8. HERO-3D: Haus aus Kupferlinien, umkreist von Datenknoten
       Handwerk (das Haus) trifft Digitalisierung (Knoten und Datenimpulse,
       die ins Haus fließen). Reines Canvas, keine Bibliothek, pausiert
       außerhalb des Sichtfelds.
       ====================================================================== */
    function initHero3D() {
        const canvas = $('#hero-3d');
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        const stage = canvas.parentElement;

        // --- Geometrie -----------------------------------------------------
        const V = [];
        const E = [];
        const v = (x, y, z) => V.push([x, y, z]) - 1;
        const e = (a, b, kind) => E.push({ a, b, kind: kind || 'house' });
        const box = (x0, x1, y0, y1, z0, z1, kind) => {
            const p = [
                v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1),
                v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)
            ];
            [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
                .forEach(([a, b]) => e(p[a], p[b], kind));
            return p;
        };
        const rect = (x0, x1, y0, y1, z, cross) => {
            const a = v(x0, y0, z), b = v(x1, y0, z), c = v(x1, y1, z), d = v(x0, y1, z);
            e(a, b, 'detail'); e(b, c, 'detail'); e(c, d, 'detail'); e(d, a, 'detail');
            if (cross) {
                const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                e(v(mx, y0, z), v(mx, y1, z), 'detail');
                e(v(x0, my, z), v(x1, my, z), 'detail');
            }
        };

        // Baukörper
        const body = box(-1, 1, -0.7, 0.35, -0.75, 0.75);
        // Dach mit Überstand
        const r0 = v(-1.1, 1.0, 0), r1 = v(1.1, 1.0, 0);
        const ef = [v(-1.1, 0.3, 0.86), v(1.1, 0.3, 0.86)];
        const eb = [v(-1.1, 0.3, -0.86), v(1.1, 0.3, -0.86)];
        e(r0, r1, 'roof');
        e(ef[0], ef[1], 'roof'); e(eb[0], eb[1], 'roof');
        e(ef[0], r0, 'roof'); e(eb[0], r0, 'roof'); e(ef[1], r1, 'roof'); e(eb[1], r1, 'roof');
        // Dachsparren
        [-0.55, 0, 0.55].forEach((x) => { const t = v(x, 1.0, 0); e(v(x, 0.3, 0.86), t, 'detail'); e(v(x, 0.3, -0.86), t, 'detail'); });
        // Schornstein
        box(0.45, 0.65, 0.55, 1.2, -0.42, -0.22, 'detail');
        // Tür und Fenster vorn, Fenster seitlich
        rect(-0.18, 0.18, -0.7, -0.12, 0.75, false);
        rect(-0.78, -0.42, -0.32, 0.08, 0.75, true);
        rect(0.42, 0.78, -0.32, 0.08, 0.75, true);
        rect(-0.78, -0.42, -0.32, 0.08, -0.75, true);
        rect(0.42, 0.78, -0.32, 0.08, -0.75, true);
        // Boden: zwei Kreise
        const ring = (r, n, kind) => {
            const first = V.length;
            for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; v(Math.cos(a) * r, -0.7, Math.sin(a) * r); }
            for (let i = 0; i < n; i++) if (i % 2 === 0) e(first + i, first + ((i + 1) % n), kind);
        };
        ring(1.65, 64, 'ground');
        ring(2.15, 96, 'ground');

        // Flächen für Volumen (Wände, Giebel, Dach)
        const F = [
            { p: [body[3], body[2], body[6], body[7]], kind: 'wall' },
            { p: [body[0], body[1], body[5], body[4]], kind: 'wall' },
            { p: [body[0], body[3], body[7], body[4]], kind: 'wall' },
            { p: [body[1], body[2], body[6], body[5]], kind: 'wall' },
            { p: [body[4], body[7], r0], kind: 'wall' },
            { p: [body[5], body[6], r1], kind: 'wall' },
            { p: [ef[0], ef[1], r1, r0], kind: 'roof' },
            { p: [eb[0], eb[1], r1, r0], kind: 'roof' }
        ];

        // Ankerpunkte am Haus, an denen die Daten ankommen
        const anchors = [r0, r1, body[4], body[5], body[6], body[7]];

        // Umlaufende Datenknoten
        const nodes = [
            { r: 2.2, y: 0.9, a: 0.3, s: 0.22 },
            { r: 2.45, y: 0.1, a: 2.2, s: -0.16 },
            { r: 2.0, y: 1.55, a: 4.1, s: 0.19 },
            { r: 2.6, y: -0.35, a: 5.3, s: 0.13 },
            { r: 2.3, y: 1.25, a: 1.2, s: -0.21 }
        ];

        // Datenimpulse: wandern von Knoten zum Haus und über die Kanten
        const houseEdges = E.map((ed, i) => (ed.kind === 'house' || ed.kind === 'roof') ? i : -1).filter((i) => i >= 0);
        const pulses = [];
        for (let i = 0; i < 10; i++) pulses.push({ edge: houseEdges[(i * 7) % houseEdges.length], t: Math.random(), speed: 0.25 + Math.random() * 0.35 });
        const links = nodes.map((n, i) => ({ node: i, anchor: anchors[i % anchors.length], t: Math.random(), speed: 0.35 + Math.random() * 0.25 }));

        // --- Zustand -------------------------------------------------------
        const COLORS = {
            pale: [240, 201, 166],
            bright: [223, 154, 103],
            mid: [181, 101, 53],
            dark: [140, 74, 37]
        };
        let W = 0, H = 0, DPR = 1, scale = 1;
        let yaw = -0.6, pitch = 0.32;
        const look = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
        // Haus steht sofort: kein leerer Rahmen, wenn man dorthin scrollt
        let build = 1;
        let last = performance.now();
        let raf = 0;
        let visible = true;

        function resize() {
            const r = canvas.getBoundingClientRect();
            DPR = Math.min(window.devicePixelRatio || 1, finePointer ? 2 : 1.5);
            W = Math.max(1, Math.round(r.width * DPR));
            H = Math.max(1, Math.round(r.height * DPR));
            canvas.width = W; canvas.height = H;
            scale = Math.min(W, H) * 0.25;
            if (!raf) draw();
        }

        function project(p, cy, sy, cp, sp) {
            // Drehung um Y (yaw), dann um X (pitch)
            const x1 = p[0] * cy - p[2] * sy;
            const z1 = p[0] * sy + p[2] * cy;
            const y1 = p[1] - 0.15;
            const y2 = y1 * cp - z1 * sp;
            const z2 = y1 * sp + z1 * cp;
            const d = 6.2;
            const f = d / (d - z2);
            return { x: W / 2 + x1 * scale * f, y: H * 0.5 - y2 * scale * f, z: z2, f };
        }

        const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
        const depthAlpha = (z) => 0.28 + 0.72 * Math.min(1, Math.max(0, (z + 2.4) / 4.8));

        function draw() {
            ctx.clearRect(0, 0, W, H);
            const Y = yaw + look.x, P = pitch + look.y;
            const cy = Math.cos(Y), sy = Math.sin(Y), cp = Math.cos(P), sp = Math.sin(P);
            const pts = V.map((p) => project(p, cy, sy, cp, sp));
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Flächen von hinten nach vorn, heller je näher und je mehr zum Licht gedreht
            if (build > 0.35) {
                const fade = Math.min(1, (build - 0.35) / 0.65);
                F.map((f) => ({ f, z: f.p.reduce((s, i) => s + pts[i].z, 0) / f.p.length }))
                    .sort((a, b) => a.z - b.z)
                    .forEach(({ f, z }) => {
                        const q = f.p.map((i) => pts[i]);
                        // Ausrichtung zur Kamera über die Fläche im Bild
                        let area = 0;
                        for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; area += a.x * b.y - b.x * a.y; }
                        const facing = Math.min(1, Math.abs(area) / (scale * scale * 1.6));
                        const base = f.kind === 'roof' ? 0.22 : 0.1;
                        const g = ctx.createLinearGradient(0, Math.min(...q.map((p) => p.y)), 0, Math.max(...q.map((p) => p.y)));
                        const col = f.kind === 'roof' ? COLORS.mid : COLORS.dark;
                        const a = base * (0.45 + 0.55 * facing) * depthAlpha(z) * fade;
                        g.addColorStop(0, rgba(f.kind === 'roof' ? COLORS.bright : col, a));
                        g.addColorStop(1, rgba(col, a * 0.35));
                        ctx.fillStyle = g;
                        ctx.beginPath();
                        q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                        ctx.closePath();
                        ctx.fill();
                    });
            }

            // Kanten, beim Laden nacheinander aufgebaut
            E.forEach((ed, i) => {
                const local = Math.min(1, Math.max(0, build * 1.6 - (i / E.length) * 0.6));
                if (local <= 0) return;
                const a = pts[ed.a], b = pts[ed.b];
                const z = (a.z + b.z) / 2;
                let col = COLORS.bright, w = 1.8, alpha = depthAlpha(z);
                if (ed.kind === 'roof') { col = COLORS.pale; w = 2.4; }
                if (ed.kind === 'detail') { col = COLORS.mid; w = 1; alpha *= 0.85; }
                if (ed.kind === 'ground') { col = COLORS.dark; w = 1; alpha *= 0.55; }
                ctx.strokeStyle = rgba(col, alpha * local);
                ctx.lineWidth = w * DPR;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(a.x + (b.x - a.x) * local, a.y + (b.y - a.y) * local);
                ctx.stroke();
            });

            if (build < 1) return;

            // Datenknoten und ihre Verbindungen zum Haus
            const nodePts = nodes.map((n) => project([Math.cos(n.a) * n.r, n.y, Math.sin(n.a) * n.r], cy, sy, cp, sp));
            links.forEach((l) => {
                const a = nodePts[l.node], b = pts[l.anchor];
                const alpha = depthAlpha((a.z + b.z) / 2) * 0.35;
                ctx.setLineDash([3 * DPR, 6 * DPR]);
                ctx.strokeStyle = rgba(COLORS.bright, alpha);
                ctx.lineWidth = 1 * DPR;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                ctx.setLineDash([]);
                // Impuls auf dem Weg ins Haus
                const px = a.x + (b.x - a.x) * l.t, py = a.y + (b.y - a.y) * l.t;
                ctx.fillStyle = rgba(COLORS.pale, depthAlpha(a.z) * 0.95);
                ctx.beginPath(); ctx.arc(px, py, 2.2 * DPR, 0, Math.PI * 2); ctx.fill();
            });
            nodePts.forEach((p) => {
                const alpha = depthAlpha(p.z);
                ctx.fillStyle = rgba([20, 17, 15], 1);
                ctx.strokeStyle = rgba(COLORS.bright, alpha);
                ctx.lineWidth = 1.4 * DPR;
                ctx.beginPath(); ctx.arc(p.x, p.y, 7 * DPR * p.f, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = rgba(COLORS.pale, alpha);
                ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * DPR * p.f, 0, Math.PI * 2); ctx.fill();
            });

            // Impulse entlang der Hauskanten
            pulses.forEach((pu) => {
                const ed = E[pu.edge];
                const a = pts[ed.a], b = pts[ed.b];
                const x = a.x + (b.x - a.x) * pu.t, y = a.y + (b.y - a.y) * pu.t;
                const alpha = depthAlpha(a.z + (b.z - a.z) * pu.t);
                ctx.fillStyle = rgba(COLORS.pale, alpha);
                ctx.beginPath(); ctx.arc(x, y, 2 * DPR, 0, Math.PI * 2); ctx.fill();
            });
        }

        const minFrame = finePointer ? 0 : 1000 / 30;
        function step(now) {
            if (now - last < minFrame) { raf = visible && !document.hidden ? requestAnimationFrame(step) : 0; return; }
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (build < 1) build = Math.min(1, build + dt / 2.2);
            yaw += dt * 0.18;
            // Feder zum Mausziel
            look.vx = (look.vx + (look.tx - look.x) * 0.06) * 0.82;
            look.vy = (look.vy + (look.ty - look.y) * 0.06) * 0.82;
            look.x += look.vx; look.y += look.vy;
            nodes.forEach((n) => { n.a += dt * n.s; });
            links.forEach((l) => { l.t += dt * l.speed; if (l.t > 1) l.t = 0; });
            pulses.forEach((pu) => {
                pu.t += dt * pu.speed;
                if (pu.t > 1) { pu.t = 0; pu.edge = houseEdges[Math.floor(Math.random() * houseEdges.length)]; }
            });
            draw();
            raf = visible && !document.hidden ? requestAnimationFrame(step) : 0;
        }
        const start = () => { if (!raf && !reducedMotion) { last = performance.now(); raf = requestAnimationFrame(step); } };

        if (finePointer && stage) {
            stage.addEventListener('pointermove', (ev) => {
                const r = stage.getBoundingClientRect();
                look.tx = ((ev.clientX - r.left) / r.width - 0.5) * 0.7;
                look.ty = ((ev.clientY - r.top) / r.height - 0.5) * 0.3;
            });
            stage.addEventListener('pointerleave', () => { look.tx = 0; look.ty = 0; });
        }

        if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
        else window.addEventListener('resize', resize);
        resize();

        if ('IntersectionObserver' in window) {
            new IntersectionObserver((entries) => {
                visible = entries[0].isIntersecting;
                if (visible) start();
            }).observe(canvas);
        }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
        if (reducedMotion) draw(); else start();
    }

    /* ======================================================================
       9. SICHTBARKEITS-CHECK ALS HOLOGRAMM
       Hinter der Karte schweben Kupferknoten, verbunden durch feine Lichtbahnen.
       Fokus im Eingabefeld: die Bahnen richten sich auf das Feld aus.
       Während des Scans: die Bahnen laufen auf den Countdown-Kern zu.
       ====================================================================== */
    function initVisNetwork() {
        const canvas = $('#vis-network-canvas');
        const panel = $('#vis-panel');
        const input = $('#vis-query');
        if (!canvas || !panel || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');

        // Hero-Button und Nav-Link: direkt ins Feld statt nur dorthin scrollen
        $$('a[href="#sichtbarkeit"]').forEach((link) => link.addEventListener('click', (ev) => {
            if (panel.dataset.stage !== 'form' || !input) return;
            const r = panel.getBoundingClientRect();
            const inView = r.top >= 0 && r.bottom <= window.innerHeight + 40;
            if (inView) { ev.preventDefault(); input.focus(); }
            else window.setTimeout(() => input.focus({ preventScroll: true }), reducedMotion ? 0 : 600);
        }));

        const N = finePointer ? 26 : 16;
        const nodes = Array.from({ length: N }, (_, i) => ({
            x: Math.random(), y: Math.random(), z: Math.random(),     // z: 0 hinten, 1 vorn
            vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.012,
            phase: Math.random() * Math.PI * 2,
            hub: i % 5 === 0
        }));
        const pulses = Array.from({ length: 7 }, () => ({ a: 0, b: 1, t: Math.random(), speed: 0.25 + Math.random() * 0.3 }));
        const pickLink = (p) => { p.a = Math.floor(Math.random() * N); p.b = Math.floor(Math.random() * N); if (p.a === p.b) p.b = (p.b + 1) % N; p.t = 0; };
        pulses.forEach(pickLink);

        let W = 0, H = 0, DPR = 1, raf = 0, last = 0, visible = true;
        let focus = 0, focusT = 0, scanAmt = 0;
        const par = { x: 0, y: 0, tx: 0, ty: 0 };
        const LINK = 0.24;   // Verbindungsradius als Anteil der Breite

        const resize = () => {
            const r = canvas.getBoundingClientRect();
            DPR = Math.min(window.devicePixelRatio || 1, finePointer ? 2 : 1.5);
            W = Math.max(1, r.width); H = Math.max(1, r.height);
            canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
            if (!raf) draw(0);
        };

        // Zielpunkt (Feld oder Scan-Kern) in Canvas-Koordinaten
        const targetPoint = () => {
            const cr = canvas.getBoundingClientRect();
            const el = panel.dataset.stage === 'scan' ? $('#vis-scan-ring') : input;
            if (!el || !el.offsetParent) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
        };

        const pos = (n) => ({
            x: n.x * W + par.x * (n.z - 0.5) * 36,
            y: n.y * H + par.y * (n.z - 0.5) * 28
        });

        function draw(dt) {
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.clearRect(0, 0, W, H);
            const pts = nodes.map(pos);
            const maxD = W * LINK;

            // Netz zwischen benachbarten Knoten
            ctx.lineWidth = 1;
            for (let i = 0; i < N; i++) {
                for (let j = i + 1; j < N; j++) {
                    const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
                    const d = Math.hypot(dx, dy);
                    if (d > maxD) continue;
                    const depth = (nodes[i].z + nodes[j].z) / 2;
                    const a = (1 - d / maxD) * (0.12 + depth * 0.22) * (1 + scanAmt * 0.6);
                    ctx.strokeStyle = 'rgba(200,138,88,' + a.toFixed(3) + ')';
                    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
                }
            }

            // Ausrichtung auf Feld oder Scan-Kern
            const pull = Math.max(focus, scanAmt);
            const tp = pull > 0.01 ? targetPoint() : null;
            if (tp) {
                nodes.forEach((n, i) => {
                    if (!n.hub && i % 3) return;
                    const p = pts[i];
                    const g = ctx.createLinearGradient(p.x, p.y, tp.x, tp.y);
                    const a = pull * (0.18 + n.z * 0.3);
                    g.addColorStop(0, 'rgba(229,169,118,' + a.toFixed(3) + ')');
                    g.addColorStop(1, 'rgba(255,227,200,0)');
                    ctx.strokeStyle = g;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
                });
            }

            // Datenimpulse auf den Bahnen
            pulses.forEach((p) => {
                const a = pts[p.a], b = pts[p.b];
                const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
                const r = 9 + scanAmt * 5;
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                const al = Math.sin(Math.PI * p.t) * (0.55 + scanAmt * 0.3);
                g.addColorStop(0, 'rgba(255,227,200,' + al.toFixed(3) + ')');
                g.addColorStop(0.4, 'rgba(229,169,118,' + (al * 0.4).toFixed(3) + ')');
                g.addColorStop(1, 'rgba(229,169,118,0)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
            });

            // Knoten: hinten klein und blass, vorn hell mit Lichthof
            nodes.forEach((n, i) => {
                const p = pts[i];
                const beat = 0.5 + 0.5 * Math.sin(n.phase);
                const size = (n.hub ? 2.4 : 1.4) + n.z * 1.4;
                const a = 0.3 + n.z * 0.5 + beat * 0.2;
                if (n.hub || n.z > 0.7) {
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 6);
                    g.addColorStop(0, 'rgba(229,169,118,' + (a * 0.35).toFixed(3) + ')');
                    g.addColorStop(1, 'rgba(229,169,118,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(p.x, p.y, size * 6, 0, Math.PI * 2); ctx.fill();
                }
                ctx.fillStyle = 'rgba(255,227,200,' + Math.min(1, a).toFixed(3) + ')';
                ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
            });
        }

        function step(now) {
            const dt = Math.min(0.05, (now - (last || now)) / 1000);
            last = now;
            const speed = 1 + scanAmt * 1.8;
            nodes.forEach((n) => {
                n.x += n.vx * dt * speed; n.y += n.vy * dt * speed;
                if (n.x < 0.02 || n.x > 0.98) n.vx *= -1;
                if (n.y < 0.02 || n.y > 0.98) n.vy *= -1;
                n.phase += dt * (1.2 + scanAmt * 2);
            });
            pulses.forEach((p) => { p.t += dt * p.speed * speed; if (p.t >= 1) pickLink(p); });
            focus += (focusT - focus) * 0.08;
            scanAmt += ((panel.dataset.stage === 'scan' ? 1 : 0) - scanAmt) * 0.05;
            par.x += (par.tx - par.x) * 0.06; par.y += (par.ty - par.y) * 0.06;
            panel.style.setProperty('--focus', Math.max(focus, scanAmt * 0.8).toFixed(3));
            draw(dt);
            raf = visible && !document.hidden ? requestAnimationFrame(step) : 0;
        }
        const start = () => { if (!raf && !reducedMotion) { last = 0; raf = requestAnimationFrame(step); } };

        if (input) {
            input.addEventListener('focus', () => { focusT = 1; if (reducedMotion) { focus = 1; draw(0); } });
            input.addEventListener('blur', () => { focusT = 0; if (reducedMotion) { focus = 0; draw(0); } });
            input.addEventListener('input', () => { focus = Math.min(1.4, focus + 0.12); });
        }
        if (finePointer) {
            const hero = canvas.closest('.hero') || document;
            hero.addEventListener('pointermove', (ev) => {
                par.tx = (ev.clientX / window.innerWidth - 0.5) * 2;
                par.ty = (ev.clientY / window.innerHeight - 0.5) * 2;
            });
        }
        if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
        else window.addEventListener('resize', resize);
        resize();
        if ('IntersectionObserver' in window) {
            new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) start(); }).observe(canvas);
        }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
        if (reducedMotion) draw(0); else start();
    }

    /* ======================================================================
       INIT
       ====================================================================== */
    // Jedes Modul für sich: ein Fehler in einem hält die anderen nicht an
    [initReveal, initNav, initVisibility, initServiceProgress, initGoogleLinks, initPlanner, initCalculator, initPipeline, initTilt, initHero3D, initVisNetwork]
        .forEach((init) => {
            try { init(); } catch (err) { console.error(init.name + ' fehlgeschlagen:', err); }
        });
})();
