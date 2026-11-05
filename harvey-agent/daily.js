#!/usr/bin/env node
/* =============================================================================
   KASI · Morgenlauf (alle Agenten in sinnvoller Reihenfolge)

   Startet von selbst, wenn Sie die Zentrale zum ersten Mal am Tag öffnen.
   Danach liest Kasi das Briefing mit den frischen Ergebnissen vor.

   npm run daily                   von Hand ausführen
   npm run schedule:install        Zentrale beim Anmelden an Windows im Hintergrund
                                   starten (dann nur noch die Seite öffnen)
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

if (args.includes('--install') || args.includes('--remove')) {
    if (process.platform !== 'win32') {
        console.log('Unter macOS/Linux die Zentrale beim Anmelden starten, z. B. per Autostart: cd ' + ROOT + ' && ' + process.execPath + ' dashboard/server.js');
        process.exit(0);
    }
    // Werte über Umgebungsvariablen, damit nichts in den Befehl eingesetzt werden muss.
    // Entfernt immer auch die frühere 7-Uhr-Aufgabe „Kasi Morgenlauf“.
    const ps = [
        'foreach ($n in @("Kasi Morgenlauf", $env:K_NAME)) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false } }',
        ...(args.includes('--remove') ? [] : [
            '$cmd = "& \'" + $env:K_NODE + "\' \'" + $env:K_FILE + "\'"',
            '$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -Command " + $cmd) -WorkingDirectory $env:K_DIR',
            '$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME',
            '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)',
            'Register-ScheduledTask -TaskName $env:K_NAME -Action $a -Trigger $t -Settings $s -Description "MW IT-SERVICES: startet die Kasi-Zentrale (nur 127.0.0.1:5590) beim Anmelden. Sendet nichts." -Force | Out-Null',
            'Start-ScheduledTask -TaskName $env:K_NAME'
        ])
    ].join('; ');
    try {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
            stdio: 'inherit',
            env: { ...process.env, K_NAME: 'Kasi Zentrale', K_NODE: process.execPath, K_FILE: path.join(ROOT, 'dashboard', 'server.js'), K_DIR: ROOT }
        });
    } catch (err) {
        console.error('✗ Aufgabe konnte nicht ' + (args.includes('--remove') ? 'entfernt' : 'angelegt') + ' werden.');
        process.exit(1);
    }
    console.log(args.includes('--remove') ? '✓ Autostart entfernt. Die Zentrale startet wieder mit npm run dashboard.'
        : '✓ Die Zentrale startet ab jetzt beim Anmelden im Hintergrund. Einfach http://127.0.0.1:5590 öffnen; beim ersten Besuch am Tag läuft der Morgenlauf.');
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
