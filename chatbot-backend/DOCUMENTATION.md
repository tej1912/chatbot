# RAG Chat Assistant — Full Project Documentation

A general-purpose, production-oriented **RAG (Retrieval-Augmented Generation) chat assistant**.
You feed it a website's documents (text or PDF); it answers visitors' questions **only from those documents**, streams the answer, and protects itself with guardrails, rate limits and spend caps. Currently configured for **SmartBusiness Solutions** (products: Check Printing, and Time & Attendance). It is built to be reused on many sites by ingesting different documents.

---

## Table of contents
1. [Big picture](#1-big-picture)
2. [Tech stack — what and why](#2-tech-stack--what-and-why)
3. [Repository map](#3-repository-map)
4. [The two core flows](#4-the-two-core-flows)
5. [File-by-file reference](#5-file-by-file-reference)
6. [Data model](#6-data-model)
7. [Configuration (.env) reference](#7-configuration-env-reference)
8. [Security model](#8-security-model)
9. [API reference](#9-api-reference)
10. [Running locally](#10-running-locally)
11. [Testing & evaluation](#11-testing--evaluation)
12. [Deployment & cost](#12-deployment--cost)
13. [Reusing it on another website](#13-reusing-it-on-another-website)
14. [Known limitations & roadmap](#14-known-limitations--roadmap)
15. [Troubleshooting (real problems we hit)](#15-troubleshooting-real-problems-we-hit)

---

## 1. Big picture

```
 Visitor browser                         Your server (Docker)                        External
┌──────────────────┐   HTTPS   ┌─────────────────────────────────────┐
│ React chat       │──────────▶│ FastAPI backend                     │
│ (chat bubble)    │◀──SSE─────│  guards → rewrite → embed → cache → │──▶ Groq (LLM)       
└──────────────────┘           │  hybrid search → confidence → LLM   │
                               └───────┬───────────────┬─────────────┘
                                       │               │
                              ┌────────▼───────┐ ┌─────▼──────┐
                              │ Postgres+pgvector│ │   Redis    │
                              │ docs, chunks,    │ │ history,   │
                              │ vectors, chat log│ │ cache,     │
                              └──────────────────┘ │ rate limits│
                                                   └────────────┘
 Admin (you) ── X-Admin-Key ──▶ /v1/ingest, /v1/ingest/pdf, /v1/documents
```

**Core idea:** the LLM never answers from its own memory. We retrieve the most relevant chunks of *your* documents, paste them into the prompt as "context", and instruct the model to answer only from that. If retrieval confidence is too low, we skip the LLM and say "I'm not sure" — cheaper and safer than hallucinating.

**Design principles**
- **Cheap first:** regex guard → smalltalk → cache → retrieval *before* any paid LLM call.
- **Fail safe:** Redis down → degrade, don't crash. LLM down → friendly message. Embedding fails during ingest → old document is kept.
- **Config, not code:** models, providers, limits, guardrails are all environment variables.
- **Secure by default in production:** the app refuses to start with weak secrets.

---

## 2. Tech stack — what and why

| Piece | Choice | Why |
|---|---|---|
| API framework | **FastAPI** + Uvicorn | Async-capable, automatic validation (Pydantic), native streaming responses, easy tests. |
| Vector store | **Postgres + pgvector** | One database for documents, vectors and chat log; no separate vector service to run/pay for; supports SQL filters (category) and full-text search in the same query engine. Chroma/Pinecone add another moving part with little benefit at this scale. |
| Keyword search | **Postgres full-text** (`to_tsvector`, `ts_rank_cd`) | Catches exact words/names/numbers that embeddings miss ("plan names", "30 days"). |
| Embeddings | **BAAI/bge-small-en-v1.5** via **fastembed** (local, 384-dim) | Free, no API key, no rate limits, runs on CPU (ONNX, no torch). Baked into the Docker image so there is no download at runtime. Hosted providers (OpenAI/Voyage) remain as options. |
| LLM | **Groq** (`openai/gpt-oss-20b` fast, `openai/gpt-oss-120b` complex) | Groq is fast and cheap. A router chooses the fast or complex model per question. |
| Cache / state | **Redis** | Conversation history, answer cache, sliding-window rate limits, daily spend counters. Fast, TTL support, atomic counters. An in-process fallback keeps the bot alive if Redis drops. |
| Guardrails | **Regex layer** + optional **NVIDIA NeMo Guardrails** self-check | Regex is free and instant; NeMo catches subtle jailbreaks using a tiny LLM check (free software, small extra LLM call). |
| PDF text | **pdfplumber** | Good text extraction for text-based PDFs. (Scanned PDFs need OCR — not included.) |
| Retries | **tenacity** | Retry embedding calls with exponential backoff. |
| Frontend | **React + TypeScript** | `FloatingChatWidget.tsx` for the web portal (Tailwind + lucide-react) and a separate Vite admin console. |
| Packaging | **Docker + docker-compose** | Reproducible: Redis + backend with one command. The database is Neon. |
| Tests | **pytest** (92 tests) | All external services stubbed, so tests run offline and fast. |
| Eval | **RAGAS** (skeleton) | Measures faithfulness / answer relevancy against a golden Q&A set. |

---

## 3. Repository map

```
chatbot-backend/        <- this project (API, data, AI)
├── .env.example            template for all configuration
├── .gitignore
├── docker-compose.yml      db (pgvector) + redis + backend (dev)
├── Dockerfile              production image (model baked in, non-root)
├── .dockerignore
├── requirements.txt        pinned Python deps
├── README.md  PROJECT.md  DOCUMENTATION.md (this file)  TESTING.md
├── app/
│   ├── main.py         app factory, startup, middleware, routers
│   ├── config.py       all settings from environment
│   ├── api/            HTTP layer (thin)
│   │   ├── chat.py     /v1/session, /v1/chat
│   │   ├── ingest.py   /v1/ingest, /v1/ingest/pdf, /v1/documents
│   │   └── health.py   /healthz, /readyz, /v1/admin/usage
│   ├── services/       business logic (the "brain")
│   │   ├── chat_service.py
│   │   └── ingest_service.py
│   ├── core/           reusable building blocks
│   │   ├── chunking.py  embeddings.py  retrieval.py  llm.py
│   │   ├── guardrails.py  nemo_guard.py  cache.py  security.py
│   │   └── tracing.py   (per-message record that feeds the dashboard)
│   ├── db/             models.py, session.py
│   └── schemas/chat.py request/response validation
├── tests/              7 test modules + conftest (92 tests)
├── eval/               golden_dataset.json, ragas_eval.py
├── sample-data/        SmartBusiness_Overview.md / .pdf (sample knowledge + test PDF)
└── docs/               architecture.png / .svg

chatbot-frontend/       <- separate project, npm only (no Docker)
├── chatbot/FloatingChatWidget.tsx   — chat component for the web portal
└── admin-console/                   — React + TS admin app (Vite) + README.md
```

The two folders are independent. The backend runs in Docker with its own `.env`; the frontend is plain static files (no Docker, no build) whose only setting is the backend URL (`apiBase` in `index.html`). They only talk over HTTP: the widget calls the backend at `apiBase`, and the backend allows the widget's origin through `CORS_ORIGINS`.

**Layering rule:** `api/` only parses requests and returns responses → `services/` orchestrates → `core/` does one specific job each → `db/` talks to Postgres. This keeps each file small and testable.

---

## 4. The two core flows

### 4.1 Ingest flow (adding knowledge)
```
POST /v1/ingest (text) or /v1/ingest/pdf (file)      [needs X-Admin-Key]
  1. PDF only: pdfplumber extracts text page by page, each tagged "# Page N"
  2. chunking.chunk_document(): split into sections at "# headers"
        FAQ "Q:/A:" pairs stay whole; other text → recursive split ~500 tokens, ~15% overlap
        every chunk remembers its section header (header_context)
  3. Build embed text = "<header>\n<chunk>" ; embed in batches of 64 (local model)
  4. Only AFTER embeddings succeed: delete the old version of this document
        (match by url, else by title) and insert new Document + Chunk rows — one transaction
  5. Bump the Redis cache version → all cached answers become stale instantly
```
*Why embed before deleting?* If embedding fails, the previous version of the document survives.
*Why prepend the header?* A chunk saying "30 days" means little alone; "Refund Policy\n30 days…" retrieves correctly.

### 4.2 Chat flow (answering)
```
POST /v1/chat  (X-Session-Token)
 API layer:  verify signed token → 401 if bad
             rate limits: per-IP/min, per-IP/day, per-session/min → 429
 chat_service.handle_chat():
  1. Regex guard (injection / too long)            → REFUSAL_MESSAGE
  2. Smalltalk (hi / thanks / bye)                  → canned reply, no cost
  3. NeMo guard (if GUARDRAILS_MODE=nemo)           → REFUSAL_MESSAGE
  4. Load last turns from Redis; rewrite follow-up into a standalone question
     ("how many days is that?" → "how many days is the refund window?")
  5. Embed the standalone question
  6. Answer cache lookup (key = version + category + coarse embedding) → hit = stream cached answer
  7. Hybrid retrieval: dense (pgvector cosine, top 20) + sparse (full-text, top 20)
     → Reciprocal Rank Fusion → (optional Cohere rerank) → top 5
  8. confidence = best dense cosine similarity. < threshold (0.40) → FALLBACK_MESSAGE, no LLM call
  9. route_tier(): "fast" or "complex" model
 10. reserve_llm_budget(): global daily message/token caps → BUDGET_MESSAGE if exceeded
 11. (dev + debug flag) emit retrieved chunks as an SSE "debug" event
 12. Stream LLM tokens to the browser (SSE). Upstream error → friendly message
 13. Output guard (PII-like patterns); only clean answers are cached
 14. Save turn to Redis history and to Postgres (conversation_messages)
```

---

## 5. File-by-file reference

### 5.1 Root files
| File | Purpose |
|---|---|
| `.env.example` | Every setting with comments. Copy to `.env`. Never commit `.env`. |
| `.gitignore` | Keeps `.env`, venvs, caches out of git. |
| `docker-compose.yml` | Two services. **redis**: `redis:7-alpine` (volume `redisdata`). **backend**: builds from this folder, reads `.env` (including the Neon `DATABASE_URL`), sets `REDIS_URL` to the redis service, runs the Dockerfile's production CMD. There is no local Postgres: the database is Neon. |
| `README.md` / `PROJECT.md` | Quick start / earlier overview. |

### 5.2 Root files (Dockerfile, requirements, scripts)
**`Dockerfile`** — `python:3.11-slim`; installs gcc/g++ (needed to build `annoy`, a NeMo dependency) and libpq; installs requirements; **downloads the embedding model into `/models` at build time** (so containers start fast and work on ephemeral hosts); runs as non-root user (uid 10001); CMD runs uvicorn on `$PORT` with `$WEB_CONCURRENCY` workers and `--proxy-headers` so rate limits see real client IPs. Each worker loads the model (~300 MB) → use 1 worker on small hosts.

**`requirements.txt`** — pinned versions for reproducibility. Notable pins: `httpx==0.27.2` (newer httpx breaks the Groq SDK with `unexpected keyword argument 'proxies'`), `psycopg2-binary 2.9.10` (has wheels for Python 3.13 on Windows), `nemoguardrails 0.24.1`, `fastembed`, `pdfplumber`.


### 5.3 app/ (entry point and config)
**`main.py`** — builds the FastAPI app.
- *Lifespan startup:* runs `production_problems()` — in production raises `RuntimeError` (app won't start) if `ADMIN_API_KEY` < 24 chars, `SESSION_SECRET` < 32 chars, or CORS is `*`; in dev only warns. Calls `init_db()` which takes a Postgres **advisory lock** (so multiple workers don't race), creates the `vector` extension and all tables. Warms up NeMo in a background thread if enabled.
- Disables `/docs`, `/redoc`, OpenAPI in production.
- CORS limited to configured origins; methods GET/POST/DELETE/OPTIONS; headers `Content-Type`, `X-Session-Token`, `X-Admin-Key`.
- Security-headers middleware (nosniff, frame-deny, etc.).
- Registers routers `health`, `chat`, `ingest`. Version `0.2.0`.

**`config.py`** — one `Settings` class (pydantic-settings). Everything is env-driven with safe defaults. Helper properties: `is_production`, `cors_origin_list`, `effective_session_secret` (random per-process fallback in dev), `effective_guard_api_key` (falls back to `GROQ_API_KEY`), and `production_problems()`. See §7 for every variable.

### 5.4 app/api/ (HTTP layer)
**`chat.py`**
- `POST /v1/session` — rate-limit new sessions per IP, verify Turnstile (if configured), issue a **server-signed** session token. The client cannot choose its own id.
- `POST /v1/chat` — verify token (401), apply 3 rate limits (429 + `Retry-After`), then stream `handle_chat()` as Server-Sent Events. Newlines in text are escaped as `\n` so SSE framing doesn't break; debug data goes in a separate `event: debug`; ends with `event: done`.

**`ingest.py`** — all routes require `X-Admin-Key`.
- `POST /v1/ingest` (JSON: title, text, url, category, replace)
- `POST /v1/ingest/pdf` (multipart; `.pdf` only; max 20 MB; scanned/image PDFs rejected with a clear message)
- `GET /v1/documents` — list with chunk counts
- `DELETE /v1/documents/{id}`

**`health.py`**
- `/healthz` liveness (no dependencies).
- `/readyz` readiness: DB down → 503 "down"; Redis down → "degraded" (still 200).
- `/v1/admin/usage` (admin) — today's LLM message count and estimated tokens vs caps.

### 5.5 app/services/ (business logic)
**`chat_service.py`** — `handle_chat()` generator implementing flow 4.2. Contains user-facing message constants: `REFUSAL_MESSAGE`, `GENERIC_ERROR_MESSAGE`, `UPSTREAM_BUSY_MESSAGE` (shown on *any* LLM failure, so it can be misleading — check logs), `BUDGET_MESSAGE`. `DEBUG_SENTINEL` marks debug payloads (ignored in production). Persistence failures roll back and never break the answer.

**`ingest_service.py`** — `ingest_document()` (chunk → embed in batches of 64 → replace old → insert → bump cache version), `delete_document()`, `extract_pdf_text()`, `ingest_pdf()`.

### 5.6 app/core/ (building blocks)
**`chunking.py`** — Section-aware recursive chunker. Splits on Markdown headers; FAQ pairs are kept whole; other text is split by paragraph → line → sentence → word to ~2000 chars (≈500 tokens) with 15% overlap. Returns `ChunkResult(content, header_context)`. Chosen over fixed-size splitting because chunks stay topically coherent and always carry their true section header.

**`embeddings.py`** — `embed_texts()` / `embed_query()`. Provider switch: `local` (default fastembed singleton, lazy-loaded), `openai`, `voyage`. Retries 3× with exponential backoff.

**`retrieval.py`** — hybrid search. Dense: pgvector cosine distance → similarity. Sparse: up to 8 alphanumeric tokens (≥3 chars) OR-ed into a `tsquery` (the regex restriction means user text can never inject tsquery operators). Fusion: **RRF** `score = Σ 1/(60 + rank)`. Optional Cohere rerank. `search()` returns `(chunks, confidence)` where **confidence = best raw cosine similarity** (RRF scores are only for ordering, not an absolute measure).

**`llm.py`** — LLM router. `SYSTEM_PROMPT` (answer only from context, short, light markdown), `MAX_ANSWER_TOKENS=350`, `route_tier()` (complex if question > 220 chars, low confidence, or words like *compare / explain why / difference between / recommend*), `stream_completion()` → `_stream_groq`, `complete_short()` for small non-streamed calls, `rewrite_standalone()` (no history → no LLM call; any failure → original question), `estimate_tokens()` (~4 chars/token, for spend caps).

**`guardrails.py`** — Layer 1, free regex: prompt-injection patterns ("ignore previous instructions", "you are now…", "reveal your prompt", "developer mode", "DAN"…), length limit 4000, output PII patterns (SSN-like, card-like), smalltalk canned replies, `FALLBACK_MESSAGE`.

**`nemo_guard.py`** — Layer 2, optional NeMo Guardrails "self check input" rail (`GUARDRAILS_MODE=nemo`). Sends a tiny Yes/No prompt ("should this be blocked?") to Groq `openai/gpt-oss-20b` using `GROQ_API_KEY`. Because NeMo is async, a **dedicated event-loop thread** hosts it. `gpt-oss` is a reasoning model, so `reasoning_effort=low` and `max_tokens=40`. On error/timeout (6 s) the message is let through (the regex layer already passed it). The policy text is built from the constants in `app/core/brand.py`. The extra settings (`guard_llm_*`, `guard_fail_mode`) still exist in `config.py` with working defaults, but are not in `.env`.

**`cache.py`** — everything Redis, all failure-safe:
- *History:* last 6 messages per session, TTL `SESSION_TTL_SECONDS`.
- *Answer cache:* key = SHA-256 of (cache version, category, first 32 embedding dims rounded to 2 decimals). Effectively near-exact-match caching. TTL 1 h. `bump_cache_version()` invalidates all.
- *Rate limit:* sliding window with a sorted set (`check_rate_limit`).
- *Budget:* `reserve_llm_budget()` increments daily message/token counters and refuses when caps are hit; `get_budget_usage()`.
- *Fallback:* if Redis is unreachable, in-process dicts are used (per-worker, looser) and warnings are logged at most every 30 s.

**`tracing.py`** — a small in-memory `Trace` per chat message: outcome tag (`answered`, `cache_hit`, `low_confidence_fallback`, `blocked_regex`, `blocked_nemo`, `smalltalk`, `budget_exhausted`, `error_*`), retrieval confidence, model/tier, estimated tokens and latency. `chat_service` turns it into one `chat_events` row for the admin dashboard. No external service.

**`security.py`** — `require_admin` (constant-time compare; 503 if no key configured → fails closed), `client_ip`, signed tokens `v1.<session_id>.<expiry>.<hmac-sha256>` (`issue_session`, `verify_session_token`), `verify_turnstile` (fails closed when configured and the check fails).

### 5.7 app/db/ and schemas/
**`db/session.py`** — SQLAlchemy engine (`pool_pre_ping`), `SessionLocal`, `Base`, `get_db()` dependency.
**`db/models.py`** — see §6.
**`schemas/chat.py`** — `SessionRequest`, `ChatRequest` (message 1–2000 chars, optional category, `debug`), `IngestRequest` (text up to 2 MB, `replace` flag). Validation happens before any logic runs.

### 5.8 The chat widget (separate folder)
The browser widget is its own project: `chatbot-frontend` (own README; React + TypeScript, npm only, no Docker). From the backend's point of view it is just a client that calls `POST /v1/session` and `POST /v1/chat` with the `X-Session-Token` header. The backend only needs `CORS_ORIGINS` to include the widget's origin in production.

### 5.9 tests/ (92 tests)
| File | Covers |
|---|---|
| `conftest.py` | Sets safe test env, points Redis to a dead port (exercises fallback), resets counters, loosens limits per test. |
| `test_api.py` | Endpoints: sessions, auth, ingest, rate-limit responses, SSE framing. |
| `test_cache_fallback.py` | Redis-down behavior: history, limits, budgets in-process. |
| `test_chat_service.py` | The whole chat pipeline with stubbed LLM/embeddings/retrieval: fallback, cache, budget, guards, errors. |
| `test_chunking.py` | Headers, FAQ pairs, long sections, PDF pages, preamble. |
| `test_guardrails.py` | Injection/PII/smalltalk patterns. |
| `test_health.py` | `/healthz`. |
| `test_tracing.py` | The per-message record collects outcome, confidence and model facts. |
| `test_security.py` | Token sign/verify/tamper/expiry, admin key, production validation. |

### 5.10 eval/ and sample-data/
**`golden_dataset.json`** — question + ground-truth pairs (6 SmartBusiness Solutions questions; add more as your documents grow).
**`ragas_eval.py`** — asks each question through the real API (fresh session per question), scores faithfulness and answer relevancy, fails below 0.7. ⚠️ `contexts` are empty, so it is a skeleton; wire retrieved chunks (via the debug event) for real scores.
**`sample-data/SmartBusiness_Overview.md` / `.pdf`** — customer-facing knowledge for SmartBusiness Solutions (products, roles, workflows, data protection, onboarding, FAQ), written from the client system overview. The `.pdf` is for testing `/v1/ingest/pdf`; the `.md` (with `#` headers) chunks best for `/v1/ingest`. Internal delivery notes from the client overview (repository scope, open client decisions) are deliberately **not** included — do not feed internal documents to a public chatbot.

---

## 6. Data model

| Table | Columns | Notes |
|---|---|---|
| `documents` | id (uuid), title, url, category (indexed), created_at | One row per ingested source. |
| `chunks` | id, document_id → documents, content, header_context, **embedding vector(EMBEDDING_DIM)**, created_at | Cascade-deleted with the document. Index on document_id. |
| `conversation_messages` | id, session_id (indexed), role, content, retrieval_score, created_at | Permanent chat log for analytics/eval. Redis holds only the hot copy. |

⚠️ The `vector(N)` size is fixed when the table is created. Changing embedding model/dimension requires recreating the DB (drop the `chunks` table in Neon, **which deletes the embeddings**) and re-ingesting. Don't use `-v` routinely.

---

## 7. Configuration (.env) reference

| Group | Variables | Meaning |
|---|---|---|
| Database | `DATABASE_URL` | Neon connection string (`postgresql+psycopg2://...?sslmode=require&options=endpoint%3D<ep-id>`). |
| Redis | `REDIS_URL` | Local or Upstash. |
| Mode | `APP_ENV` | `development` / `production` (strict startup checks, docs off, debug ignored). |
| Security | `ADMIN_API_KEY`, `SESSION_SECRET`, `CORS_ORIGINS`, `TURNSTILE_SECRET` | Generate secrets with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| LLM | `GROQ_API_KEY`, `GROQ_FAST_MODEL`, `GROQ_COMPLEX_MODEL`, `LLM_TIMEOUT_SECONDS` | Groq only. |
| Embeddings | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `OPENAI_API_KEY`, `VOYAGE_API_KEY` | Keep dim equal to the model's output. |
| Retrieval | `RETRIEVAL_CONFIDENCE_THRESHOLD` (0.40), `RERANK_ENABLED`, `COHERE_API_KEY` | Tune threshold using the `retrieval \| confidence=` log lines. |
| Guardrails | `GUARDRAILS_MODE` (`basic`/`nemo`) | |
| Limits | `RATE_LIMIT_PER_MINUTE` 20, `RATE_LIMIT_IP_PER_MINUTE` 30, `RATE_LIMIT_IP_PER_DAY` 300, `RATE_LIMIT_NEW_SESSION_PER_MINUTE` 10, `DAILY_LLM_MESSAGE_CAP` 3000, `DAILY_TOKEN_CAP` 2,000,000, `SESSION_TTL_SECONDS` 1800, `SESSION_TOKEN_TTL_SECONDS` 43200 | The daily caps are your hard bill ceiling. |
| Runtime | `WEB_CONCURRENCY` | Workers in production container. |

---

## 8. Security model

| Threat | Defence |
|---|---|
| Strangers using admin endpoints | `X-Admin-Key`, constant-time compare, fails closed. |
| Faking/rotating sessions to dodge limits | Server-issued HMAC-signed tokens; client can't choose ids. |
| Bots minting sessions | Per-IP new-session limit + optional Turnstile. |
| Flooding | Per-session, per-IP/min, per-IP/day limits (Redis sliding window). |
| Running up the LLM bill | Global daily message & token caps checked *before* the LLM call. |
| Prompt injection / jailbreak | Regex layer + optional NeMo LLM check + system prompt "context only" + output PII check. |
| Cross-site abuse | CORS allow-list (enforced in production). |
| XSS through model output | Widget escapes HTML before rendering markdown. |
| SQL/tsquery injection | ORM parameters; tsquery tokens limited to `[a-z0-9]`. |
| Weak deployment config | Production refuses to start with weak secrets/open CORS. |
| Container compromise blast radius | Non-root user, docs endpoints off in production. |

Remaining honest gaps: regex/LLM guards are not perfect; the widget token is in `localStorage` (normal for public chat); no per-tenant isolation.

---

## 9. API reference

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/session` | none (Turnstile optional) | Returns `{session_id, token, expires_in}` |
| `POST /v1/chat` | `X-Session-Token` | Body `{message, category?, debug?}` → SSE stream of `data:` lines, `event: debug` (dev), `event: done` |
| `POST /v1/ingest` | `X-Admin-Key` | Body `{title, text, url?, category?, replace?}` |
| `POST /v1/ingest/pdf` | `X-Admin-Key` | multipart `file`, `title?`, `category?` |
| `GET /v1/documents` | `X-Admin-Key` | List documents with chunk counts |
| `DELETE /v1/documents/{id}` | `X-Admin-Key` | Remove a document |
| `GET /v1/admin/stats?days=30` | `X-Admin-Key` | totals, daily series, cost by model (admin console) |
| `GET /v1/admin/conversations` | `X-Admin-Key` | search/filter/paginate saved questions and answers |
| `GET /v1/admin/pricing` | `X-Admin-Key` | model price table used for cost estimates |
| `GET /v1/admin/usage` | `X-Admin-Key` | today's AI messages/tokens vs daily caps |
| `DELETE /v1/admin/events?older_than_days=N` | `X-Admin-Key` | delete old conversations + analytics |
| `GET /v1/admin/usage` | `X-Admin-Key` | Today's usage vs caps |
| `GET /healthz`, `/readyz` | none | Liveness / readiness |

Windows PowerShell tip: use `curl.exe` (plain `curl` is an alias for `Invoke-WebRequest`) or `Invoke-RestMethod`.

---

## 10. Running locally

```powershell
copy .env.example .env          # then edit: GROQ_API_KEY, ADMIN_API_KEY
docker compose up --build       # first build downloads the embedding model
# ingest something
curl.exe -X POST http://localhost:8000/v1/ingest -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" -d "{\"title\":\"FAQ\",\"text\":\"# Refunds\nFull refunds within 30 days.\"}"
# start the widget from the frontend folder (see its README), open http://localhost:8080
```
Useful: `docker compose logs -f backend` (look for `retrieval | ... confidence=`), `docker compose down` (data is safe: it lives in Neon).

---

## 11. Testing & evaluation

```powershell
python -m venv .venv ; .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest
```
All 92 tests use stubs — no Docker, API keys or internet needed. Run them after every code change and before deploying. For answer quality: fill `eval/golden_dataset.json` with real Q&A, start the stack, and run `python eval/ragas_eval.py` (needs `pip install ragas datasets` and an LLM key for RAGAS judging).

---

## 12. Deployment & cost

**Typical production layout:** backend on Railway/Render/Fly (Docker), Postgres with pgvector on Neon or Supabase, Redis on Upstash, widget script served from your site or a CDN. Set `APP_ENV=production`, strong `ADMIN_API_KEY`/`SESSION_SECRET`, `CORS_ORIGINS=https://yoursite.com`, Turnstile keys, `WEB_CONCURRENCY=1` on small plans.

**Rough monthly cost (small site):** hosting ~$5–10 · Postgres free–$20 · Redis free–$10 · LLM the main variable. Order of magnitude **$15–45/month**; the daily caps bound the LLM part. Free-tier path for dev: Groq free + local embeddings + local Docker = $0.

**Temporary public test:** VS Code port forwarding (Dev Tunnels) of port 8000 → put that URL in `apiBase` (no trailing slash) and add the test site's origin to `CORS_ORIGINS`.

---

## 13. Reusing it on another website
1. Deploy (or reuse) a backend instance. For now: **one deployment per site** (no multi-tenancy).
2. Ingest that site's content (text/PDF, with `# headers` for better chunks).
3. Edit the company constants in `app/core/brand.py` (they drive the refusal message, greeting, system prompt and NeMo policy) and the chat component texts. Optionally tune the tone in `SYSTEM_PROMPT` (`llm.py`).
4. Set `CORS_ORIGINS` to that site; add the `RAG_CHAT_CONFIG` + `<script>` to its pages.
5. Tune `RETRIEVAL_CONFIDENCE_THRESHOLD` from real logs.

---

## 14. Known limitations & roadmap
- **No error alerts yet** (Sentry not added). The admin console shows usage, cost and unanswered questions.
- **Single tenant:** one knowledge base per deployment (category filter helps but is not isolation).
- **Answer cache** is near-exact-match, not truly semantic.
- **PDF OCR** unsupported (scanned PDFs rejected).
- **English-focused** embedding model; multilingual needs another model (and new DB).
- **No migrations** (Alembic); schema changes need manual handling.
- **Single LLM provider per tier** — no automatic failover; `UPSTREAM_BUSY_MESSAGE` hides the real cause (see logs).
- **Eval harness** is a skeleton (empty contexts).
- Not built yet: human handoff, CI pipeline, Sentry/Metabase dashboards, multi-tenant mode.

---

## 15. Troubleshooting (real problems we hit)
| Symptom | Cause → fix |
|---|---|
| `curl -X` fails in PowerShell | Alias for Invoke-WebRequest → `curl.exe` or `Invoke-RestMethod`. |
| `expected 512 dimensions, not 1024` | `EMBEDDING_DIM` ≠ model → fix value, drop the `chunks` table in Neon, re-ingest. |
| Voyage 429 | Hosted free limit → use local embeddings (default now). |
| Confidence `0.000`, empty answers | `chunks` table empty after `down -v` → re-ingest. |
| Always "rate-limited by an upstream service" | Any LLM error; real one in logs. We saw `Client.__init__() got an unexpected keyword argument 'proxies'` → `httpx==0.27.2` pin. |
| Groq model not found | Old Groq models retired 2026-08-16 → use `openai/gpt-oss-20b` / `-120b`. |
| `//v1/session` 404 | Trailing slash in `apiBase` (widget now strips it). |
| `pytest` not recognised | Activate the venv; use `python -m pytest`. |
| psycopg2 build error on Windows | Use `psycopg2-binary 2.9.10`. |
| Postgres log spam `database "raguser" does not exist` | Healthcheck missing `-d` (fixed). |
| Replies blank | LLM/embedding call failed silently → check backend logs; errors now return friendly text. |
| App won't start in production | Weak/missing `ADMIN_API_KEY` (<24), `SESSION_SECRET` (<32) or `CORS_ORIGINS=*` — by design. |


## Admin analytics & cost (added in 0.3.0)
Every chat turn writes one row to the new table **`chat_events`** (time, session, outcome, question, answer, confidence, model, tier, tokens in/out, estimated cost USD, latency). The table is created automatically on startup (`create_all`), existing data is untouched. The admin console (frontend `admin/`) reads it through `/v1/admin/*`.

- **Cost is an estimate**: tokens are counted as about 4 characters each and priced from `app/core/pricing.py` (override with `MODEL_PRICES_JSON`). Guardrail and follow-up-rewrite calls are not counted, so the provider bill will be somewhat higher. Cache hits, small talk and blocked messages cost 0.
- Conversations contain what visitors typed. Use `DELETE /v1/admin/events?older_than_days=N` (or the Settings page in the console) to apply your retention policy, and mention it in your privacy policy.
