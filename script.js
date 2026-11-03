/* ==========================================================================
   MW IT-SERVICES · script.js
   Module: Navigation · Reveal · Planer · Anfrage-Dialog · Rechner · Pipeline · Tilt
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
    const VAT = 0.19;
    const gross = (n) => Math.round(n * (1 + VAT));

    /* ======================================================================
       1. NAVIGATION
       ====================================================================== */
    function initNav() {
        const nav = $('#site-nav');
        const toggle = $('#menu-toggle');
        const drawer = $('#mobile-nav');

        const hero = $('.hero');
        // Über dem dunklen Hero bleibt die Navigation dunkles Glas
        const onScroll = () => {
            const overHero = hero && window.scrollY < hero.offsetHeight - nav.offsetHeight;
            nav.classList.toggle('on-dark', !!overHero);
            nav.classList.toggle('is-scrolled', !overHero && window.scrollY > 8);
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
    function initReveal() {
        const items = $$('.reveal');
        if (reducedMotion || !('IntersectionObserver' in window)) {
            items.forEach((el) => el.classList.add('in-view'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('in-view');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        items.forEach((el) => io.observe(el));
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

        // Versand direkt an die EmailJS-REST-Schnittstelle: kein Fremd-Skript, kein CDN
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
       5. ERSPARNIS-RECHNER
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
        let active = 0;
        let timer = null;

        const render = () => steps.forEach((s, i) => s.classList.toggle('is-active', i === active));
        const stop = () => { clearInterval(timer); timer = null; };
        const start = () => {
            stop();
            if (reducedMotion || document.hidden) return;
            timer = setInterval(() => { active = (active + 1) % steps.length; render(); }, 2800);
        };

        steps.forEach((s, i) => s.addEventListener('mouseenter', () => { active = i; render(); start(); }));
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
        const hero = $('.hero');

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
        let build = reducedMotion ? 1 : 0;
        let last = performance.now();
        let raf = 0;
        let visible = true;

        function resize() {
            const r = canvas.getBoundingClientRect();
            DPR = Math.min(window.devicePixelRatio || 1, 2);
            W = Math.max(1, Math.round(r.width * DPR));
            H = Math.max(1, Math.round(r.height * DPR));
            canvas.width = W; canvas.height = H;
            scale = Math.min(W, H) * 0.3;
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
                ctx.fillStyle = rgba([44, 24, 16], 1);
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

        function step(now) {
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

        if (finePointer && hero) {
            hero.addEventListener('pointermove', (ev) => {
                const r = hero.getBoundingClientRect();
                look.tx = ((ev.clientX - r.left) / r.width - 0.5) * 0.7;
                look.ty = ((ev.clientY - r.top) / r.height - 0.5) * 0.3;
            });
            hero.addEventListener('pointerleave', () => { look.tx = 0; look.ty = 0; });
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
       INIT
       ====================================================================== */
    initNav();
    initReveal();
    initPlanner();
    initCalculator();
    initPipeline();
    initTilt();
    initHero3D();
})();
