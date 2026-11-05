/* =============================================================================
   KASI · Projekte & Agenten
   Live-Status für die Zentrale:
     - Websites und Dienste (MW IT-Services, PhoenixOne AI, Prüfdienst …): erreichbar? Antwortzeit?
     - Git-Repositories (lokal): Branch, offene Änderungen, letzter Commit,
       dazu öffentliche GitHub-Daten (letzter Push, offene Issues)
     - Docker-Container (falls Docker installiert ist)
     - dieser Rechner: Auslastung, Speicher, Laufzeit
     - Kasis Agenten: wann zuletzt gelaufen

   Einstellungen in data/projects.json (gitignored), wird beim ersten Aufruf
   mit Standardwerten angelegt. Optional GITHUB_TOKEN in .env für mehr Abrufe.
   ============================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const Store = require('./datastore.js');

const ROOT = Store.ROOT;
const CACHE_MS = 5 * 60000;
let cache = null;

const DEFAULTS = {
    sites: [
        { name: 'MW IT-Services', url: 'https://mw-itservices.de' },
        { name: 'PhoenixOne AI', url: 'https://phoenixone.ai' },
        { name: 'Prüfdienst (Cloudflare Worker)', url: 'https://mw-sichtbarkeit.harvey-agent.workers.dev/' },
        { name: 'Web-Dashboard (Cloudflare)', url: 'https://mw-harvey.harvey-agent.workers.dev/' }
    ],
    repos: [{ name: 'Portfolio-Html (Website + Kasi)', path: '..' }],
    docker: true
};

function config() {
    let c = Store.load('projects');
    if (!c || !Array.isArray(c.sites)) { c = DEFAULTS; Store.save('projects', c); }
    return c;
}

function run(cmd, args, cwd) {
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd, timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
}

async function checkSite(s) {
    const t0 = Date.now();
    try {
        const res = await fetch(s.url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'MW-Kasi-Zentrale/1.0' }, signal: AbortSignal.timeout(8000) });
        const ms = Date.now() - t0;
        res.body && res.body.cancel && res.body.cancel().catch(() => {});
        return { name: s.name, url: s.url, ok: res.status < 500, status: res.status, ms, level: res.status >= 500 ? 'bad' : ms > 2500 ? 'warn' : 'good' };
    } catch (err) {
        return { name: s.name, url: s.url, ok: false, status: 0, ms: Date.now() - t0, level: 'bad', error: err.name === 'TimeoutError' ? 'Zeitüberschreitung' : 'nicht erreichbar' };
    }
}

async function checkRepo(r) {
    const dir = path.resolve(ROOT, r.path || '.');
    if (!fs.existsSync(path.join(dir, '.git'))) return { name: r.name, ok: false, error: 'kein Git-Repository' };
    const [branch, status, last, remote, counts] = await Promise.all([
        run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir),
        run('git', ['status', '--porcelain'], dir),
        run('git', ['log', '-1', '--format=%h|%cI|%s'], dir),
        run('git', ['remote', 'get-url', 'origin'], dir),
        run('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], dir)
    ]);
    const [hash, date, subject] = (last || '||').split('|');
    const changes = status ? status.split('\n').filter(Boolean).length : 0;
    const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [0, 0];
    const gh = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote || '');
    const out = { name: r.name, ok: true, branch, changes, ahead, behind, last: { hash, date, subject }, repo: gh ? gh[1] + '/' + gh[2] : null };
    if (gh) {
        try {
            const headers = { 'User-Agent': 'MW-Kasi-Zentrale/1.0', Accept: 'application/vnd.github+json' };
            if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
            const res = await fetch('https://api.github.com/repos/' + out.repo, { headers, signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const j = await res.json();
                out.github = { pushedAt: j.pushed_at, issues: j.open_issues_count, private: j.private, url: j.html_url };
            } else out.github = { error: res.status === 404 ? 'privat oder nicht gefunden (GITHUB_TOKEN in .env)' : 'GitHub ' + res.status };
        } catch (err) { out.github = { error: 'GitHub nicht erreichbar' }; }
    }
    out.level = changes || ahead ? 'warn' : 'good';
    return out;
}

async function checkDocker() {
    const raw = await run('docker', ['ps', '-a', '--format', '{{json .}}'], ROOT);
    if (raw === null) return { available: false, containers: [] };
    const containers = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter(Boolean)
        .map((c) => ({ name: c.Names, image: c.Image, state: c.State, status: c.Status, level: c.State === 'running' ? 'good' : c.State === 'exited' ? 'warn' : 'bad' }));
    return { available: true, containers };
}

function machine() {
    const load = os.loadavg()[0];
    const cpus = os.cpus().length;
    const total = os.totalmem();
    const free = os.freemem();
    return { host: os.hostname(), platform: os.platform(), cpus, load: os.platform() === 'win32' ? null : load, memUsed: total - free, memTotal: total,
        memPct: Math.round(((total - free) / total) * 100), uptimeH: Math.round(os.uptime() / 3600), node: process.version };
}

/* Wann liefen Kasis Agenten zuletzt? (aus out/ und data/) */
function agents() {
    const mtime = (p) => { try { return fs.statSync(path.join(ROOT, p)).mtime.toISOString(); } catch (err) { return null; } };
    const latestIn = (dir) => {
        try {
            const items = fs.readdirSync(path.join(ROOT, dir)).filter((x) => !x.startsWith('.')).map((x) => mtime(path.join(dir, x))).filter(Boolean).sort();
            return items[items.length - 1] || null;
        } catch (err) { return null; }
    };
    const monitor = (() => { try { return Store.load('monitor'); } catch (err) { return {}; } })();
    return [
        { id: 'scout', name: 'Scout', task: 'Betriebe finden und messen', last: mtime('out/scout/latest.json'), run: 'scout' },
        { id: 'pipeline', name: 'Pipeline', task: 'Akquise-Liste analysieren', last: latestIn('out/pipeline'), run: 'pipeline' },
        { id: 'billing', name: 'Billing', task: 'Mahnstufen und offene Posten', last: latestIn('out/billing'), run: 'billing' },
        { id: 'monitor', name: 'Monitor', task: 'Zahlungen und Antworten erkennen', last: monitor.lastRun || monitor.lastMailCheck || null, run: 'monitor' },
        { id: 'outbox', name: 'Freigabe', task: 'Postausgang, nur mit Ihrem Klick', last: null, run: null }
    ];
}

async function status(force) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ...cache.data, machine: machine(), agents: agents() };
    const c = config();
    const [sites, repos, docker] = await Promise.all([
        Promise.all((c.sites || []).slice(0, 12).map(checkSite)),
        Promise.all((c.repos || []).slice(0, 8).map(checkRepo)),
        c.docker === false ? { available: false, disabled: true, containers: [] } : checkDocker()
    ]);
    const data = { checkedAt: new Date().toISOString(), sites, repos, docker };
    cache = { at: Date.now(), data };
    return { ...data, machine: machine(), agents: agents() };
}

module.exports = { status, config, DEFAULTS };
