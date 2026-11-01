# Migrazione a Cloudflare Workers + Neon + R2 (branch `migrazione-cloudflare`)

Con questo branch l'app non usa più Supabase (né database né storage) né Vercel:

| Prima | Ora | Dove nel codice |
|---|---|---|
| Supabase Postgres + PostgREST (supabase-js) | **Neon** (Postgres), driver `@neondatabase/serverless` via HTTP | `api/_db.js`, `api/_dbClient.js` |
| Supabase Storage + signed URL | **Cloudflare R2** + URL firmati HMAC serviti dal Worker | `api/_storage.js`, `api/files.js` |
| sharp + heic-decode | **jSquash (mozjpeg, libwebp) + libheif-js + fast-png**, resize lanczos3 in JS; oltre 8 MP **Cloudflare Images** | `api/_imageNormalize.js`, `api/_imageResize.js` |
| Funzioni Vercel `(req, res)` | **un Worker**: router + adattatore unico | `worker/index.js`, `worker/vercelAdapter.js` |
| Webhook pg_net → `/api/extract-document` (fino a 5 min nella richiesta) | **Cloudflare Queue**: job + un messaggio per documento | `api/_extractionQueue.js`, migrazione 54 |
| Vercel Cron | **Cron Trigger** `0 6 1 * *` → `scheduled()` | `wrangler.toml`, `api/open-tax-year.js` |
| Rewrite SPA + header di `vercel.json` | **Workers Static Assets** (`not_found_handling = "single-page-application"`) + `public/_headers` | `wrangler.toml` |

Configurazione: `wrangler.toml`. Le migrazioni ora stanno in `db/migrations/` (prima `supabase/migrations/`).

## Database

- Le migrazioni 01–52 si applicano **senza modifiche** su un Postgres normale. `db/supabase-compat.sql`
  crea prima, vuoti, i pochi oggetti Supabase che nominano: i ruoli `anon`/`authenticated`/`service_role`,
  `auth.users`, `auth.uid()`, `storage.*` e `net.http_post`. Il runner (`db/migrate.js`) salta solo la riga
  `create extension pg_net`, che su Neon non esiste.
- **53 `leave_supabase`** rimuove:
  - tutte le policy RLS e la RLS stessa;
  - il trigger pg_net dell'estrazione;
  - i trigger della migrazione 52 che rispecchiavano `auth.users`;
  - le funzioni usate solo dalle policy o dagli RPC del browser (`auth.uid()`, `is_hornung_staff`, `my_client_id`, …);
  - gli schemi e i ruoli finti creati da `supabase-compat.sql`.

  Riscrive `promote_to_specialist()` su `auth_accounts` e imposta il fuso UTC. **Si rifiuta di girare su
  Supabase**, dove vive ancora `main`.
- **54 `extraction_jobs`** aggiunge le tabelle e le funzioni dei job di estrazione.
- `npm run db:migrate` applica le migrazioni a Neon, con `DATABASE_URL` preso dall'ambiente.

## Estrazione documenti

Nessuna estrazione gira più dentro una richiesta HTTP:
- **upload:** `registerUploadedDocument` mette in coda il documento, come faceva prima il trigger pg_net;
- **"Riprova estrazione", "Estrai tutto", "compila da documento":** rispondono subito `202 { jobId }`;
- **consumer della queue:** esegue `runExtraction()` così com'era, un documento per messaggio, al massimo 3
  in parallelo (`max_concurrency`, lo stesso limite di prima per il rate limit di Anthropic);
- **pagina:** fa polling di `getExtractionJob` e riceve lo stesso risultato di prima. La UI non cambia.

Consegna "almeno una volta":
- ogni documento del job viene preso in carico in modo atomico, quindi un messaggio duplicato non lo
  rielabora;
- se un'esecuzione muore a metà, dopo 15 minuti il documento viene ripreso (anche se era rimasto
  `extracting`);
- dopo 5 tentativi falliti il messaggio va nella dead-letter queue `hornung-extraction-dlq`.

Cambio di comportamento voluto: "compila il questionario da un documento" carica il file **senza**
estrazione automatica e avvia solo la sua (con categoria forzata). Prima partivano in parallelo il webhook e
l'estrazione sincrona sullo stesso documento.

## Immagini e memoria (128 MB per isolate)

Misure su Node con `npm run measure:image-memory`, che rileva la memoria esterna, cioè wasm e ArrayBuffer:

| Foto | Picco durante la decodifica |
|---|---|
| 8 MP | ~67–72 MB |
| 12 MP | ~101 MB |
| 24 MP | ~202 MB |

Quindi, **prima di decodificare**, la dimensione in pixel viene letta solo dagli header (JPEG, PNG, WebP, HEIC):
- **fino a 8 MP** (`IMAGE_MAX_WORKER_PIXELS`): conversione nel Worker;
- **oltre, fino a 100 MP e 20 MB**: binding **Cloudflare Images** (`env.IMAGES`), che lavora fuori dalla memoria
  del Worker. Output uguale: JPEG, lato lungo 2400, qualità 85, rotazione EXIF, fondo bianco. Converte anche i GIF;
- **altrimenti**: rifiuto con un messaggio chiaro (`IMAGE_TOO_LARGE`), che compare come errore di estrazione del
  documento.

Accorgimenti contro i picchi:
- un'istanza wasm nuova per ogni immagine, così l'heap viene liberato;
- resize in streaming, che legge i pixel dove sono;
- JPEG baseline, che consuma ~70 MB invece dei ~90 MB della versione progressive.

**Non verificabile con certezza in locale**: `wrangler dev` non applica il limite di 128 MB, e il GC di V8 nel
runtime vero può comportarsi diversamente. Per misurarlo davvero c'è `workers/image-memory-probe`: si deploya
con un account, si lancia `run.mjs` e si legge fino a quanti MP la conversione passa. Poi si regola
`IMAGE_MAX_WORKER_PIXELS`.

## Cosa è verificato in locale

`npm run build` esegue tre fasi:
1. tutti i test (`vitest`);
2. la build del front-end e il controllo dei segreti nel bundle;
3. `npm run check:worker`: l'app intera **dentro workerd** (`wrangler dev`), con:
   - Postgres locale che parla il protocollo HTTP di Neon (`scripts/local-neon.mjs`: PGlite con tutte le migrazioni);
   - R2, Queues, Images e cron emulati da wrangler.

`check:worker` verifica in 20 passi:
- **asset e routing:** asset statici, fallback SPA, header di sicurezza;
- **accesso:** login bcrypt, sessione, controllo Origin;
- **upload su R2:** URL firmato, nessuna sovrascrittura, token falsificato rifiutato, HTML rifiutato;
- **estrazione:** coda dopo l'upload, conversione HEIC→JPEG nel consumer, chiamata all'SDK Anthropic;
- **download:** URL firmato, Range 206, nome come allegato;
- **immagini grandi:** foto da 12 MP passata a Images;
- **job:** "Riprova", "Estrai tutto";
- **cron e pulizia:** Cron Trigger, cancellazione del file, logout.

Su Postgres vero (PGlite) i test verificano anche:
- le 54 migrazioni e lo stato dopo la 53 (`test/postgres-migrations.test.js`);
- ogni costrutto del query builder;
- la queue: concorrenza, duplicati, ripresa (`test/extraction-queue.test.js`);
- la copia dei dati da un database "tipo Supabase", senza le righe di WisiHealth (`test/copy-data.test.js`).

## Cosa resta da confermare con un deployment vero

- **Memoria a 128 MB** delle conversioni nel Worker: si misura con `workers/image-memory-probe`.
- **Tempo CPU** di conversione immagini, bcrypt (~1–2 s per login) ed estrazione, sul piano scelto.
  `[limits] cpu_ms = 300000` richiede **Workers Paid**.
- **Limite di subrequest** per invocazione: ogni query a Neon via HTTP è una subrequest, e un'estrazione ne
  fa decine. Il limite del piano a pagamento è molto più alto di quello gratuito (50), ma il valore esatto va
  controllato.
- **Latenza** Worker → Neon. Conviene scegliere una regione Neon in Europa (es. Frankfurt).
- **Cloudflare Images** vero. In locale c'è solo la copia ridotta di wrangler, che non applica la qualità né
  la rotazione EXIF.
- **Chiamate vere** ad Anthropic e Resend con le chiavi di produzione.
- **Dominio, cookie `Secure` e invio dei link nelle e-mail** (`PUBLIC_SITE_URL`).

## Credenziali: cosa serve, quando, dove si trova

| Quando | Cosa | Dove si trova |
|---|---|---|
| Deploy | Account Cloudflare con **Workers Paid** (Queues e CPU oltre i 30 s lo richiedono) e R2 attivato | dash.cloudflare.com → Workers & Pages → Plans; R2 → Activate |
| Deploy | `npx wrangler login` (dal browser), oppure **API token** + **Account ID** in `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Token: My Profile → API Tokens → Create Token → modello "Edit Cloudflare Workers", aggiungendo i permessi R2 e Queues: Edit. Account ID: Workers & Pages → colonna a destra |
| Deploy | **Stringa di connessione Neon** → `wrangler secret put DATABASE_URL` | console.neon.tech → progetto → **Connect** → ruolo owner (`neondb_owner`) → "Connection string" |
| Deploy | `FILES_SIGNING_SECRET` (`openssl rand -hex 32`), `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET` → `wrangler secret put` | Anthropic: console.anthropic.com → API Keys. Resend: resend.com → API Keys |
| Copia file | **Token API R2 (S3)**: Access Key ID + Secret Access Key, più l'Account ID | R2 → **Manage R2 API Tokens** → Create API token → Object Read & Write sul bucket `hornung-client-documents` |
| Copia dati e file | **Connessione al database Supabase** (`SUPABASE_DB_URL`) e **service role key** (`SUPABASE_SERVICE_ROLE_KEY`). Le usano solo i tuoi script, letti dall'ambiente | Supabase → Project Settings → Database → Connection string (Session pooler); Project Settings → API |

## Procedura di passaggio (quando vuoi spegnere Supabase/Vercel)

```bash
# 1. Risorse Cloudflare (una volta)
npx wrangler r2 bucket create hornung-client-documents
npx wrangler queues create hornung-extraction
npx wrangler queues create hornung-extraction-dlq

# 2. Database Neon vuoto -> schema completo (01–54)
DATABASE_URL=... npm run db:migrate

# 3. Prova generale della copia (ripetibile: svuota e riempie le tabelle Hornung su Neon)
SUPABASE_DB_URL=... DATABASE_URL=... node scripts/copy-data-from-supabase.mjs --yes
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  node scripts/copy-files-to-r2.mjs

# 4. Segreti e deploy
npx wrangler secret put DATABASE_URL        # e FILES_SIGNING_SECRET, ANTHROPIC_API_KEY, RESEND_API_KEY, CRON_SECRET
# imposta PUBLIC_SITE_URL in wrangler.toml [vars] sul dominio vero
npm run deploy

# 5. Il giorno del passaggio: rifai la copia dei dati (3) con main fermo, poi sposta il dominio sul Worker.
```

La copia dei dati porta solo Hornung:
- dalle tabelle condivise prende solo l'app `hornung_crm`, i suoi profili e i loro login con password e link
  pendenti. Le sessioni non vengono copiate: tutti rifanno il login;
- di WisiHealth non porta niente;
- trigger disattivati durante la copia e conteggi verificati tabella per tabella.

La copia dei file mantiene gli stessi percorsi (`hornung/<client>/<anno>/<direzione>/<file>`), quindi gli
`storage_path` nel database restano validi.
