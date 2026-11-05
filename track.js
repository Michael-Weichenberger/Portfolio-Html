/* =============================================================================
   Cookielose Besuchs- und Klick-Zählung für Kasi
   Sendet nur: Seite, Herkunft (Kampagnen-Kennung oder Art der verweisenden
   Seite, z. B. „google“), Ereignis. Keine Cookies, nichts im Browser
   gespeichert, keine IP-Speicherung, keine Nutzerkennung. Gezählt wird pro Tag.
   ============================================================================= */
(function () {
    'use strict';
    var ENDPOINT = 'https://mw-sichtbarkeit.harvey-agent.workers.dev/hit';
    if (!navigator.sendBeacon || /bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent)) return;

    function source() {
        var q = new URLSearchParams(location.search);
        var utm = (q.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
        if (utm) return utm === 'email' && q.get('utm_medium') === 'signatur' ? 'signatur' : utm;
        var ref = '';
        try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { ref = ''; }
        if (!ref || ref === location.hostname) return 'direkt';
        if (/(^|\.)google\./.test(ref)) return 'google';
        if (/bing\.|duckduckgo\.|ecosia\.|yahoo\./.test(ref)) return 'suche';
        if (/instagram\.com|l\.instagram/.test(ref)) return 'instagram';
        if (/facebook\.com|fb\.com/.test(ref)) return 'facebook';
        if (/linkedin\.com|lnkd\.in/.test(ref)) return 'linkedin';
        if (/chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google|copilot\.microsoft|claude\.ai/.test(ref)) return 'ki';
        return 'verweis';
    }
    var SRC = source(); // einmal beim Laden, bevor die Startseite die Adresse aufräumt
    var PAGE = location.pathname.replace(/index\.html$/, '') || '/';

    function send(event) {
        try {
            navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify({ p: PAGE, s: SRC, e: event })], { type: 'text/plain' }));
        } catch (e) { /* egal */ }
    }
    window.kasiTrack = send;
    send('view');

    // Klicks auf die wichtigen Wege zur Anfrage
    document.addEventListener('click', function (ev) {
        var a = ev.target.closest && ev.target.closest('a, button');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        var t = a.getAttribute('data-track');
        if (t) return send(t);
        if (/^tel:/i.test(href)) return send('tel');
        if (/^mailto:/i.test(href)) return send('mail');
        if (/wa\.me|whatsapp/i.test(href)) return send('whatsapp');
        if (/instagram\.com/i.test(href)) return send('instagram');
        if (/cal\.com|#termin|erstgespr/i.test(href + ' ' + (a.textContent || ''))) return send('termin');
        if (/#planer/i.test(href)) return send('planer');
        if (/#sichtbarkeit/i.test(href)) return send('check');
    }, true);
}());
