/* ==========================================================================
   MW IT-SERVICES – script.js (Production Ready v2)
   ========================================================================== */

const EMAILJS_SERVICE_ID  = 'service_0dbskyt';
const EMAILJS_TEMPLATE_ID = 'template_fw5wf4x';

const CONTACT_EMAIL = 'info@mw-itservices.de';
const AUTOMATION_BASE_PRICE = 1190;

let lastFocusedElement = null;
const modalFocusHandlers = new WeakMap();
function trapFocus(modalEl) {
    removeFocusTrap(modalEl);
    const handler = (event) => {
        if (event.key !== 'Tab') return;
        const focusable = [...modalEl.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.getAttribute('tabindex') !== '-1');
        if (!focusable.length) { event.preventDefault(); modalEl.focus(); return; }
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    modalEl.addEventListener('keydown', handler);
    modalFocusHandlers.set(modalEl, handler);
}
function removeFocusTrap(modalEl) {
    const handler = modalFocusHandlers.get(modalEl);
    if (handler) modalEl.removeEventListener('keydown', handler);
    modalFocusHandlers.delete(modalEl);
}

/* ==========================================================================
   1. ROI-RECHNER
   ========================================================================== */
function formatAmortization(savedMoneyMonth) {
    if (savedMoneyMonth <= 0) return '–';
    const weeks = (AUTOMATION_BASE_PRICE / savedMoneyMonth) * 4.33;
    if (weeks < 1) return '< 1 Woche';
    if (weeks <= 8) {
        const w = Math.round(weeks);
        return '~ ' + w + (w === 1 ? ' Woche' : ' Wochen');
    }
    const months = Math.round(weeks / 4.33);
    return '~ ' + months + (months === 1 ? ' Monat' : ' Monate');
}

function updateCalculator() {
    const hoursEl = document.getElementById('calc-hours');
    const rateEl = document.getElementById('calc-rate');
    if (!hoursEl || !rateEl) return;

    const hours = parseInt(hoursEl.value, 10);
    const rate = parseInt(rateEl.value, 10);

    document.getElementById('hours-val').textContent = hours + ' Std. / Woche';
    document.getElementById('rate-val').textContent = rate + ' € / Stunde';
    const savedHoursMonth = Math.round(hours * 4.33 * 0.6);
    const savedMoneyMonth = Math.round(savedHoursMonth * rate);

    document.getElementById('res-hours').innerText = savedHoursMonth + ' Std.';
    document.getElementById('res-money').innerText = savedMoneyMonth.toLocaleString('de-DE') + ' €';
    document.getElementById('res-amort').innerText = formatAmortization(savedMoneyMonth);
}

/* ==========================================================================
   2. BUCHUNGS-MODAL & RECHTLICHES MODAL
   ========================================================================== */
let bookingResetTimer = null;

function openBooking(packageName) {
    const modal = document.getElementById('booking-modal');
    const input = document.getElementById('pkg-input');
    if (!modal) return;

    if (bookingResetTimer) {
        clearTimeout(bookingResetTimer);
        bookingResetTimer = null;
    }

    lastFocusedElement = document.activeElement;
    if (input) input.value = packageName;
    closeMobileMenu();

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    syncBodyScrollLock();
    trapFocus(modal);

    const nameField = document.getElementById('client-name');
    if (nameField) setTimeout(function () { nameField.focus(); }, 120);
}

function closeBooking() {
    const modal = document.getElementById('booking-modal');
    if (!modal || !modal.classList.contains('open') || sending) return;

    removeFocusTrap(modal);
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    syncBodyScrollLock();

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }

    bookingResetTimer = setTimeout(function () {
        const form = document.getElementById('booking-form');
        const success = document.getElementById('booking-success');
        const btn = document.getElementById('submit-btn');
        const btnText = document.getElementById('submit-btn-text');
        if (form) {
            form.style.display = 'block';
            form.reset();
        }
        if (success) success.style.display = 'none';
        const header = document.getElementById('modal-header-area');
        if (header) header.hidden = false;
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = 'Jetzt unverbindlich anfragen';
        bookingResetTimer = null;
    }, 350);
}

/* ==========================================================================
   3. FORMULAR-VERSAND (EmailJS + SessionStorage Bot-Sperre)
   ========================================================================== */
let sending = false;
let lastSentAt = 0;
const EMAILJS_PUBLIC_KEY = 'yp4kKratoM3VsQhBg';
let emailJsPromise;
function loadEmailJS() {
    if (window.emailjs) return Promise.resolve(window.emailjs);
    if (!emailJsPromise) emailJsPromise = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        tag.async = true;
        tag.onload = () => window.emailjs ? resolve(window.emailjs) : reject(new Error('SDK nicht verfügbar'));
        tag.onerror = () => reject(new Error('SDK konnte nicht geladen werden'));
        document.head.appendChild(tag);
    }).catch(error => { emailJsPromise = undefined; throw error; });
    return emailJsPromise;
}
async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (sending || !form.reportValidity()) return;
    if (document.getElementById('hp-website')?.value.trim()) return;
    if (Date.now() - lastSentAt < 30000) { alert('Bitte warten Sie vor einer weiteren Anfrage kurz.'); return; }
    const button = document.getElementById('submit-btn');
    const label = document.getElementById('submit-btn-text');
    const params = {
        package: document.getElementById('pkg-input').value.trim().slice(0,120),
        client_name: document.getElementById('client-name').value.trim().slice(0,120),
        client_email: document.getElementById('client-email').value.trim().slice(0,120),
        client_phone: document.getElementById('client-phone').value.trim().slice(0,40),
        client_message: document.getElementById('client-msg').value.trim().slice(0,1000) || 'Keine Nachricht hinterlassen.'
    };
    if (!params.client_name || !params.client_email || !params.client_phone) { form.reportValidity(); return; }
    sending = true;
    button.disabled = true;
    label.textContent = 'Wird gesendet …';
    try {
        const sdk = await loadEmailJS();
        await sdk.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params, { publicKey: EMAILJS_PUBLIC_KEY });
        lastSentAt = Date.now();
        document.getElementById('booking-form').style.display = 'none';
        document.getElementById('modal-header-area').hidden = true;
        const success = document.getElementById('booking-success');
        success.style.display = 'block';
        success.focus();
    } catch (error) {
        console.error('Formularversand fehlgeschlagen:', error);
        alert('Der Versand ist fehlgeschlagen. Bitte schreiben Sie direkt an ' + CONTACT_EMAIL + '.');
    } finally {
        sending = false;
        button.disabled = false;
        label.textContent = 'Jetzt unverbindlich anfragen';
    }
}

/* ==========================================================================
   4. RECHTLICHES (Vollständige Datenschutzerklärung)
   ========================================================================== */
function openLegal(type) {
    if (type !== 'impressum' && type !== 'datenschutz') return;
    window.open('/' + type + '.html', '_blank', 'noopener,noreferrer');
}
function closeLegal() { /* Standalone-Rechtstexte statt Modal */ }

window.addEventListener('click', function (event) {
    if (event.target === document.getElementById('booking-modal')) closeBooking();
    if (event.target === document.getElementById('legal-modal')) closeLegal();
});

window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    const legalOpen = document.querySelector('#legal-modal.open');
    const bookingOpen = document.querySelector('#booking-modal.open');
    if (legalOpen) {
        closeLegal();
    } else if (bookingOpen) {
        closeBooking();
    } else {
        closeMobileMenu();
    }
});

/* ==========================================================================
   5. MOBILES MENÜ & TASTATUR-BEDIENUNG
   ========================================================================== */
function setMobileMenu(open) {
    const drawer = document.getElementById('mobile-nav-drawer');
    const toggle = document.getElementById('mobile-menu-toggle');
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    if (toggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    }
}

function toggleMobileMenu() {
    const drawer = document.getElementById('mobile-nav-drawer');
    setMobileMenu(!(drawer && drawer.classList.contains('open')));
}

function closeMobileMenu() {
    setMobileMenu(false);
}

function handleCardKey(event, packageName) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        openBooking(packageName);
    }
}

window.addEventListener('resize', function () {
    if (window.innerWidth > 1024) closeMobileMenu();
});

/* ==========================================================================
   6. PIPELINE (4 Schritte, Autoplay)
   ========================================================================== */
let activePipelineStep = 3;
let pipelineTimer = null;
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderPipelineStep(step) {
    for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById('p-step-' + i);
        if (stepEl) stepEl.classList.toggle('active', i === step);
    }
}

function stopPipelineLoop() {
    if (pipelineTimer) {
        clearInterval(pipelineTimer);
        pipelineTimer = null;
    }
}

function startPipelineLoop() {
    stopPipelineLoop();
    if (prefersReducedMotion || document.hidden) return;
    pipelineTimer = setInterval(function () {
        activePipelineStep = activePipelineStep >= 4 ? 1 : activePipelineStep + 1;
        renderPipelineStep(activePipelineStep);
    }, 2600);
}

function setPipelineStep(step) {
    activePipelineStep = step;
    renderPipelineStep(activePipelineStep);
    startPipelineLoop();
}

document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopPipelineLoop();
    else startPipelineLoop();
});

/* ==========================================================================
   7. 3D-PREISKARTEN
   ========================================================================== */
function initPriceTilt() {
    const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!canHover || prefersReducedMotion) return;

    const MAX_X = 3.2;
    const MAX_Y = 2.4;
    const EASE = 0.14;

    document.querySelectorAll('.matrix-row').forEach(function (row) {
        const glare = document.createElement('span');
        glare.className = 'tilt-glare';
        glare.setAttribute('aria-hidden', 'true');
        row.insertBefore(glare, row.firstChild);

        const cur = { rx: 0, ry: 0, d: 0, gx: 50, gy: 50 };
        const tgt = { rx: 0, ry: 0, d: 0, gx: 50, gy: 50 };
        let raf = 0;

        function apply() {
            row.style.setProperty('--rx', cur.rx.toFixed(3) + 'deg');
            row.style.setProperty('--ry', cur.ry.toFixed(3) + 'deg');
            row.style.setProperty('--d', cur.d.toFixed(3));
            row.style.setProperty('--gx', cur.gx.toFixed(1) + '%');
            row.style.setProperty('--gy', cur.gy.toFixed(1) + '%');
            row.style.setProperty('--sx', (-cur.ry * 7).toFixed(1) + 'px');
            row.style.setProperty('--sy', (12 + cur.rx * 5).toFixed(1) + 'px');
        }

        function step() {
            let moving = false;
            for (const k in cur) {
                const diff = tgt[k] - cur[k];
                if (Math.abs(diff) > 0.002) { cur[k] += diff * EASE; moving = true; }
                else cur[k] = tgt[k];
            }
            apply();
            if (moving) {
                raf = requestAnimationFrame(step);
            } else {
                raf = 0;
                if (tgt.d === 0) {
                    row.classList.remove('tilt-live');
                    row.removeAttribute('style');
                }
            }
        }
        function kick() { if (!raf) raf = requestAnimationFrame(step); }

        row.addEventListener('pointermove', function (e) {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            const r = row.getBoundingClientRect();
            const nx = (e.clientX - r.left) / r.width;
            const ny = (e.clientY - r.top) / r.height;
            row.classList.add('tilt-live');
            tgt.ry = (nx - 0.5) * 2 * MAX_Y;
            tgt.rx = -(ny - 0.5) * 2 * MAX_X;
            tgt.gx = nx * 100;
            tgt.gy = ny * 100;
            tgt.d = 1;
            kick();
        });
        row.addEventListener('pointerleave', function () {
            tgt.rx = 0; tgt.ry = 0; tgt.d = 0; tgt.gx = 50; tgt.gy = 50;
            kick();
        });
    });
}

/* ==========================================================================
   INIT
   ========================================================================== */
window.addEventListener('DOMContentLoaded', function () {
    initPriceTilt();
    updateCalculator();
    renderPipelineStep(activePipelineStep);
    startPipelineLoop();
});