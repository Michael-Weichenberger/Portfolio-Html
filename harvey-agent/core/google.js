/* =============================================================================
   KASI · Google-Anbindung (Unternehmensprofil, Search Console, Gmail, Kalender, Drive)
   Ein Google-Login (Ihr Konto) reicht: Ihre Kunden geben Ihnen Verwaltungs-
   zugriff auf ihr Unternehmensprofil und ihre Search-Console-Property.

   Einrichtung (einmalig):
   1. console.cloud.google.com → Projekt anlegen → APIs aktivieren:
      „My Business Account Management“, „My Business Business Information“,
      „Business Profile Performance“, „Google Search Console API“,
      „Gmail API“, „Google Calendar API“, „Google Drive API“.
      Für Bewertungen (v4) beim Google-Unternehmensprofil API-Zugang beantragen.
   2. OAuth-Client vom Typ „Desktop-App“ anlegen, in .env eintragen:
        GOOGLE_CLIENT_ID=…apps.googleusercontent.com
        GOOGLE_CLIENT_SECRET=…
   3. Zentrale → Agenten → „Google verbinden“ (Weiterleitung auf 127.0.0.1:5590).
   Tokens liegen in data/google.json (gitignored).
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const Store = require('./datastore.js');

// Gmail nur lesen und senden (kein Löschen), Kalender nur lesen, Drive nur eigene Kasi-Dateien
const SCOPES = ['https://www.googleapis.com/auth/business.manage', 'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/drive.file'];
const SCOPE = { gmailRead: 'gmail.readonly', gmailSend: 'gmail.send', calendar: 'calendar.readonly', drive: 'drive.file', business: 'business.manage', search: 'webmasters.readonly' };
const REDIRECT = () => 'http://127.0.0.1:' + (Number(process.env.HARVEY_DASHBOARD_PORT) || 5590) + '/oauth/google';

function configured() { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
function state() { const s = Store.load('google'); return s && typeof s === 'object' ? s : {}; }
function connected() { return !!state().refresh_token; }
/* Wurde diese Berechtigung beim Verbinden erteilt? (z. B. has('gmailSend')) */
function has(key) { const s = state(); return !!(s.refresh_token && String(s.scope || '').includes(SCOPE[key] || key)); }

function authUrl() {
    if (!configured()) throw new Error('GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in harvey-agent/.env eintragen.');
    const s = state();
    s.pendingState = crypto.randomBytes(16).toString('hex');
    s.pendingAt = Date.now();
    Store.save('google', s);
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT(), response_type: 'code',
        scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: s.pendingState
    });
}

async function exchange(code, st) {
    const s = state();
    if (!s.pendingState || st !== s.pendingState || Date.now() - (s.pendingAt || 0) > 15 * 60000) throw new Error('Anmeldung abgelaufen oder ungültig. Bitte erneut verbinden.');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT(), grant_type: 'authorization_code' })
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Google: ' + (j.error_description || j.error || res.status));
    Store.save('google', { refresh_token: j.refresh_token || s.refresh_token, access_token: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope || SCOPES.join(' '), connectedAt: new Date().toISOString() });
    return true;
}

async function token() {
    const s = state();
    if (!s.refresh_token) throw new Error('Google nicht verbunden (Zentrale → Agenten → „Google verbinden“).');
    if (s.access_token && s.expires > Date.now()) return s.access_token;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: s.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' })
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Google-Anmeldung erneuern: ' + (j.error_description || j.error));
    Store.save('google', { ...s, access_token: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
    return j.access_token;
}

async function api(url, { method = 'GET', body, raw, type } = {}) {
    const headers = { Authorization: 'Bearer ' + (await token()), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': type } : {}) };
    const res = await fetch(url, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google ' + res.status + ': ' + ((j.error && j.error.message) || 'Fehler'));
    return j;
}

/* ---------- Unternehmensprofile ---------- */
async function locations() {
    const acc = await api('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    const out = [];
    for (const a of acc.accounts || []) {
        let pageToken = '';
        do {
            const j = await api('https://mybusinessbusinessinformation.googleapis.com/v1/' + a.name + '/locations?readMask=name,title,websiteUri&pageSize=100' + (pageToken ? '&pageToken=' + pageToken : ''));
            (j.locations || []).forEach((l) => out.push({ account: a.name, location: l.name, title: l.title, website: l.websiteUri || '' }));
            pageToken = j.nextPageToken || '';
        } while (pageToken);
    }
    return out;
}

const v4 = (loc) => 'https://mybusiness.googleapis.com/v4/' + loc.account + '/' + loc.location;
async function reviews(loc) { return (await api(v4(loc) + '/reviews?pageSize=50&orderBy=updateTime%20desc')).reviews || []; }
/* Beitrag im eigenen Unternehmensprofil (Typ „Neuigkeit“) */
async function localPost(loc, summary, url) {
    const body = { languageCode: 'de-DE', topicType: 'STANDARD', summary: String(summary).slice(0, 1500) };
    if (url) body.callToAction = { actionType: 'LEARN_MORE', url };
    return api(v4(loc) + '/localPosts', { method: 'POST', body });
}
/* Eigenes Profil: GOOGLE_OWN_LOCATION in .env (Titel oder locations/…), sonst Website mw-itservices.de */
async function ownLocation() {
    const want = String(process.env.GOOGLE_OWN_LOCATION || '').toLowerCase();
    const list = await locations();
    const hit = list.find((l) => want && (l.location.toLowerCase() === want || l.title.toLowerCase() === want))
        || list.find((l) => /mw-itservices\.de/i.test(l.website));
    if (!hit) throw new Error('Eigenes Unternehmensprofil nicht gefunden (GOOGLE_OWN_LOCATION in .env setzen).');
    return hit;
}
async function reply(reviewName, comment) { return api('https://mybusiness.googleapis.com/v4/' + reviewName + '/reply', { method: 'PUT', body: { comment } }); }

/* Anrufe, Website-Klicks, Routenanfragen je Tag */
async function performance(loc, from, to) {
    const d = (s) => { const [y, m, day] = s.split('-').map(Number); return { y, m, day }; };
    const a = d(from); const b = d(to);
    const q = ['CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
        'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_CONVERSATIONS'].map((m) => 'dailyMetrics=' + m).join('&')
        + `&dailyRange.start_date.year=${a.y}&dailyRange.start_date.month=${a.m}&dailyRange.start_date.day=${a.day}`
        + `&dailyRange.end_date.year=${b.y}&dailyRange.end_date.month=${b.m}&dailyRange.end_date.day=${b.day}`;
    const j = await api('https://businessprofileperformance.googleapis.com/v1/' + loc.location + ':fetchMultiDailyMetricsTimeSeries?' + q);
    const sum = {};
    for (const s of j.multiDailyMetricTimeSeries || []) for (const t of s.dailyMetricTimeSeries || []) {
        sum[t.dailyMetric] = (t.timeSeries && t.timeSeries.datedValues || []).reduce((n, v) => n + Number(v.value || 0), 0);
    }
    return { calls: sum.CALL_CLICKS || 0, websiteClicks: sum.WEBSITE_CLICKS || 0, directions: sum.BUSINESS_DIRECTION_REQUESTS || 0, messages: sum.BUSINESS_CONVERSATIONS || 0,
        viewsSearch: (sum.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (sum.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0),
        viewsMaps: (sum.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (sum.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0) };
}

/* Suchbegriffe, mit denen das Profil gefunden wurde (Monate JJJJ-MM) */
async function searchKeywords(loc, fromMonth, toMonth) {
    const [ay, am] = fromMonth.split('-').map(Number); const [by, bm] = toMonth.split('-').map(Number);
    const j = await api('https://businessprofileperformance.googleapis.com/v1/' + loc.location + '/searchkeywords/impressions/monthly?monthlyRange.start_month.year=' + ay + '&monthlyRange.start_month.month=' + am + '&monthlyRange.end_month.year=' + by + '&monthlyRange.end_month.month=' + bm);
    return (j.searchKeywordsCounts || []).map((k) => ({ keyword: k.searchKeyword, value: Number((k.insightsValue || {}).value || 0), threshold: (k.insightsValue || {}).threshold ? Number(k.insightsValue.threshold) : null }))
        .sort((a, b) => b.value - a.value).slice(0, 25);
}

/* ---------- Search Console ---------- */
async function searchSites() { return ((await api('https://www.googleapis.com/webmasters/v3/sites')).siteEntry || []).map((s) => s.siteUrl); }
async function searchTotals(siteUrl, from, to) {
    const j = await api('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', { method: 'POST', body: { startDate: from, endDate: to, dimensions: [] } });
    const r = (j.rows || [])[0] || {};
    return { clicks: Math.round(r.clicks || 0), impressions: Math.round(r.impressions || 0), position: r.position ? Math.round(r.position * 10) / 10 : null };
}

async function searchBy(siteUrl, from, to, dimension, limit = 25) {
    const j = await api('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', { method: 'POST', body: { startDate: from, endDate: to, dimensions: [dimension], rowLimit: limit } });
    return (j.rows || []).map((r) => ({ key: r.keys[0], clicks: Math.round(r.clicks || 0), impressions: Math.round(r.impressions || 0), ctr: r.ctr ? Math.round(r.ctr * 1000) / 10 : 0, position: r.position ? Math.round(r.position * 10) / 10 : null }));
}

/* ---------- Gmail ---------- */
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
async function gmailProfile() { return api(GM + '/profile'); }
async function gmailList(q, max = 50) {
    const j = await api(GM + '/messages?maxResults=' + max + '&q=' + encodeURIComponent(q));
    return (j.messages || []).map((m) => m.id);
}
async function gmailMeta(id) {
    const j = await api(GM + '/messages/' + id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Date');
    const h = Object.fromEntries((j.payload && j.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    return { id, from: h.from || '', subject: h.subject || '', messageId: h['message-id'] || null, date: j.internalDate ? new Date(Number(j.internalDate)).toISOString() : null };
}
async function gmailRaw(id) {
    const j = await api(GM + '/messages/' + id + '?format=raw');
    return Buffer.from(String(j.raw || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
async function gmailSend(rfc822) {
    return api(GM + '/messages/send', { method: 'POST', body: { raw: Buffer.from(rfc822).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } });
}

/* ---------- Kalender ---------- */
async function calendarEvents(fromIso, toIso) {
    const j = await api('https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=' + encodeURIComponent(fromIso) + '&timeMax=' + encodeURIComponent(toIso));
    return (j.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
        title: e.summary || '(ohne Titel)', location: e.location || '', start: (e.start && (e.start.dateTime || e.start.date + 'T00:00:00')) || null,
        end: (e.end && (e.end.dateTime || e.end.date + 'T00:00:00')) || null, allDay: !!(e.start && e.start.date), attendees: (e.attendees || []).map((a) => a.email).filter(Boolean),
        description: String(e.description || '').slice(0, 500), link: e.htmlLink || null
    }));
}

/* ---------- Drive (nur von Kasi angelegte Dateien) ---------- */
async function driveFolder(name, parentId) {
    const q = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + String(name).replace(/'/g, "\\'") + "'" + (parentId ? " and '" + parentId + "' in parents" : '');
    const found = await api('https://www.googleapis.com/drive/v3/files?fields=files(id,name,webViewLink)&q=' + encodeURIComponent(q));
    if ((found.files || [])[0]) return found.files[0];
    return api('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', { method: 'POST', body: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) } });
}
/* Text als Google-Doc anlegen (Markdown wird als Text übernommen) */
async function driveDoc(name, text, parentId) {
    const boundary = 'kasi' + crypto.randomBytes(8).toString('hex');
    const meta = { name, mimeType: 'application/vnd.google-apps.document', ...(parentId ? { parents: [parentId] } : {}) };
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + text + '\r\n--' + boundary + '--';
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', raw: body, type: 'multipart/related; boundary=' + boundary });
}

module.exports = { configured, connected, has, SCOPES, authUrl, exchange, locations, reviews, reply, localPost, ownLocation, performance, searchKeywords, searchSites, searchTotals, searchBy,
    gmailProfile, gmailList, gmailMeta, gmailRaw, gmailSend, calendarEvents, driveFolder, driveDoc, REDIRECT };
