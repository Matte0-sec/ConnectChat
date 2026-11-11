# ConnectChat

ConnectChat ist eine statische Chat-Web-App fuer GitHub Pages. Nachrichten,
Profile und Gruppen werden mit Supabase gespeichert und in Echtzeit aktualisiert.

## Einmalige Supabase-Einrichtung

1. Oeffne im Supabase-Projekt `Authentication` > `Providers`.
2. Aktiviere `Email`, deaktiviere `Confirm email` und speichere die Aenderung.
   ConnectChat verwendet ausschließlich Benutzernamen und Passwoerter; deshalb
   kann keine E-Mail bestaetigt werden.
3. Oeffne `SQL Editor` > `New query`.
4. Kopiere den gesamten Inhalt von [supabase.sql](supabase.sql) in die Abfrage.
5. Waehle `Run`.

Danach oeffnest du die GitHub-Pages-URL. Neue Personen registrieren sich mit
einem eindeutigen Benutzernamen und einem selbst gewaehlten Passwort. Bestehende
Personen melden sich mit diesen beiden Angaben an. Das Passwort wird
ausschliesslich von Supabase verwaltet und nie im Frontend oder in der
Profiltabelle gespeichert. Ohne E-Mail-Adresse gibt es keine
Passwort-zuruecksetzen-Funktion.

## Bestehende Installation auf Passwort-Anmeldung umstellen

Wenn ConnectChat bereits mit der anonymen Anmeldung eingerichtet wurde, fuehre
zusaetzlich den Inhalt von [password_auth_migration.sql](password_auth_migration.sql)
im Supabase SQL Editor aus. Anschliessend aktiviere unter `Authentication` >
`Providers` den Anbieter `Email` und deaktiviere `Confirm email`. Bereits
anonyme Konten behalten ihre Daten, muessen sich fuer eine Passwort-Anmeldung
aber mit einem noch nicht vergebenen Benutzernamen neu registrieren.

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

Hinweis: Eine Sperre gilt fuer das jeweilige Konto. Fuer besonders starke
personenbezogene Sperren solltest du die E-Mail-Bestaetigung aktiviert lassen
oder spaeter einen OAuth-Anbieter verwenden.

## Projektdateien

- `index.html`: Benutzeroberflaeche
- `style.css`: responsive Darstellung und Dark/Light Mode
- `script.js`: Supabase-Client, Echtzeit-Chats und Gruppenlogik
- `supabase.sql`: Datenmodell, sichere Datenbankfunktionen und Zugriffsschutz
- `admin_migration.sql`: einmalige Erweiterung fuer globale Admins und Sperren
- `password_auth_migration.sql`: einmalige Umstellung bestehender Installationen
  von anonymer auf E-Mail-/Passwort-Anmeldung

Der in `script.js` enthaltene Supabase Publishable Key ist fuer Browser-Apps vorgesehen.
Einen `service_role`- oder Secret-Key darfst du niemals im Repository oder im Frontend speichern.