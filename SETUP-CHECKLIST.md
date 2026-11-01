# Checklist di messa online — un passo alla volta

Ordine: **in locale → Neon → Cloudflare → Resend → dominio → prova completa**.
L'app funziona solo con il backend collegato: se il Worker non ha `DATABASE_URL`, mostra la pagina
«Il portale non è configurato».
Il passaggio dai dati di Supabase (database e file) è in **docs/MIGRAZIONE-CLOUDFLARE.md**.

---

## Passo 0 — Provare in locale (nessun account necessario)

```bash
npm install
npm run build        # test + front-end + controllo end-to-end nel runtime Workers
npm run dev:worker   # http://127.0.0.1:8787
```

- [ ] `npm run build` finisce con `20/20 checks passed`
- [ ] Facoltativo: copia `.dev.vars.example` in `.dev.vars` e metti `ANTHROPIC_API_KEY` /
      `RESEND_API_KEY` per provare estrazione ed e-mail vere

---

## Passo 1 — Neon (database)

- [ ] console.neon.tech → **New project**, regione europea (es. *AWS Europe Central 1 — Frankfurt*)
- [ ] **Connect** → ruolo `neondb_owner` → copia la *connection string*
- [ ] `DATABASE_URL="postgresql://..." npm run db:migrate` → deve applicare 54 migrazioni
- [ ] `DATABASE_URL="postgresql://..." npm run db:migrate -- --status` → tutte `applied`

---

## Passo 2 — Cloudflare (Worker, R2, coda, cron)

- [ ] Account con **Workers Paid** (serve per Queues e per i limiti CPU di `wrangler.toml`)
- [ ] R2 attivato (dash → R2 → *Activate*)
- [ ] `npx wrangler login`
- [ ] Risorse:

```bash
npx wrangler r2 bucket create hornung-client-documents
npx wrangler queues create hornung-extraction
npx wrangler queues create hornung-extraction-dlq
```

- [ ] Segreti (ognuno chiede il valore, non finisce in nessun file):

| Segreto | Valore |
|---|---|
| `DATABASE_URL` | connection string di Neon |
| `FILES_SIGNING_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `RESEND_API_KEY` | resend.com → API Keys |
| `CRON_SECRET` | `openssl rand -base64 32` (solo per chiamare `/api/open-tax-year` a mano) |
| `OWNER_EMAIL` | (facoltativo) e-mail che diventa specialista al primo accesso |
| `NOTIFY_BCC` | (facoltativo) copia delle e-mail allo studio |

```bash
npx wrangler secret put DATABASE_URL   # e così via per ognuno
```

- [ ] In `wrangler.toml` → `[vars]`: `PUBLIC_SITE_URL` (URL del sito, senza `/` finale),
      `RESEND_FROM`, `AUTO_OPEN_MONTH_DAY`
- [ ] `npm run deploy`
- [ ] Workers & Pages → `hornung-crm` → **Settings → Triggers**: il cron `0 6 1 * *` è presente
- [ ] Facoltativo ma consigliato: misura la memoria delle immagini con
      `workers/image-memory-probe` (istruzioni nel file `worker.js`)

---

## Passo 3 — Account dello specialista

- [ ] Registrati su `https://<sito>/register` con l'e-mail dello studio
      (oppure imposta `OWNER_EMAIL`: diventa specialista da sola al primo accesso)
- [ ] Neon → SQL Editor: `select public.promote_to_specialist('hornungconsulting@gmail.com');`
      deve rispondere `OK — ... is now a specialist of hornung_crm.`

---

## Passo 4 — Resend

- [ ] API key creata
- [ ] Dominio mittente verificato (es. `hornungconsulting.ch`), oppure `onboarding@resend.dev` per le prove
- [ ] `RESEND_FROM` in `wrangler.toml`, es. `Hornung Consulting <no-reply@hornungconsulting.ch>`

---

## Passo 5 — Dominio

- [ ] Workers & Pages → `hornung-crm` → **Settings → Domains & Routes → Add → Custom domain**
- [ ] Aggiorna `PUBLIC_SITE_URL` e rifai `npm run deploy`

---

## Passo 6 — Prova completa (end-to-end)

- [ ] Creo un cliente di prova (con una mia e-mail) → arriva l'invito
- [ ] Attivo la password dal link → entro nel portale cliente
- [ ] Compilo "I miei dati" e salvo
- [ ] Lo specialista apre l'anno fiscale e imposta la checklist documenti
- [ ] Carico un PDF e una foto dal telefono come cliente → lo specialista li vede, la foto è un JPEG
- [ ] Dopo qualche minuto i dati estratti compaiono nel Tax Summary ("Riprova estrazione" funziona)
- [ ] Lo specialista carica la dichiarazione e mette lo stato su "Completata" con notifica
- [ ] Arriva l'e-mail con l'elenco dei documenti
- [ ] `curl -H "Authorization: Bearer <CRON_SECRET>" https://<dominio>/api/open-tax-year`
      risponde `{ taxYear, created, skipped }`
