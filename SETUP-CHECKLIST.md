# Checklist di messa online — un passo alla volta

Ordine consigliato: **GitHub → Supabase → Resend → Vercel → dominio**.
Puoi fermarti dopo ogni passo: l'app resta funzionante in modalità demo finché non colleghi Supabase.

---

## Passo 0 — Provare in locale (5 minuti)

```bash
cd hornung-crm
npm install
npm run dev
```

- [ ] Si apre su http://localhost:5173
- [ ] "Entra come cliente" e "Entra come specialista" funzionano
- [ ] Giri tutte le schermate e mi dici cosa cambiare

---

## Passo 1 — GitHub

```bash
git init
git add .
git commit -m "Hornung Consulting CRM — MVP"
git branch -M main
git remote add origin https://github.com/<tuo-utente>/hornung-crm.git
git push -u origin main
```

- [ ] Repo creato (privato)
- [ ] `.env` **non** è nel repo (è già in `.gitignore`)

---

## Passo 2 — Supabase (database condiviso con WisiHealth)

Usa il progetto Supabase esistente di WisiHealth.

### 2.1 Migrazioni

SQL Editor → esegui **in quest'ordine**, uno alla volta:

- [ ] `supabase/migrations/20260101000001_core_shared.sql`
- [ ] `supabase/migrations/20260101000002_hornung_schema.sql`
- [ ] `supabase/migrations/20260101000003_hornung_rls.sql`
- [ ] `supabase/migrations/20260101000004_storage.sql`
- [ ] `supabase/migrations/20260101000005_seed.sql`

> Il primo file crea `apps` e `app_profiles`, che sono le tabelle condivise fra le app.
> Non tocca nulla di quello che già esiste per WisiHealth.

### 2.2 Account dello specialista

- [ ] Authentication → Users → **Add user** con l'e-mail di Hornung Consulting (con password)
- [ ] SQL Editor: `select public.promote_to_specialist('hornungconsulting@gmail.com');`
      (deve rispondere `OK — ... is now a specialist of hornung_crm.`)

### 2.3 Impostazioni auth

- [ ] Authentication → URL Configuration → **Site URL**: l'URL del sito (prima Vercel, poi il dominio)
- [ ] **Redirect URLs**: aggiungi `http://localhost:5173/set-password` e `https://<dominio>/set-password`
- [ ] Authentication → Providers → Email: **Confirm email** attivo, registrazione pubblica non necessaria

### 2.4 Chiavi

Settings → API, annota:

- [ ] `Project URL`
- [ ] `anon public key`
- [ ] `service_role key` (segreta — solo lato server)

---

## Passo 3 — Resend

- [ ] API key creata
- [ ] Dominio mittente verificato (es. `hornungconsulting.ch`) — oppure, per le prime prove,
      si usa `onboarding@resend.dev`
- [ ] Mittente scelto, es. `Hornung Consulting <no-reply@hornungconsulting.ch>`

---

## Passo 4 — Vercel

- [ ] Importa il repo GitHub (framework rilevato: Vite, build `npm run build`, output `dist`)
- [ ] Settings → Environment Variables:

| Variabile | Valore |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |
| `VITE_APP_ID` | `hornung_crm` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `RESEND_API_KEY` | chiave Resend |
| `RESEND_FROM` | `Hornung Consulting <no-reply@...>` |
| `PUBLIC_SITE_URL` | URL del sito (senza `/` finale) |
| `NOTIFY_BCC` | (facoltativo) copia delle e-mail allo studio |
| `CRON_SECRET` | stringa segreta a caso — protegge `/api/open-tax-year` |
| `AUTO_OPEN_MONTH_DAY` | (facoltativo) `MM-DD` da cui aprire l'anno, default `01-01` |

- [ ] Deploy
- [ ] Login con l'account specialista → si apre la dashboard "Clienti"
- [ ] Verifica il cron: Vercel → progetto → tab **Cron Jobs** → `/api/open-tax-year` risulta
      programmato (`0 6 1 * *`); per un test immediato, chiamalo con
      `curl -H "Authorization: Bearer <CRON_SECRET>" https://<dominio>/api/open-tax-year` e
      controlla la risposta `{ taxYear, created, skipped }`

---

## Passo 5 — Dominio

- [ ] Dominio acquistato (su Vercel o su un registrar esterno)
- [ ] Vercel → Settings → Domains → aggiungi il dominio e segui i record DNS indicati
- [ ] Aggiorna `PUBLIC_SITE_URL` su Vercel
- [ ] Aggiorna Site URL e Redirect URLs su Supabase
- [ ] Redeploy

---

## Passo 6 — Prova completa (end-to-end)

- [ ] Creo un cliente di prova (con una mia e-mail) → arriva l'invito
- [ ] Attivo la password dal link → entro nel portale cliente
- [ ] Compilo "I miei dati" e salvo
- [ ] Lo specialista apre l'anno fiscale e imposta la checklist documenti
- [ ] Carico un PDF come cliente → lo specialista lo vede
- [ ] Lo specialista carica la dichiarazione e mette lo stato su "Completata" con notifica
- [ ] Arriva l'e-mail con l'elenco dei documenti
- [ ] Prova con la stessa e-mail già usata su WisiHealth: deve entrare con la stessa password e
      vedere **solo** i dati di Hornung

---

## Dopo l'MVP

- [ ] Fase 2 — estrazione AI dei dati dai documenti (`extracted_fields` è già pronta)
- [ ] Fase 3 — export verso Doctor Tax (`export_jobs`), da verificare con loro
- [ ] Eventuale backup/retention dei documenti e informativa privacy
