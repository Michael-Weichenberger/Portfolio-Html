MW IT-SERVICES – LAUNCH-CHECKLISTE

1. WICHTIG: Ordner assets/ mit allen im HTML referenzierten Originalbildern zum Upload hinzufügen. Diese wurden nicht mitgeliefert.
2. Bei Netlify gesamte Website einschließlich assets/ bereitstellen. Nicht nur index.html hochladen.
3. Domain mw-itservices.de verbinden; MX/SPF/DKIM/DMARC von Google Workspace unverändert lassen. SSL prüfen.
4. EmailJS: echten Testversand prüfen, Variablennamen im Template verifizieren, Domain-Einschränkungen und wirksamen Anti-Bot-Schutz im Anbieter-Account aktivieren. Client-Honeypot ist kein serverseitiger Schutz.
5. Impressum: Geschäftsanschrift, Telefon, Steuerstatus und ggf. weitere Pflichtangaben rechtlich prüfen.
6. Datenschutzerklärung: Netlify-, EmailJS- und Google-Verträge/Drittländer, reale Aufbewahrungsfristen und Browser-Storage prüfen. Eine technische Korrektur ist KEINE rechtliche Freigabe.
7. Cookie-Banner nur dann nicht erforderlich, wenn keine einwilligungspflichtigen Speicher-/Zugriffstechnologien eingesetzt werden. Im Browser testen.
8. Die .netlify.app-Domain ggf. per Redirect auf kanonische Domain konfigurieren, nachdem die Domain aktiv ist.
