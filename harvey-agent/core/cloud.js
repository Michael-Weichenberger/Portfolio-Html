/* =============================================================================
   KASI · Zugriff auf die Cloudflare-Datenbank (D1 „harvey-leads“)
   Über die Wrangler-Anmeldung dieses Rechners (npx wrangler login), keine
   zusätzlichen Schlüssel. Lesend für Nachfass, Termine, Alarm und ROI;
   schreibend nur für den Verlauf (activities) und die Wiedervorlage.
   ============================================================================= */
'use strict';

const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB = 'harvey-leads';
const BIN = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function query(sql, params) {
    // Parameter werden als SQL-Literale eingesetzt (Wrangler kennt keine Bindings auf der Kommandozeile)
    const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
    let i = 0;
    const text = sql.replace(/\?/g, () => lit((params || [])[i++]));
    return new Promise((resolve, reject) => {
        // HARVEY_D1_LOCAL=1: lokale Test-Datenbank von „wrangler dev“ (cloudflare/.wrangler) statt der echten
        const local = process.env.HARVEY_D1_LOCAL === '1';
        execFile(process.execPath, [BIN, 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', text], { cwd: local ? path.join(ROOT, 'cloudflare') : ROOT, timeout: 120000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            let out = null;
            try { out = JSON.parse(stdout); } catch (e) { /* unten behandelt */ }
            if (out && out.error) return reject(new Error(out.error.code === 7403 || /auth/i.test(out.error.text)
                ? 'Cloudflare-Zugriff verweigert. Im Ordner harvey-agent „npx wrangler login“ ausführen.' : out.error.text));
            if (err && !out) return reject(new Error('Cloudflare nicht erreichbar: ' + String(stderr || err.message).split('\n')[0].slice(0, 160)));
            resolve(((Array.isArray(out) ? out[0] : out) || {}).results || []);
        });
    });
}

async function log(leadId, type, text) {
    return query('INSERT INTO activities (lead_id, at, type, text) VALUES (?, ?, ?, ?)', [leadId, new Date().toISOString(), type, String(text).slice(0, 500)]);
}

module.exports = { query, log };
