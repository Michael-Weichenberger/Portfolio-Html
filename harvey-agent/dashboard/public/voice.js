/* =============================================================================
   KASI ZENTRALE · Stimme
   Morgen-Briefing (speechSynthesis) und Sprachbefehle (SpeechRecognition),
   beides aus dem Browser, ohne Schlüssel.

   - Das Briefing startet beim Öffnen einmal pro Tag (abschaltbar). Blockiert
     der Browser Ton ohne vorherigen Klick, startet es beim ersten Klick.
   - Sprachbefehle schalten Ansichten um, lesen den Status vor oder starten
     Prüfläufe. Senden per Sprache gibt es bewusst nicht (Vier-Augen-Prinzip).
   - Hinweis: Chrome und Edge werten die Spracheingabe auf Servern des
     Browser-Herstellers aus. Die Sprachausgabe läuft lokal.
   ============================================================================= */
(function () {
    'use strict';

    const $ = (s) => document.querySelector(s);
    const orb = () => window.HarveyOrb || { mode() {}, level() {}, pulse() {} };
    const H = () => window.Harvey;
    const synth = window.speechSynthesis || null;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    const KEY_DAY = 'harvey.briefing.day';
    const KEY_AUTO = 'harvey.briefing.auto';

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* privat */ } }
    };

    const stateEl = $('#orb-state');
    const captionEl = $('#caption');
    const micBtn = $('#mic');
    const micTop = $('#mic-top');
    const briefBtn = $('#brief-btn');

    function setState(text, mode) {
        if (stateEl) stateEl.textContent = text;
        orb().mode(mode || 'idle');
        document.body.dataset.voice = mode || 'idle';
    }
    function caption(text) { if (captionEl) captionEl.textContent = text || ''; }

    /* ---------- Zahlen und Zeiten für die Sprachausgabe ---------- */
    const n0 = (n) => Math.round(n || 0).toLocaleString('de-DE');
    const euroSay = (n) => n0(n) + ' Euro';
    const plural = (n, one, many) => (n === 1 ? 'eine ' + one : n0(n) + ' ' + many);
    function timeSay(iso) {
        const d = new Date(iso);
        const m = d.getMinutes();
        return d.getHours() + ' Uhr' + (m ? ' ' + m : '');
    }
    const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); };
    function greeting(now) {
        const h = (now || new Date()).getHours();
        return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    }

    /* ---------- Texte ---------- */
    function agendaText(agenda, short) {
        if (!agenda) return 'Die Kalender sind noch nicht geladen.';
        const now = Date.now();
        const today = dayKey(now);
        const ev = agenda.events.filter((e) => e.kind !== 'harvey' || /^Termin/.test(e.title));
        const todays = ev.filter((e) => dayKey(e.start) === today && (e.allDay || Date.parse(e.end) > now));
        if (todays.length) {
            const list = todays.slice(0, short ? 2 : 4).map((e) => (e.allDay ? 'ganztägig ' : 'um ' + timeSay(e.start) + ' ') + e.title).join(', ');
            return 'Heute ' + (todays.length === 1 ? 'steht ein Termin' : 'stehen ' + n0(todays.length) + ' Termine') + ' an: ' + list + (todays.length > 4 && !short ? ', und weitere.' : '.');
        }
        const next = ev.find((e) => Date.parse(e.start) > now);
        const earlier = ev.some((e) => dayKey(e.start) === today);
        if (!agenda.sources.length && !ev.length) return 'Es ist noch kein Kalender angebunden.';
        if (!next) return (earlier ? 'Heute stehen keine weiteren Termine an, ' : 'Heute ') + 'und in den nächsten zwei Wochen ist nichts eingetragen.';
        const d = new Date(next.start);
        return (earlier ? 'Heute stehen keine weiteren Termine an.' : 'Heute sind keine Termine eingetragen.') + ' Der nächste ist am ' + d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (next.allDay ? '' : ' um ' + timeSay(next.start)) + ': ' + next.title + '.';
    }

    function scoutText(data) {
        const s = data.scout;
        if (!s) return 'Der Scout ist noch nicht gelaufen.';
        const known = new Set(data.leads.map((l) => l.domain));
        const fresh = s.suggestions.filter((x) => !known.has(x.domain));
        if (!fresh.length) return 'Aus dem letzten Scout-Lauf sind alle Vorschläge bearbeitet.';
        const top = fresh[0];
        return 'Der Scout hat ' + plural(fresh.length, 'neuen Betrieb', 'neue Betriebe') + ' mit Bedarf gefunden, vorne liegt ' + top.name + '. Pipeline-Wert rund ' + euroSay(fresh.length * data.company.basePrice) + '.';
    }

    function financeText(data) {
        const open = data.invoices.filter((i) => i.status === 'gestellt');
        if (!open.length) return 'Es sind keine Rechnungen offen.';
        const sum = open.reduce((a, i) => a + i.open, 0);
        const overdue = open.filter((i) => i.overdueDays > 0).length;
        let t = (open.length === 1 ? 'Eine Rechnung ist offen' : n0(open.length) + ' Rechnungen sind offen') + ', zusammen ' + euroSay(sum);
        t += overdue ? ', davon ' + (overdue === 1 ? 'eine' : n0(overdue)) + ' überfällig.' : ', nichts davon überfällig.';
        if (data.kpis.proposals) t += ' ' + (data.kpis.proposals === 1 ? 'Ein Mahnvorschlag wartet' : n0(data.kpis.proposals) + ' Mahnvorschläge warten') + ' im Postausgang.';
        return t;
    }

    function outboxText(data) {
        const n = data.kpis.outbox;
        return n ? 'Im Postausgang ' + (n === 1 ? 'wartet eine Mail' : 'warten ' + n0(n) + ' Mails') + ' auf Freigabe.' : 'Der Postausgang ist leer.';
    }

    /* Vorbereitete Termine, heiße Leads, Warnungen des Website-Wächters */
    function agentsText(data) {
        const ag = data.agents;
        if (!ag) return '';
        const out = [];
        const preps = ag.preps.filter((p) => Date.parse(p.at) > Date.now() && Date.parse(p.at) < Date.now() + 24 * 3600000);
        preps.slice(0, 2).forEach((p) => out.push('Um ' + timeSay(p.at) + ' ' + p.name + ', Hauptpunkt: ' + p.headline + '.'));
        const hot = ag.hot.filter((l) => Date.now() - Date.parse(l.at) < 2 * 86400000);
        if (hot.length) out.push(hot.length === 1 ? 'Ein heißer Lead: ' + hot[0].name + '.' : n0(hot.length) + ' heiße Leads, zuerst ' + hot[0].name + '.');
        const watch = ag.list.find((a) => a.id === 'watch');
        const down = watch ? watch.notes.filter((n) => /nicht erreichbar|SSL/.test(n)) : [];
        if (down.length) out.push('Achtung, Website-Wächter: ' + down[0] + '.');
        const tickets = (data.tickets || []).filter((t) => t.status !== 'erledigt');
        const urgent = tickets.filter((t) => t.priority === 'hoch');
        if (urgent.length) out.push((urgent.length === 1 ? 'Ein dringendes Support-Ticket: ' : n0(urgent.length) + ' dringende Support-Tickets, zuerst ') + urgent[0].client + '.');
        else if (tickets.length) out.push(n0(tickets.length) + (tickets.length === 1 ? ' offenes Support-Ticket.' : ' offene Support-Tickets.'));
        const onb = ag.list.find((a) => a.id === 'onboarding');
        if (onb && onb.lastRun && Date.now() - Date.parse(onb.lastRun) < 86400000 && /vorbereitet/.test(onb.summary)) out.push('Onboarding: ' + onb.summary + ', die Willkommensmail wartet auf Ihre Freigabe.');
        const content = ag.list.find((a) => a.id === 'content');
        if (content && content.lastRun && Date.now() - Date.parse(content.lastRun) < 86400000 && content.ok) out.push('Die Beiträge der Woche liegen im Postausgang.');
        return out.join(' ');
    }

    function projectsText() {
        const p = H() && H().projects && H().projects();
        if (!p) return 'Die Projekte werden noch geprüft.';
        const down = p.sites.filter((s) => !s.ok);
        const repo = p.repos.find((r) => r.ok);
        return (down.length ? down.map((s) => s.name).join(' und ') + (down.length === 1 ? ' ist' : ' sind') + ' gerade nicht erreichbar.' : 'Alle ' + n0(p.sites.length) + ' Dienste sind erreichbar.')
            + (repo && repo.changes ? ' Im Repository liegen ' + n0(repo.changes) + ' nicht committete Änderungen.' : '')
            + ' Arbeitsspeicher ' + n0(p.machine.memPct) + ' Prozent.';
    }

    function briefingText() {
        const h = H();
        const data = h && h.data();
        if (!data) return 'Die Daten sind noch nicht geladen.';
        const now = new Date();
        const name = data.company.briefingName;
        const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
        const setup = data.setup.filter((s) => !s.ok).length;
        return [
            greeting(now) + (name ? ', ' + name : '') + '.',
            'Heute ist ' + date + '.',
            agendaText(h.agenda()),
            scoutText(data),
            financeText(data),
            agentsText(data),
            outboxText(data),
            (() => { const p = h.projects && h.projects(); const down = p ? p.sites.filter((s) => !s.ok) : []; return down.length ? 'Achtung: ' + down.map((s) => s.name).join(' und ') + (down.length === 1 ? ' ist' : ' sind') + ' nicht erreichbar.' : ''; })(),
            setup ? (setup === 1 ? 'Ein Punkt' : n0(setup) + ' Punkte') + ' in der Einrichtung ' + (setup === 1 ? 'ist' : 'sind') + ' noch offen.' : ''
        ].filter(Boolean).join(' ');
    }

    function statusText() {
        const data = H() && H().data();
        if (!data) return 'Die Daten sind noch nicht geladen.';
        return [outboxText(data), financeText(data), agendaText(H().agenda(), true)].join(' ');
    }

    /* ---------- Sprachausgabe ---------- */
    let voice = null;
    /* Natürlich klingende Stimmen zuerst: Edge „… Online (Natural)“ (neuronale Microsoft-Stimmen),
       dann Google Deutsch (Chrome), Apple Premium/Enhanced; die alten Windows-Stimmen (Hedda, Stefan,
       Katja ohne „Online“) klingen blechern und kommen zuletzt. */
    const KEY_VOICE = 'harvey.voice';
    const voiceSelect = $('#voice-select');
    let voices = [];
    function rankVoice(v) {
        let r = 0;
        if (/natural|neural/i.test(v.name)) r += 60;
        if (/online/i.test(v.name)) r += 25;
        if (/premium|enhanced|siri/i.test(v.name)) r += 40;
        if (/google/i.test(v.name)) r += 30;
        if (/seraphina|katja|amala|conrad|florian|killian|louisa|anna|petra|markus|yannick/i.test(v.name)) r += 8;
        if (/hedda|stefan/i.test(v.name) || (/microsoft/i.test(v.name) && !/online|natural/i.test(v.name))) r -= 30;
        if (/^de-DE/i.test(v.lang)) r += 5;
        if (!v.localService) r += 3;
        return r;
    }
    function pickVoice() {
        if (!synth) return null;
        voices = synth.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang)).sort((a, b) => rankVoice(b) - rankVoice(a));
        const saved = store.get(KEY_VOICE);
        voice = voices.find((v) => v.voiceURI === saved) || voices[0] || null;
        if (voiceSelect) {
            voiceSelect.replaceChildren(...voices.map((v) => {
                const o = document.createElement('option');
                o.value = v.voiceURI;
                o.textContent = v.name.replace(/^Microsoft /, '').replace(/ - German \(Germany\)| \(Germany\)/, '') + (rankVoice(v) >= 55 ? ' · natürlich' : '');
                o.selected = voice && v.voiceURI === voice.voiceURI;
                return o;
            }));
            voiceSelect.disabled = !voices.length;
            if (!voices.length) { const o = document.createElement('option'); o.textContent = 'keine deutsche Stimme'; voiceSelect.append(o); }
        }
        return voice;
    }
    if (synth) {
        pickVoice();
        if (synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice); else synth.onvoiceschanged = pickVoice;
        setTimeout(pickVoice, 600); // manche Browser liefern die Liste verzögert
    }
    if (voiceSelect) voiceSelect.addEventListener('change', () => {
        store.set(KEY_VOICE, voiceSelect.value);
        voice = voices.find((v) => v.voiceURI === voiceSelect.value) || voice;
        speak('Hallo, so klinge ich jetzt.');
    });

    let speakToken = 0;
    function speak(text) {
        return new Promise((resolve) => {
            caption(text);
            if (!synth) { setState('Sprachausgabe wird von diesem Browser nicht unterstützt', 'idle'); return resolve('unsupported'); }
            synth.cancel();
            const token = ++speakToken;
            // In Sätze teilen: lange Äußerungen bricht Chrome nach ~15 s ab
            const parts = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];
            let i = 0;
            let started = false;
            setState('Spricht …', 'speaking');
            const next = () => {
                if (token !== speakToken) return resolve('cancelled');
                if (i >= parts.length) { setState('Bereit', 'idle'); return resolve('done'); }
                const u = new SpeechSynthesisUtterance(parts[i++].trim());
                u.lang = 'de-DE';
                if (voice) u.voice = voice;
                // natürliche Stimmen im normalen Tempo, ältere etwas langsamer und tiefer wirken weniger mechanisch
                const natural = voice && rankVoice(voice) >= 55;
                u.rate = natural ? 1 : 0.94;
                u.pitch = natural ? 1 : 0.92;
                u.onstart = () => { started = true; orb().pulse(0.5); };
                u.onboundary = () => orb().pulse(0.35);
                u.onend = next;
                u.onerror = (ev) => {
                    if (token !== speakToken) return resolve('cancelled');
                    if (ev.error === 'not-allowed' || (!started && ev.error !== 'interrupted' && ev.error !== 'canceled')) { setState('Ton gesperrt', 'waiting'); return resolve('blocked'); }
                    next();
                };
                synth.speak(u);
            };
            next();
            // Manche Browser melden die Sperre gar nicht: nach 2,5 s ohne Start als gesperrt werten
            setTimeout(() => { if (!started && token === speakToken && i <= 1) { synth.cancel(); speakToken++; setState('Ton gesperrt', 'waiting'); resolve('blocked'); } }, 2500);
        });
    }
    function stopSpeaking() { speakToken++; if (synth) synth.cancel(); setState('Bereit', 'idle'); }

    async function playBriefing(auto) {
        const r = await speak(briefingText());
        if (r === 'blocked' && auto) {
            setState('Briefing bereit · zum Abspielen klicken', 'waiting');
            const once = () => { document.removeEventListener('pointerdown', once, true); document.removeEventListener('keydown', once, true); playBriefing(false); };
            document.addEventListener('pointerdown', once, true);
            document.addEventListener('keydown', once, true);
        }
        if (r === 'done' || r === 'cancelled') store.set(KEY_DAY, dayKey(Date.now()));
        return r;
    }

    /* ---------- Befehle ---------- */
    const HELP = 'Sag zum Beispiel: Status, Briefing, Termine, Finanzen, Leads, Agenten, Fokus, Postausgang, Lead anlegen, Rechnung erstellen, Kontoauszug abgleichen, Mahn-Check oder Stopp.';
    const COMMANDS = [
        [/^(stopp?|halt|ruhe|leise|abbrechen)\b/, () => { stopSpeaking(); caption(''); }],
        [/(hilfe|was kannst du|befehle)/, () => speak(HELP)],
        [/(send|verschick|freigeb|abschick|rausschick)/, () => { H().go('zentrale', 'postausgang'); speak('Senden geht nur per Klick: Mail öffnen, prüfen, Freigeben und Senden, dann bestätigen. So bleibt das Vier-Augen-Prinzip gewahrt.'); }],
        [/(kontoauszug|zahlung|abgleich)/, () => { speak('Ich gleiche Kontoauszüge und Postfach ab.'); H().run('monitor'); }],
        [/(mahn.?check|mahnlauf|mahnungen prüfen)/, () => { speak('Ich starte den Mahn-Check. Vorschläge landen im Postausgang.'); H().run('billing'); }],
        [/(neue betriebe|scout starten|suche starten|betriebe suchen)/, () => { speak('Ich suche neue Betriebe. Das dauert einige Minuten.'); H().run('scout', true); }],
        [/(neue[nr]? lead|lead anlegen|lead hinzu)/, () => { window.HarveyPalette.open('lead'); speak('Domain und Name eintragen, dann anlegen.'); }],
        [/(rechnung (generieren|erstellen|schreiben|anlegen)|neue rechnung)/, () => { window.HarveyPalette.open('invoice'); speak('Für welchen Kunden?'); }],
        [/(befehl|palette|suche)/, () => window.HarveyPalette.open()],
        [/(fokus)/, () => { H().go('zentrale'); H().setMode('fokus'); speak('Fokus. ' + outboxText(H().data())); }],
        [/(agent|projekt|server|docker|github|phoenix)/, () => { H().go('zentrale'); H().setMode('agenten'); speak(projectsText()); }],
        [/(briefing|zusammenfassung|guten morgen)/, () => playBriefing(false)],
        [/(status|lage|wie sieht|überblick)/, () => speak(statusText())],
        [/(termin|kalender|heute an)/, () => { H().go('termine'); speak(agendaText(H().agenda())); }],
        [/(finanz|rechnung|mahn|offene posten|geld)/, () => { H().go('finanzen'); speak(financeText(H().data())); }],
        [/(lead|scout|akquise|betrieb|kunden finden)/, () => { H().go('leads'); speak(scoutText(H().data())); }],
        [/(postausgang|mails?|e-mail|entw[uü]rfe)/, () => { H().go('zentrale', 'postausgang'); speak(outboxText(H().data())); }],
        [/(stammdaten|firmendaten|kunden|einstellung)/, () => { H().go('stammdaten'); speak('Kunden und Stammdaten.'); }],
        [/(zentrale|startseite|dashboard|übersicht|zurück)/, () => { H().go('zentrale'); speak('Zentrale.'); }]
    ];

    function handle(text) {
        const t = String(text || '').toLowerCase().replace(/^(hey |hallo |ok )?harvey[,]?\s*/, '').trim();
        if (!t) return;
        caption('„' + text + '“');
        if (!H() || !H().data()) return speak('Einen Moment, die Daten laden noch.');
        const hit = COMMANDS.find(([re]) => re.test(t));
        if (hit) hit[1](t);
        else speak('Das habe ich nicht verstanden. ' + HELP);
    }

    /* ---------- Spracheingabe ---------- */
    let rec = null;
    let listening = false;
    let meter = null;

    async function startMeter() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(an);
            const buf = new Uint8Array(an.fftSize);
            let raf = 0;
            const tick = () => {
                an.getByteTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
                orb().level(Math.min(1, Math.sqrt(sum / buf.length) * 4));
                raf = requestAnimationFrame(tick);
            };
            tick();
            meter = { stop() { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); orb().level(0); } };
        } catch (err) { meter = null; }
    }
    function stopMeter() { if (meter) meter.stop(); meter = null; }

    function setMic(on) {
        listening = on;
        [micBtn, micTop].forEach((b) => { if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-live', on); } });
        if (micBtn) micBtn.querySelector('span').textContent = on ? 'Hört zu …' : 'Sprechen';
    }

    function listen() {
        if (!Recognition) {
            setState('Spracheingabe: bitte Chrome oder Edge verwenden', 'idle');
            caption('Dieser Browser unterstützt keine Spracheingabe. Befehle lassen sich unten eintippen.');
            const cmd = $('#cmd'); if (cmd) cmd.focus();
            return;
        }
        if (listening) { rec && rec.stop(); return; }
        stopSpeaking();
        rec = new Recognition();
        rec.lang = 'de-DE';
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.continuous = false;
        let final = '';
        rec.onstart = () => { setMic(true); setState('Hört zu …', 'listening'); caption(''); startMeter(); };
        rec.onresult = (ev) => {
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal) final += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
            }
            caption(final || interim);
        };
        rec.onerror = (ev) => {
            const msg = { 'not-allowed': 'Mikrofon nicht freigegeben. In der Adresszeile erlauben.', 'service-not-allowed': 'Spracherkennung in diesem Browser gesperrt.', 'no-speech': 'Nichts gehört.', 'audio-capture': 'Kein Mikrofon gefunden.', network: 'Spracherkennung braucht eine Internetverbindung.' }[ev.error];
            if (msg) caption(msg);
        };
        rec.onend = () => {
            setMic(false);
            stopMeter();
            if (final.trim()) { setState('Verstanden', 'thinking'); handle(final.trim()); } else if (document.body.dataset.voice === 'listening') setState('Bereit', 'idle');
        };
        try { rec.start(); } catch (err) { setMic(false); }
    }

    /* ---------- Bedienelemente ---------- */
    if (micBtn) micBtn.addEventListener('click', listen);
    if (micTop) micTop.addEventListener('click', () => { if (location.hash !== '#zentrale' && location.hash) H().go('zentrale'); listen(); });
    if (!Recognition) [micBtn, micTop].forEach((b) => b && (b.title = 'Spracheingabe nur in Chrome oder Edge'));
    if (briefBtn) briefBtn.addEventListener('click', () => (document.body.dataset.voice === 'speaking' ? stopSpeaking() : playBriefing(false)));
    const hit = $('#orb-hit');
    if (hit) hit.addEventListener('click', () => { orb().pulse(0.8); if (document.body.dataset.voice === 'speaking') stopSpeaking(); else playBriefing(false); });
    const form = $('#cmd-form');
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); const i = $('#cmd'); const v = i.value.trim(); i.value = ''; handle(v); });

    const auto = $('#auto-brief');
    if (auto) {
        auto.checked = store.get(KEY_AUTO) !== '0';
        auto.addEventListener('change', () => store.set(KEY_AUTO, auto.checked ? '1' : '0'));
    }

    // Leertaste hält nicht: einfacher Kurzbefehl Alt+M für das Mikrofon, Esc stoppt
    document.addEventListener('keydown', (ev) => {
        if (ev.altKey && (ev.key === 'm' || ev.key === 'M')) { ev.preventDefault(); listen(); }
        else if (ev.key === 'Escape' && document.body.dataset.voice === 'speaking') stopSpeaking();
    });

    /* Automatisches Briefing, sobald Daten und Kalender geladen sind */
    document.addEventListener('harvey:ready', () => {
        const g = $('#greet');
        if (g) g.textContent = greeting();
        if (store.get(KEY_AUTO) === '0') return;
        if (store.get(KEY_DAY) === dayKey(Date.now())) return;
        playBriefing(true);
    }, { once: true });

    window.HarveyVoice = { speak, stop: stopSpeaking, briefing: playBriefing, handle, briefingText };
}());
