#!/usr/bin/env node
/* =============================================================================
   KASI · Morgenlauf (alle Agenten in sinnvoller Reihenfolge)

   Startet von selbst, wenn Sie die Zentrale zum ersten Mal am Tag öffnen.
   Danach liest Kasi das Briefing mit den frischen Ergebnissen vor.

   npm run daily                   von Hand ausführen
   npm run schedule:install        Autostart beim Anmelden + Desktop-Verknüpfung „Kasi“
                                   (siehe autostart.js)
   npm run schedule:remove         wieder entfernen

   Reihenfolge: Zahlungen (Bank/CSV) und Antworten → Posteingang → Mahn-Check
   → Nachfass → Website-Wächter → Termin-Vorbereitung → Heiße Leads
   → Bewertungen → Onboarding → Buchhaltung → Content (montags).
   Am 1. des Monats zusätzlich Betreuungsberichte und KI-Sichtbarkeit,
   am 1. des Quartals ROI-Berichte.
   Ergebnis: nur Entwürfe und Hinweise. Gesendet wird nichts.
   ============================================================================= */
'use strict';

const path = require('path');
const { execFileSync, execFile } = require('child_process');

const ROOT = __dirname;
const args = process.argv.slice(2);

// Autostart steckt jetzt in autostart.js (npm run schedule:install)
if (args.includes('--install') || args.includes('--remove')) {
    require('./autostart.js')[args.includes('--remove') ? 'remove' : 'install']();
    process.exit(0);
}

const Run = require('./core/runlog.js');

function run(file, extra) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        execFile(process.execPath, [path.join(ROOT, file), ...(extra || [])], { cwd: ROOT, timeout: 20 * 60000, windowsHide: true }, (err, stdout, stderr) => {
            const out = (stdout + (stderr ? '\n' + stderr : '')).trim().split('\n').filter(Boolean);
            console.log('    ' + (err ? '✗ ' : '✓ ') + Math.round((Date.now() - t0) / 1000) + ' s' + (out.length ? ' · ' + out[out.length - 1].slice(0, 140) : ''));
            resolve(!err);
        });
    });
}

(async () => {
    console.log('Kasi Morgenlauf ' + new Date().toLocaleString('de-DE'));
    const d = new Date();
    const steps = [
        ['Zahlungen und Antworten', 'monitor-agent.js'],
        ['Posteingang', 'inbox-agent.js'],
        ['Mahn-Check', 'billing-agent.js'],
        ['Nachfass', 'followup-agent.js'],
        ['Website-Wächter', 'watch-agent.js'],
        ['Cal.com-Termine', 'bookings-agent.js'],
        ['Termin-Vorbereitung', 'appointment-agent.js'],
        ['Heiße Leads', 'alert-agent.js'],
        ['Bewertungen', 'reviews-agent.js'],
        ['Onboarding', 'onboarding-agent.js'],
        ['Buchhaltung', 'accounting-agent.js'],
        ['Marketing-Auswertung', 'marketing-agent.js']
    ];
    if (d.getDay() === 1) steps.push(['Beiträge der Woche', 'content-agent.js']);
    if (d.getDate() === 1) {
        steps.push(['Betreuungsberichte', 'watch-agent.js', ['--report']], ['KI-Sichtbarkeit', 'geo-agent.js']);
        if (d.getMonth() % 3 === 0) steps.push(['Quartals-ROI', 'watch-agent.js', ['--quarter']]);
    }
    let failed = 0;
    for (const [i, [label, file, extra]] of steps.entries()) {
        console.log('[' + (i + 1) + '/' + steps.length + '] ' + label + ' …');
        if (!await run(file, extra)) failed++;
    }
    const summary = steps.length + ' Schritte' + (failed ? ', ' + failed + ' mit Fehler' : ', alle ohne Fehler');
    Run.done('daily', { ok: !failed, summary });
    console.log('Fertig: ' + summary + '. Entwürfe im Postausgang prüfen.');
})();
