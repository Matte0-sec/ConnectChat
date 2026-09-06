# ConnectChat

ConnectChat ist eine statische Chat-Web-App fuer GitHub Pages. Nachrichten,
Profile und Gruppen werden mit Supabase gespeichert und in Echtzeit aktualisiert.

## Einmalige Supabase-Einrichtung

1. Oeffne im Supabase-Projekt `Authentication` > `Providers`.
2. Aktiviere `Anonymous sign-ins` und speichere die Aenderung.
3. Oeffne `SQL Editor` > `New query`.
4. Kopiere den gesamten Inhalt von [supabase.sql](supabase.sql) in die Abfrage.
5. Waehle `Run`.

Danach oeffnest du die GitHub-Pages-URL. Beim ersten Besuch wird nur ein
eindeutiger Benutzername abgefragt. Die anonyme Supabase-Anmeldung erstellt im
Hintergrund eine geschuetzte technische Nutzer-ID; ein Passwort ist nicht erforderlich.

## Admin einrichten

1. Lege auf der veroeffentlichten ConnectChat-Seite zuerst dein eigenes Profil an.
2. Oeffne in Supabase erneut `SQL Editor` > `New query`.
3. Kopiere den gesamten Inhalt von [admin_migration.sql](admin_migration.sql) hinein und waehle `Run`.
4. Fuehre danach diese Abfrage aus und ersetze `DEIN_BENUTZERNAME` durch deinen exakten ConnectChat-Namen:

```sql
update public.profiles
set role = 'site_admin'
where username = 'DEIN_BENUTZERNAME';
```

5. Lade ConnectChat neu. Danach erscheint links der Punkt `Verwaltung`.

Der Admin-Modus kann Nutzer suchen, ihnen einen privaten Chat schreiben und
Konten sperren oder entsperren. Die Berechtigungen und Sperren werden in
Supabase erzwungen, nicht durch einen im Browser sichtbaren Passwort-Button.

Hinweis: Da die Anmeldung anonym ist, kann jemand mit technischem Wissen nach
einer Sperre Browserdaten loeschen und ein neues anonymes Konto erstellen. Fuer
eine dauerhafte personenbezogene Sperre brauchst du spaeter eine Anmeldung per
E-Mail, OAuth oder eine andere verifizierte Identitaet.

## Projektdateien

- `index.html`: Benutzeroberflaeche
- `style.css`: responsive Darstellung und Dark/Light Mode
- `script.js`: Supabase-Client, Echtzeit-Chats und Gruppenlogik
- `supabase.sql`: Datenmodell, sichere Datenbankfunktionen und Zugriffsschutz
- `admin_migration.sql`: einmalige Erweiterung fuer globale Admins und Sperren

Der in `script.js` enthaltene Supabase Publishable Key ist fuer Browser-Apps vorgesehen.
Einen `service_role`- oder Secret-Key darfst du niemals im Repository oder im Frontend speichern.