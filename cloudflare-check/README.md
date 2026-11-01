# Banco di prova: il codice server di hornung-crm su Cloudflare Workers

Questa cartella **non fa parte dell'app**. È un Worker di prova che gira **in locale** dentro
`wrangler dev`, cioè dentro workerd, lo stesso runtime che Cloudflare usa in produzione.
Serve a capire, prima della migrazione, che cosa del codice in `../api` funziona su Workers.
Ogni volta che è possibile il Worker importa i file **veri** di `../api` (`_auth.js`, `_lib.js`
e tutti gli endpoint) invece di copie.

```bash
cd cloudflare-check
npm install
npm run check      # avvia wrangler dev (o riusa quello già attivo su :8787), scrive results.json
```

Per le chiamate reali ad Anthropic e Resend: copia `.dev.vars.example` in `.dev.vars` (è ignorato da git)
e inserisci `ANTHROPIC_API_KEY` e `RESEND_API_KEY`. L'e-mail di prova va a `delivered@resend.dev`,
un indirizzo di test di Resend che simula la consegna senza recapitarla a nessuna casella.

| File | Cosa contiene |
|---|---|
| `src/worker.js` | una rotta per ogni controllo |
| `src/imageNormalize.workers.js` | sostituto di `api/_imageNormalize.js` senza sharp: jSquash e libheif-js |
| `src/heicDecode.workers.js` | libheif-js (la stessa libreria di oggi) caricato come modulo wasm precompilato |
| `src/stubs/sharp.js` | stub, così il resto di `../api` si può importare |
| `probe-sharp/` | il vero `_imageNormalize.js` con sharp, senza stub: mostra come fallisce |
| `run-checks.mjs` | esegue i controlli, confronta le immagini con sharp su Node, scrive `results.json` |
| `results.json` | i risultati dell'ultima esecuzione (wrangler 4.156.0, compatibility_date 2026-10-01, `nodejs_compat`) |

## Risultati (1 novembre 2026, in locale su Windows)

### 1. Immagini: sharp **non funziona**, jSquash + libheif-js **funzionano**

- **sharp** si impacchetta, ma il Worker **non si avvia**. L'errore è
  `Uncaught TypeError: The argument 'path' ... Received 'undefined' at node:module createRequire`:
  sharp cerca il suo binario nativo (libvips), e su Workers i binari nativi non esistono.
- **heic-decode così com'è**: `CompileError: WebAssembly.Module(): Wasm code generation disallowed by embedder`.
  Il modulo incorpora il wasm come byte e lo compila a runtime, cosa che Workers vieta.
  Per la stessa ragione oggi falliscono all'import anche `api/_imageNormalize.js` ed `extract-document.js`.
- **Sostituto, `src/imageNormalize.workers.js`**:
  - HEIC: lo stesso libheif-js, con il `.wasm` importato come modulo (wrangler lo precompila) più uno shim per `__dirname`.
  - JPEG, PNG e WebP: `@jsquash/jpeg` (che è mozjpeg), `@jsquash/png`, `@jsquash/webp`.
  - Ridimensionamento: `@jsquash/resize`, lanczos3 come sharp.
  - Soglie identiche: 2400 px, qualità 85, 2,5 MB.
- Due cose che sharp faceva da solo vanno scritte a mano:
  - **orientamento EXIF**: il decoder di jSquash non lo applica. Senza correzione la foto girata usciva
    2400×1800 invece di 1800×2400; con `applyOrientation()` torna corretta;
  - **sfondo bianco** per i PNG trasparenti: `flattenOnWhite()`.

Confronto con sharp (sharp gira su Node, sulla stessa macchina):

| Immagine | Worker | sharp oggi | Peso Worker/sharp | PSNR |
|---|---|---|---|---|
| HEIC iPhone (fixture) | 1280×854, 319 KB, ~2–3,5 s | 1280×854, 293 KB | 1,09 | 40,9 dB |
| JPEG 12 MP foto documento | 2400×2399, 315 KB, ~15 s | uguale, 304 KB, ~2,8 s | 1,03 | 42,9 dB |
| JPEG girato (EXIF 6) | 1800×2400 ✓ | 1800×2400 | 1,03 | 46,2 dB |
| PNG screenshot 2880×1800 | 2400×1500, ~5 s | uguale | 1,03 | 48,3 dB |
| PNG trasparente | fondo bianco ✓ | uguale | 1,13 | — |
| JPEG già piccolo | lasciato com'è ✓ | lasciato com'è | 1,00 | — |
| WebP 3000×4000 | 1800×2400, ~10 s | uguale | 1,09 | 36,1 dB |
| JPEG 48 MP | 2400×1800, ~13 s | uguale | 1,06 | 43,2 dB |
| **GIF** | **non supportato** | prima immagine | — | — |

Come leggere la tabella:
- **PSNR** misura quanto le due immagini sono simili: sopra 35 dB sono visivamente indistinguibili.
- **Peso**: le dimensioni sono uguali in tutti i casi, i file escono più pesanti del 3–13%.
- **Velocità**: il Worker è **3–7 volte più lento** di sharp.
- **GIF**: jSquash non ha un decoder GIF. Serve un piccolo decoder JS aggiuntivo, oppure si rifiuta il formato.

**Cosa in locale non si può verificare:**
- **Memoria (128 MB per isolate su Cloudflare).** In locale il limite non viene applicato, infatti
  i 48 MP (192 MB di pixel decodificati) sono passati. In produzione una foto da 12 MP occupa già
  ~65 MB di pixel, più le copie in wasm, quindi è vicina al limite.
- **Tempo CPU.** Il piano gratuito concede 10 ms per richiesta, quindi la conversione è impossibile.
  Il piano a pagamento concede 30 s di default, configurabili fino a 5 minuti. I 10–15 s misurati qui
  sono tempo reale su questo PC, non tempo CPU misurato da Cloudflare.

Entrambe le cose vanno misurate con un account (`wrangler deploy` più `wrangler tail`).

### 2. bcryptjs: **funziona com'è**

Ho provato il vero `api/_auth.js`:
- hash a costo 12, verifica corretta, password sbagliata rifiutata;
- un hash `$2a$` fatto da Node (formato Supabase) verifica nel Worker, e l'hash del Worker verifica in Node;
- un account sconosciuto viene confrontato con `DUMMY_HASH`.

La velocità è la stessa di Node: hash ~1,5–1,8 s e verifica ~1–2 s su questa macchina. È comunque
CPU pura, quindi sul piano gratuito (10 ms) il login non può funzionare; su quello a pagamento sì.

### 3. Anthropic: **funziona com'è** (SDK `@anthropic-ai/sdk` 0.128)

La richiesta parte da workerd, con l'immagine HEIC convertita in base64 come nell'estrazione, e
arriva all'API vera. Senza chiave l'API risponde `401 authentication_error` con un `request_id`.
La chiamata **con una chiave valida** va rifatta con `.dev.vars`.

### 4. Resend: **funziona com'è** (SDK `resend` 4)

Il vero `sendEmail()` di `api/_lib.js` gira nel Worker. Senza chiave si ferma prima della rete,
come previsto. L'SDK, chiamato con una chiave fittizia, raggiunge Resend, che risponde
`validation_error: API key is invalid`. L'invio **con una chiave valida** va rifatto con `.dev.vars`.

### 5. Il resto del codice server

Funzionano com'è, con `nodejs_compat` attivo:
- `node:crypto` (`createHash`, `randomBytes`), `Buffer` e i cookie;
- `process.env` letto a livello di modulo: `siteUrl()` vede `PUBLIC_SITE_URL` da `wrangler.toml`;
- `@supabase/supabase-js`, provato contro un server finto locale: select PostgREST, upload,
  download (Blob) e signed URL dello storage.

Tutti i 27 moduli di `../api` si importano, tranne quelli che passano da `_imageNormalize.js`
(`_imageNormalize.js` ed `extract-document.js`, per via di heic-decode e sharp). Il vero handler
`/api/auth/me` gira attraverso un adattatore `(req, res)` e risponde `500 MISSING_SUPABASE_ENV`,
come deve senza database.

**Da adattare per la migrazione** (non sono incompatibilità di librerie):
- La firma `handler(req, res)` di Vercel va trasformata in `fetch(request, env)`: un adattatore unico basta.
- `vercel.json`:
  - i `crons` (`open-tax-year`) diventano Cron Triggers;
  - gli `headers` vanno riportati;
  - il rewrite SPA si gestisce con Workers Static Assets.
- **Estrazione** (`maxDuration: 300` su Vercel). Su Workers il tempo reale di una richiesta HTTP non ha
  limite finché il client resta collegato, ma il **tempo CPU** sì, e `waitUntil` dopo la risposta dura
  al massimo 30 s. Il webhook di estrazione e `reprocess-client-year` (molte estrazioni di fila) vanno
  quindi spostati su **Queues** o **Workflows**.
- **Dimensione del Worker**: questo banco pesa ~3 MB compressi, compresa una seconda copia di libheif
  dentro heic-decode che nell'app non servirebbe. Il piano gratuito ammette 3 MB, quello a pagamento 10 MB.
- **Subrequest**: c'è un limite di chiamate esterne per richiesta (50 sul piano gratuito, molte di più
  su quello a pagamento). Un'estrazione fa diverse chiamate ad Anthropic e Supabase, e un reprocess molte
  di più: è un altro motivo per usare Queues. Il valore esatto va verificato sul piano scelto.

### Serve un account Cloudflare per esserne certi

- **Memoria a 128 MB** con foto da 12 MP o più, che non viene applicata in locale.
- **Tempo CPU reale** di conversione immagini e bcrypt, sul piano scelto.
- **Limiti di subrequest e di durata** dell'estrazione.
