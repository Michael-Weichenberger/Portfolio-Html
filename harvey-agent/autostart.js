#!/usr/bin/env node
/* =============================================================================
   KASI · Autostart (Windows)

   npm run schedule:install    einrichten
   npm run schedule:remove     wieder entfernen

   Richtet ein:
   1. Aufgabe „Kasi Zentrale“ in der Windows-Aufgabenplanung: startet die
      Zentrale beim Anmelden unsichtbar im Hintergrund (ohne Konsolenfenster)
      und startet sie neu, falls sie abstürzt (bis zu 3-mal, im Minutenabstand).
   2. Verknüpfung „Kasi“ auf dem Desktop: öffnet Kasi als eigenes App-Fenster
      (Microsoft Edge, sonst Standardbrowser). Läuft die Zentrale gerade nicht,
      startet die Verknüpfung sie vorher.
   Die Startdateien liegen in data/launcher/ (enthalten nur Pfade dieses Rechners).
   Ausgaben der Zentrale: data/zentrale.log
   ============================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const TASK = 'Kasi Zentrale';
const PORT = Number(process.env.HARVEY_DASHBOARD_PORT) || 5590;
const URL = 'http://127.0.0.1:' + PORT + '/';
const DIR = path.join(ROOT, 'data', 'launcher');
const START = path.join(DIR, 'kasi-hintergrund.vbs');
const OPEN = path.join(DIR, 'kasi-oeffnen.vbs');
const LOG = path.join(ROOT, 'data', 'zentrale.log');
const ICON = path.join(ROOT, '..', 'assets', 'favicon_io', 'favicon.ico');
const DESKTOP = path.join(os.homedir(), 'Desktop', 'Kasi.lnk');

const vbsStr = (s) => '"' + String(s).replace(/"/g, '""') + '"';

function edgePath() {
    return ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p)) || '';
}

/* Startet node unsichtbar; Ausgabe ins Log. Läuft die Zentrale schon, beendet sich der zweite Start von selbst. */
function startScript() {
    const cmd = 'cmd /c ""' + process.execPath + '" "' + path.join(ROOT, 'dashboard', 'server.js') + '" >> "' + LOG + '" 2>&1"';
    return [
        "' Kasi: Zentrale unsichtbar starten (von autostart.js erzeugt)",
        'Set sh = CreateObject("WScript.Shell")',
        'sh.CurrentDirectory = ' + vbsStr(ROOT),
        // warten, solange die Zentrale läuft: so bleibt die Aufgabe aktiv und Windows startet sie nach einem Absturz neu
        'rc = sh.Run(' + vbsStr(cmd) + ', 0, True)',
        'WScript.Quit rc'
    ].join('\r\n') + '\r\n';
}

/* Öffnet Kasi; startet die Zentrale vorher, falls sie nicht antwortet */
function openScript() {
    const edge = edgePath();
    return [
        "' Kasi öffnen (von autostart.js erzeugt)",
        'Function Running()',
        '  On Error Resume Next',
        '  Dim x : Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")',
        '  x.setTimeouts 1000, 1000, 1000, 1000',
        '  x.open "GET", ' + vbsStr(URL + 'api/run-live') + ', False',
        '  x.setRequestHeader "X-Harvey", "1"',
        '  x.send',
        '  Running = (Err.Number = 0 And x.status = 200)',
        'End Function',
        'Set sh = CreateObject("WScript.Shell")',
        'If Not Running() Then',
        '  sh.Run "wscript.exe " & ' + vbsStr('"' + START + '"') + ', 0, False',
        '  For i = 1 To 20',
        '    WScript.Sleep 500',
        '    If Running() Then Exit For',
        '  Next',
        'End If',
        edge ? 'sh.Run ' + vbsStr('"' + edge + '" --app=' + URL) + ', 1, False' : 'sh.Run ' + vbsStr(URL) + ', 1, False'
    ].join('\r\n') + '\r\n';
}

function ps(script, env) {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'inherit', env: { ...process.env, ...env } });
}

function install() {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(START, startScript());
    fs.writeFileSync(OPEN, openScript());
    // Werte über Umgebungsvariablen, nichts wird in den Befehl eingesetzt
    ps([
        'foreach ($n in @("Kasi Morgenlauf", $env:K_TASK)) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false } }',
        '$a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument (\'"\' + $env:K_START + \'"\') -WorkingDirectory $env:K_ROOT',
        '$t = New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + "\\" + $env:USERNAME)',
        '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)',
        'Register-ScheduledTask -TaskName $env:K_TASK -Action $a -Trigger $t -Settings $s -Description "MW IT-SERVICES: startet die Kasi-Zentrale unsichtbar beim Anmelden (nur 127.0.0.1). Sendet nichts." -Force | Out-Null',
        // Desktop-Verknüpfung
        '$w = New-Object -ComObject WScript.Shell',
        '$l = $w.CreateShortcut($env:K_LNK)',
        '$l.TargetPath = "wscript.exe"',
        '$l.Arguments = \'"\' + $env:K_OPEN + \'"\'',
        '$l.WorkingDirectory = $env:K_ROOT',
        '$l.Description = "Kasi Zentrale öffnen"',
        'if (Test-Path $env:K_ICON) { $l.IconLocation = $env:K_ICON }',
        '$l.Save()'
    ].join('; '), { K_TASK: TASK, K_START: START, K_OPEN: OPEN, K_ROOT: ROOT, K_LNK: DESKTOP, K_ICON: ICON });
    console.log('✓ Aufgabe „' + TASK + '“: Kasi startet ab jetzt beim Anmelden unsichtbar im Hintergrund.');
    console.log('✓ Desktop-Verknüpfung „Kasi“: öffnet Kasi als App-Fenster' + (edgePath() ? ' (Edge)' : '') + '.');
    console.log('  Ausgaben: data/zentrale.log · entfernen: npm run schedule:remove');
}

function remove() {
    ps('foreach ($n in @("Kasi Morgenlauf", $env:K_TASK)) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false } }; if (Test-Path $env:K_LNK) { Remove-Item $env:K_LNK }',
        { K_TASK: TASK, K_LNK: DESKTOP });
    [START, OPEN].forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    console.log('✓ Autostart und Desktop-Verknüpfung entfernt. Starten wieder mit: npm run kasi');
}

if (require.main === module) {
    if (process.platform !== 'win32') { console.log('Der Autostart ist für Windows gebaut. Sonst: node dashboard/server.js beim Anmelden starten.'); process.exit(0); }
    try { process.argv.includes('--remove') ? remove() : install(); } catch (err) { console.error('✗ ' + err.message); process.exit(1); }
}
module.exports = { install, remove };
