/* =============================================================================
   KASI · lokale Datenablage (JSON)
   Alle Geschäftsdaten liegen in harvey-agent/data/ (in .gitignore, nie im Repo):
     company.json   eigene Firmendaten, Bankverbindung, Mahn-Einstellungen
     clients.json   Kunden mit Domains und gebuchten Paketen
     leads.json     Akquise-Liste für die Pipeline (Domain-Scan)
     invoices.json  Rechnungen, Zahlungen, versendete Mahnungen
     outbox.json    Postausgang: Entwürfe, Freigaben, versendete Mails
     scout.json     Messcache des Lead-Scouts (Domain → letzte Messung)
     events.json    Ereignisprotokoll (Zahlungen, Antworten, Versand)
     monitor.json   Stand des Monitors (letzte Postfach-Prüfung, importierte Umsätze)
     calendars.json angebundene Kalender (geheime iCal-Adressen von Google, Cal.com …)
     projects.json  überwachte Websites, Repositories, Docker (Zentrale → Agenten)
     google.json    Google-Anmeldung (Unternehmensprofile, Search Console)
     bank.json      Bank-Anbindung (Enable Banking: Sitzung, Konten, letzter Abruf)
     watch.json     Website-Wächter: tägliche Messwerte je Kunden-Domain
     geo.json       KI-Sichtbarkeit: Ergebnisse je Kunde und Suchanfrage
     agents.json    Stand der Agenten (Nachfass, Termine, Posteingang, Alarm …)

   Schreiben ist atomar (temporäre Datei + Umbenennen), vor der ersten Änderung
   des Tages wird eine Sicherung in data/.backup/ abgelegt.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.HARVEY_DATA_DIR || path.join(ROOT, 'data');
const TEMPLATE_DIR = path.join(ROOT, 'data-templates');
const BACKUP_DIR = path.join(DATA_DIR, '.backup');
const FILES = ['company', 'clients', 'leads', 'invoices', 'outbox', 'scout', 'events', 'monitor', 'calendars', 'projects', 'google', 'bank', 'watch', 'geo', 'agents', 'tickets'];
const OBJECT_FILES = ['company', 'scout', 'monitor', 'projects', 'google', 'bank', 'watch', 'geo', 'agents'];

function file(name) {
    if (!FILES.includes(name)) throw new Error('Unbekannte Datei: ' + name);
    return path.join(DATA_DIR, name + '.json');
}

/* Legt fehlende Dateien aus data-templates/ an. Gibt die neu angelegten zurück. */
function ensure() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const created = [];
    for (const name of FILES) {
        const target = file(name);
        if (fs.existsSync(target)) continue;
        const tpl = path.join(TEMPLATE_DIR, name + '.example.json');
        // Firmendaten aus der Vorlage übernehmen, alle anderen Dateien starten leer
        const data = name === 'company' && fs.existsSync(tpl) ? JSON.parse(fs.readFileSync(tpl, 'utf8')) : OBJECT_FILES.includes(name) ? {} : [];
        fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
        created.push(name + '.json');
    }
    return created;
}

function load(name) {
    const f = file(name);
    if (!fs.existsSync(f)) ensure();
    try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (err) {
        throw new Error(path.relative(ROOT, f) + ' ist kein gültiges JSON: ' + err.message);
    }
}

function backup(name) {
    const f = file(name);
    if (!fs.existsSync(f)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, name + '-' + new Date().toISOString().slice(0, 10) + '.json');
    if (!fs.existsSync(target)) fs.copyFileSync(f, target);
}

function save(name, data) {
    backup(name);
    const f = file(name);
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, f);
}

module.exports = { ROOT, DATA_DIR, FILES, ensure, load, save, file };
