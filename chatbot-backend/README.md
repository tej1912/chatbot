# RAG Chat Assistant

Retrieval-augmented support chatbot for a website. Free-tier friendly in
development, with a security/cost-control layer for production.

## How a message flows

```
widget ──POST /v1/session (captcha once)──► signed session token
widget ──POST /v1/chat + X-Session-Token──► FastAPI
   API layer : token check → per-IP/min → per-IP/day → per-session/min   (429 if exceeded)
   1 regex guard        2 smalltalk (canned, free)
   3 NeMo Guardrails    (optional LLM self-check, GUARDRAILS_MODE=nemo)
   4 follow-up → standalone question (1 tiny LLM call, only if history exists)
   5 embed (local) + answer cache
   6 hybrid retrieval: pgvector cosine + Postgres full-text, fused
   7 confidence below threshold → "not sure" WITHOUT calling the LLM
   8 global daily message/token cap (refuses before paying)
   9 tiered LLM (Groq) streamed over SSE
  10 output PII check → cache → Redis history → Postgres log
```

## Quick start (local)

1. `cp .env.example .env` and fill in:
   - `DATABASE_URL`: your Neon connection string (see `.env.example`; needs `postgresql+psycopg2://`, `sslmode=require` and `options=endpoint%3D<ep-id>`)
   - `GROQ_API_KEY` (console.groq.com)
   - `ADMIN_API_KEY` and `SESSION_SECRET`: generate each with `python -c "import secrets; print(secrets.token_urlsafe(32))"`
   - `CORS_ORIGINS`: the web portal and admin console addresses (e.g. `http://localhost:5173,http://localhost:5174`)
   - For quick local testing you may set `APP_ENV=development` (relaxes the secret checks, enables `/docs`)
2. `docker compose up -d --build` (one compose file: backend + Redis. The first build is slow because it compiles NeMo's
   `annoy` dependency and bakes the embedding model into the image. There is no local Postgres: the database is Neon.)
3. `curl http://localhost:8000/readyz` returns `{"status":"ok","database":true,...}`
4. Add content: open the admin console and upload your PDFs (Knowledge section), or use the API:
   ```powershell
   $h = @{ "X-Admin-Key" = "YOUR_ADMIN_API_KEY" }
   $body = @{ title="Pricing"; url="https://yoursite.com/pricing"; category="pricing"; text="# Free plan`n..." } | ConvertTo-Json
   Invoke-RestMethod -Uri http://localhost:8000/v1/ingest -Method Post -Headers $h -ContentType "application/json" -Body $body
   ```
   Re-running with the same `url` or title **replaces** the old version (no duplicates)
   and clears cached answers.
5. Frontend lives in the sibling folder `chatbot-frontend`: `chatbot/FloatingChatWidget.tsx` (React + TypeScript chat for your web portal) and `admin-console/` (separate React admin app). See its README.

After code changes: `docker compose up -d --build`. Your data lives in Neon, so rebuilding or deleting containers never touches it
(see `DB.md`). Redis only holds short-term data and can be wiped safely.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/session` | captcha (if configured) | issue signed session token |
| `POST /v1/chat` | `X-Session-Token` | SSE answer stream |
| `POST /v1/ingest` | `X-Admin-Key` | add/replace a document (text) |
| `POST /v1/ingest/pdf` | `X-Admin-Key` | add/replace from PDF (multipart, ≤20MB) |
| `GET /v1/documents` | `X-Admin-Key` | list documents + chunk counts |
| `DELETE /v1/documents/{id}` | `X-Admin-Key` | delete a document |
| `GET /v1/admin/stats?days=30` | `X-Admin-Key` | totals, daily series, cost by model (admin console) |
| `GET /v1/admin/conversations` | `X-Admin-Key` | search/filter/paginate saved questions and answers |
| `GET /v1/admin/pricing` | `X-Admin-Key` | model price table used for cost estimates |
| `GET /v1/admin/usage` | `X-Admin-Key` | today's AI messages/tokens vs daily caps |
| `DELETE /v1/admin/events?older_than_days=N` | `X-Admin-Key` | delete old conversations + analytics |
| `GET /v1/admin/usage` | `X-Admin-Key` | today's LLM messages + est. tokens vs caps |
| `GET /healthz` / `GET /readyz` | none | liveness / readiness (DB required, Redis = degraded) |

PDF upload: `curl.exe -X POST http://localhost:8000/v1/ingest/pdf -H "X-Admin-Key: KEY" -F "file=@C:\path\doc.pdf" -F "title=Terms" -F "category=legal"`

## Security model

- **Admin endpoints fail closed**: no `ADMIN_API_KEY` configured → they refuse everything.
- **Server-issued sessions**: clients can't invent session ids, so rotating ids
  doesn't dodge limits. Optional Cloudflare Turnstile is checked once per session.
- **Rate limits**: per session, per IP (minute + day), per IP for new sessions.
  Redis-backed; falls back to in-process counters if Redis is down.
- **Global daily spend cap** (`DAILY_LLM_MESSAGE_CAP`, `DAILY_TOKEN_CAP`):
  the hard stop on your LLM bill. Trade-off: a flood can exhaust the cap and
  block real users for the day — the per-IP limits and captcha are what keep
  that hard to do.
- **`APP_ENV=production` refuses to start** unless `ADMIN_API_KEY` (24+),
  `SESSION_SECRET` (32+) and a non-`*` `CORS_ORIGINS` are set. `/docs` is off in production.
- Debug retrieval info is dev-only (ignored in production).

### Guardrails: `basic` vs `nemo`

- `GUARDRAILS_MODE=basic` (default): regex only. Free, instant, catches literal attacks.
- `GUARDRAILS_MODE=nemo`: regex first, then **NVIDIA NeMo Guardrails**
  (open-source, free) runs an LLM self-check on every message (~200-400ms).
  The software is free; the **extra LLM call per message is not free** — by
  default it uses Groq's free tier, so it uses up your Groq rate limit twice as fast.
  Failures let the message through (the regex checks already passed). The check uses your `GROQ_API_KEY` and `openai/gpt-oss-20b`.
  The policy prompt lives in `app/core/nemo_guard.py`; it is built from
  the company constants in `app/core/brand.py` so on-topic questions
  about your products are never over-blocked.
  Only the current message is checked, not multi-turn attack chains.

## Deploy checklist (Railway / Render / Fly / any Docker host)

1. Push the repo to GitHub; deploy this folder (it uses the Dockerfile and honours `$PORT`).
2. Database is Neon (already created). Redis: add a Redis (or Upstash) and set `REDIS_URL`. Keys are prefixed `chatbot:`, so it can be shared.
3. Set env vars (see `.env.example`): `DATABASE_URL`, `REDIS_URL`, `APP_ENV=production`, `ADMIN_API_KEY`, `SESSION_SECRET`,
   `CORS_ORIGINS=https://yoursite.com,https://admin.yoursite.com`, `GROQ_API_KEY`, `WEB_CONCURRENCY=1` on 512MB hosts.
   In production the app refuses to start if a required value is missing, and prints which one.
4. Check `https://<backend>/readyz` shows `"database": true`.
5. Upload your documents in the admin console.
6. Set `VITE_CHAT_API_URL` in the web portal (and `VITE_API_BASE` in the admin console) to the backend URL and rebuild them.
   Watch the logs (`retrieval | ... confidence=`) for a week and tune `RETRIEVAL_CONFIDENCE_THRESHOLD`.

## Debugging what was retrieved

Every question logs the standalone question, confidence, and matched chunks:
`docker compose logs backend -f`.

## Tests

```bash
pip install -r requirements.txt pytest && python -m pytest
```
Runs without Postgres/Redis/LLM keys (all external calls stubbed; Redis-down
fallback is exercised for real). Not covered by tests: the SQL against a real
Postgres, real LLM output quality, the browser widget.

## Still to do (see docs)

- Fallback LLM provider if Groq fails (OpenAI-compatible, one extra setting block)
- Sentry (error alerts)
- Human handoff (the "not sure" message doesn't yet create a ticket/email)
- Alembic migrations (schema changes need manual SQL for now)
