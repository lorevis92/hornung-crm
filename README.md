# Hornung Consulting — CRM / Portale clienti

Portale per la gestione delle dichiarazioni fiscali svizzere: il cliente carica i suoi documenti
e segue lo stato della pratica, lo specialista gestisce clienti, anni fiscali, stati e documenti
finali.

Stack: **React + Vite + Tailwind** (frontend), **Supabase** (database, auth, storage),
**Resend** (e-mail), **Vercel** (hosting + funzioni serverless).

---

## 1. Avvio rapido (modalità demo, senza database)

```bash
npm install
npm run dev
```

Apri http://localhost:5173 e usa i due pulsanti in fondo alla pagina di login:

- **Entra come cliente** → vedi il portale dal punto di vista del cliente
- **Entra come specialista** → vedi la dashboard, i clienti e l'area riservata

In modalità demo tutti i dati sono di esempio e vivono nel browser (localStorage): nessun server,
nessuna configurazione. Serve per rivedere e discutere l'interfaccia prima di collegare Supabase.
La modalità demo si attiva automaticamente quando mancano le variabili `VITE_SUPABASE_*`.

---

## 2. Cosa contiene

```
hornung-crm/
├── api/                      Funzioni serverless (Vercel) — service role, mai esposte al browser
│   ├── _lib.js               Client Supabase admin, Resend, template e-mail, controllo ruolo
│   ├── invite-client.js      Crea cliente + invito via e-mail
│   └── case-status.js        Cambia stato pratica + e-mail automatica al cliente
├── supabase/migrations/      SQL da eseguire nel progetto Supabase (in ordine)
├── src/
│   ├── components/           UI riutilizzabile (uploader, checklist, stepper, pannello AI…)
│   ├── context/              Auth e notifiche
│   ├── i18n/                 EN · DE · FR · IT
│   ├── lib/
│   │   ├── config.js         APP_ID, demo mode, anno fiscale corrente, limiti upload
│   │   ├── pricing.js        Calcolo della stima onorario dal tariffario
│   │   └── data/             Livello dati: demo.js e supabaseData.js (stessa interfaccia)
│   └── pages/                Login, home cliente, pratica, dati, tariffe, dashboard specialista
└── .env.example              Tutte le variabili d'ambiente
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

## 4. Database condiviso con WisiHealth

Il database Supabase è condiviso tra più app. La regola è:

- **una sola identità per persona** (una riga in `auth.users`, una password)
- **un profilo separato per app** in `app_profiles (user_id, app_id, role)`
- tutte le tabelle di Hornung si agganciano ad `app_profiles`, **mai** direttamente ad `auth.users`
- ogni policy RLS filtra anche per `app_id`

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

## 5. Collegare Supabase, Resend e Vercel

Segui **SETUP-CHECKLIST.md**: è la procedura passo per passo, nell'ordine giusto.

In sintesi:

1. Progetto Supabase → SQL Editor → esegui i 5 file di `supabase/migrations/` **in ordine**
2. Crea l'account dello specialista (Authentication → Add user) e poi esegui
   `select public.promote_to_specialist('email@studio.ch');`
3. Resend: verifica il dominio mittente e crea una API key
4. Vercel: importa il repo GitHub e inserisci le variabili d'ambiente di `.env.example`
5. Collega il dominio definitivo e aggiorna `PUBLIC_SITE_URL` + i Redirect URL in Supabase

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

---

## 7. Note tecniche

- File accettati: PDF, JPG, PNG, HEIC, WebP, Word, Excel, CSV — max 25 MB (limite anche sul bucket)
- Storage privato: `client-documents/hornung/<client_id>/<anno>/<direzione>/<file>`, download solo
  tramite signed URL a tempo
- Il cliente può eliminare solo i propri upload e solo finché la pratica non è chiusa
- Interfaccia in 4 lingue, e-mail automatiche nella lingua scelta per il cliente
- Testi grandi, contrasti alti e aree cliccabili ampie: molti clienti non sono giovanissimi
