# Hornung Consulting — CRM / Portale clienti

Portale per la gestione delle dichiarazioni fiscali svizzere: il cliente carica i suoi documenti
e segue lo stato della pratica, lo specialista gestisce clienti, anni fiscali, stati e documenti
finali.

Stack: **React + Vite + Tailwind** (frontend), **Cloudflare Workers** (hosting + API, coda di
estrazione, cron), **Neon** (Postgres), **Cloudflare R2** (documenti), **Resend** (e-mail),
**Anthropic** (estrazione AI). Login e sessioni sono nostri (`api/_auth.js`).
Il passaggio da Supabase/Vercel è descritto in **docs/MIGRAZIONE-CLOUDFLARE.md**.

---

## 1. Avvio in locale

L'app parla sempre e solo con il backend reale (il Worker, `/api`): non esiste una modalità demo.
In locale gira tutto dentro workerd, senza account Cloudflare né Neon:

```bash
npm install
npm run build          # test + front-end + controllo end-to-end nel runtime Workers
npm run dev:worker     # app completa su http://127.0.0.1:8787 (Postgres locale, R2/Queue/cron emulati)
npm run dev            # facoltativo: pagine con hot reload su :5173, /api inoltrato al Worker
```

Chiavi facoltative (Anthropic, Resend) in `.dev.vars` (vedi `.dev.vars.example`, mai nel repo).

Se le variabili del server mancano, l'app mostra la pagina "Il portale non è configurato"
invece della schermata di login.

---

## 2. Cosa contiene

```
hornung-crm/
├── worker/                   Il Worker: router delle API, cron, consumer della coda
├── api/                      Endpoint e logica server — mai esposti al browser
│   ├── _lib.js               Client del database, Resend, template e-mail, controllo ruolo
│   ├── _db.js                Query builder (stessa API usata con supabase-js) -> SQL su Neon
│   ├── _storage.js, files.js R2 + URL firmati
│   ├── _extractionQueue.js   Estrazione documenti tramite Cloudflare Queue
│   ├── invite-client.js      Crea cliente + invito via e-mail
│   └── case-status.js        Cambia stato pratica + e-mail automatica al cliente
├── db/                       Migrazioni (npm run db:migrate), strato di compatibilità, copia dati
├── scripts/                  Sviluppo locale, controllo end-to-end, copia dati/file da Supabase
├── src/
│   ├── components/           UI riutilizzabile (uploader, checklist, stepper, pannello AI…)
│   ├── context/              Auth e notifiche
│   ├── i18n/                 EN · DE · FR · IT
│   ├── lib/
│   │   ├── config.js         APP_ID, anno fiscale corrente, limiti upload
│   │   ├── pricing.js        Calcolo della stima onorario dal tariffario
│   │   └── data/             Livello dati: supabaseData.js (chiamate a /api)
│   └── pages/                Login, home cliente, pratica, dati, tariffe, dashboard specialista
├── wrangler.toml             Configurazione Cloudflare (binding, coda, cron, asset)
└── .dev.vars.example         Segreti del server (in produzione: wrangler secret put)
```

### Schermate

| Ruolo | Pagina | Contenuto |
|---|---|---|
| Cliente | Home | Anno corrente in evidenza + anni precedenti, stato, scadenza |
| Cliente | Pratica | Upload documenti, checklist concordata, documenti ricevuti, stato |
| Cliente | I miei dati | Questionario completo (dati personali, coniuge, figli, veicoli, immobili) |
| Cliente | Tariffe | Tariffario + stima personalizzata |
| Specialista | Clienti | KPI, filtri per anno/stato, ricerca, creazione e invito clienti |
| Specialista | Scheda cliente | Anni fiscali, questionario, note interne, reinvio invito, archiviazione |
| Specialista | Pratica | Tutto quello che vede il cliente + area riservata |

### Area riservata allo specialista (dentro la pratica)

- Cambio stato con messaggio al cliente e invio e-mail automatico
- Note interne (mai visibili al cliente)
- Stima onorario calcolata dal tariffario e dai dati del questionario
- Cronologia della pratica
- **Dati estratti (AI)** — pannello di fase 2: struttura, tracciabilità della fonte
  (documento, pagina, citazione) e campo di interrogazione già pronti
- **Export verso Doctor Tax** — pulsante di fase 3, da attivare quando l'integrazione è confermata

---

## 3. Stati della pratica

| Stato | Significato |
|---|---|
| `opened` | Pratica aperta, il cliente può caricare |
| `waiting_client` | Manca qualcosa dal cliente (messaggio visibile a lui) |
| `in_process` | In lavorazione presso lo studio |
| `review` | Revisione finale |
| `finished` | Completata → e-mail automatica con l'elenco dei documenti disponibili |

Ogni cambio di stato viene registrato nella cronologia della pratica.

---

## 4. Login e profili per app

Il database Supabase era condiviso con WisiHealth; quello Neon contiene solo Hornung (la copia
dei dati prende solo le righe `hornung_crm`). Lo schema conserva comunque la regola:

- **una sola identità per persona** (una riga in `auth_accounts`, una password)
- **un profilo separato per app** in `app_profiles (user_id, app_id, role)`
- tutte le tabelle di Hornung si agganciano ad `app_profiles`
- ogni controllo di accesso (lato server, `api/_dataOps.js`) filtra anche per `app_id`

Conseguenza pratica: se una persona è già registrata in WisiHealth e viene invitata qui, **non**
viene creato un secondo account — riceve un profilo nuovo e completamente isolato in questa app e
accede con la password che già usa. Questo tiene le due app separate oggi e rende possibile
l'unione in futuro. La logica è in `api/invite-client.js`.

### Tabelle principali

`apps` · `app_profiles` · `clients` · `client_details` · `client_persons` · `client_children` ·
`client_vehicles` · `client_properties` · `tax_cases` · `case_events` · `document_types` ·
`case_requested_documents` · `case_documents` · `pricing_items` · `extracted_fields` (fase 2) ·
`export_jobs` (fase 3)

Il tariffario è in tabella: i prezzi si modificano nel database senza toccare il codice.

---

## 5. Messa online (Cloudflare + Neon + Resend)

Segui **SETUP-CHECKLIST.md**; credenziali e procedura di passaggio da Supabase in
**docs/MIGRAZIONE-CLOUDFLARE.md**. In sintesi:

1. Neon: crea il progetto, poi `DATABASE_URL=... npm run db:migrate`
2. Cloudflare: bucket R2, coda, segreti (`wrangler secret put`), `npm run deploy`
3. Specialista: registrati su /register e poi in Neon (SQL Editor)
   `select public.promote_to_specialist('email@studio.ch');`
4. Resend: verifica il dominio mittente e crea una API key
5. Collega il dominio al Worker e aggiorna `PUBLIC_SITE_URL`

---

## 6. Roadmap

**Fase 1 — MVP (questo repo)**
Auth con inviti, ruoli, anni fiscali, upload bidirezionale, stati + e-mail, questionario,
tariffario e stima onorario.

**Fase 2 — Estrazione AI**
Un job legge i documenti caricati e scrive in `extracted_fields` valore, documento, pagina e
citazione di origine. Il pannello nell'area specialista è già pronto a mostrarli e a rispondere
alla domanda "da dove viene questo dato?".

**Fase 3 — Doctor Tax**
`export_jobs` registra i payload inviati. Da attivare quando Doctor Tax conferma se e come
espone delle API.

**Apertura automatica dell'anno fiscale**
`api/open-tax-year.js` gira dal Cron Trigger di Cloudflare definito in `wrangler.toml` (ogni primo
del mese, `0 6 1 * *`); si può anche chiamare a mano con `Authorization: Bearer <CRON_SECRET>`. Per ogni cliente `active` senza
una pratica per l'anno fiscale corrente ne crea una con stato `opened`, scadenza 31 marzo
dell'anno successivo e un evento `case_opened`. Non fa nulla prima della data configurata in
`AUTO_OPEN_MONTH_DAY` (default `01-01`), salta i clienti `invited`/`archived` ed è idempotente.
Non invia e-mail in questa versione. Il pulsante manuale "Apri un nuovo anno fiscale" nella
scheda cliente resta disponibile in aggiunta.

---

## 7. Note tecniche

- File accettati: PDF, JPG, PNG, HEIC, WebP, Word, Excel, CSV — max 25 MB (controllato da `api/files.js`)
- Storage privato su R2: `hornung/<client_id>/<anno>/<direzione>/<file>`, upload e download solo
  tramite URL firmati a tempo emessi dal server
- Le foto vengono convertite in JPEG (2400 px, qualità 85); oltre 8 MP la conversione passa da
  Cloudflare Images per restare nei 128 MB di memoria del Worker
- Il cliente può eliminare solo i propri upload e solo finché la pratica non è chiusa
- Interfaccia in 4 lingue, e-mail automatiche nella lingua scelta per il cliente
- Testi grandi, contrasti alti e aree cliccabili ampie: molti clienti non sono giovanissimi
