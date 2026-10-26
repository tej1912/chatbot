# Database guide (Postgres on Neon, or the local Docker one)

Everything the chatbot stores, where it lives, and when it is deleted.

## 1. Which database, what name?
- **The app never creates the database itself.** You (or Neon) create it. The app only creates the *tables* inside it.
- **The database name is whatever is in `DATABASE_URL`**, the part after the last `/` and before `?`:
  `...neon.tech/`**`demo_db`**`?sslmode=require` -> database name `demo_db`. (Neon's default is `neondb`; locally in Docker it is `ragchat`.)
- In the Neon dashboard: open your **Project** -> **Branch** (usually `main`) -> **Tables** to see the tables, or **SQL Editor** to run queries. The database name is shown at the top of the SQL Editor / under **Databases**.
- Tables are created automatically the first time the backend starts (`init_db()` in `app/main.py`). If you see no tables, the backend has not started successfully against that database yet.

## 2. What gets created
One PostgreSQL **extension** and **4 tables** (+ their indexes). Nothing else.

| # | Name | Type | Purpose |
|---|---|---|---|
| - | `vector` | extension (pgvector) | lets Postgres store and compare embeddings |
| 1 | `documents` | table | one row per uploaded document (a PDF or pasted text) |
| 2 | `chunks` | table | the searchable pieces of each document + their embedding |
| 3 | `conversation_messages` | table | saved chat history (every question and answer) |
| 4 | `chat_events` | table | one row per visitor message for the admin dashboard (outcome, cost, speed) |

Relationship: `documents` 1 --- many `chunks` (`chunks.document_id` -> `documents.id`). The other two tables are standalone and linked to a visitor only by `session_id`, a random id, not a login.

### 2.1 `documents`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID, primary key | |
| `title` | text, required | shown in the admin Knowledge page |
| `url` | text, optional | source link |
| `category` | text, optional, **indexed** | used to filter answers by category |
| `created_at` | timestamp (UTC) | |

### 2.2 `chunks`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID, primary key | |
| `document_id` | UUID -> `documents.id`, **indexed** | |
| `content` | text | the text of the piece, about a section or paragraph |
| `header_context` | text, optional | section heading, helps search |
| `embedding` | vector(384) | the meaning of the text as 384 numbers (about 1.5 KB each) |
| `created_at` | timestamp (UTC) | |

Search uses two methods together: vector similarity on `embedding`, and Postgres full-text search on `content`. There is **no special vector or full-text index yet**, so every search scans the chunks. That is fast up to roughly tens of thousands of chunks. For a much larger knowledge base, add an HNSW index (ask for this when needed).

### 2.3 `conversation_messages` (the chat history)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID, primary key | |
| `session_id` | text, **indexed** | random per visitor session |
| `role` | text | `user` or `assistant` |
| `content` | text | the message text |
| `retrieval_score` | float, optional | best match score, for debugging |
| `created_at` | timestamp (UTC) | |

### 2.4 `chat_events` (the dashboard data)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID, primary key | |
| `created_at` | timestamp (UTC), **indexed** | |
| `session_id` | text, **indexed** | |
| `outcome` | text, **indexed** | `answered`, `cache_hit`, `low_confidence_fallback` (not answered), `smalltalk`, `blocked_regex`, `blocked_nemo`, `budget_exhausted`, `error_*` |
| `question` | text | what the visitor asked (first 2000 characters) |
| `answer` | text, optional | what the bot replied (first 4000 characters) |
| `confidence` | float, optional | how well the documents matched |
| `tier` / `model` | text, optional | which AI model answered (`fast` or `complex`) |
| `input_tokens` / `output_tokens` | integer | **estimated** (about 4 characters per token) |
| `cost_usd` | float | **estimated** from the price table |
| `latency_ms` | integer, optional | time to answer |

## 3. When is data written?
| Action | What is written |
|---|---|
| Admin uploads a PDF or text | 1 row in `documents` + many rows in `chunks` (one transaction, all or nothing) |
| Uploading the same title/URL again | the old version is deleted first, then the new one is saved (replace) |
| A visitor asks a question | 1 row in `chat_events`; and for questions that go through the full answer flow, also 2 rows in `conversation_messages` (question + answer) |
| Visitor opens the chat | **nothing** in the database (sessions are signed tokens, not stored) |

## 4. When is data deleted? (history)
**Nothing is deleted automatically in Postgres.** `conversation_messages` and `chat_events` grow until *you* delete them. This is on purpose, so the dashboard keeps its history.

| What | How it goes away |
|---|---|
| A document and its chunks | Admin console -> Knowledge -> **Delete** (chunks are removed together with the document) |
| An old version of a document | Replaced automatically when you upload the same title/URL again |
| Old conversations and dashboard data | Admin console -> **Settings -> Delete old conversation data** (older than N days). This removes rows from **both** `chat_events` and `conversation_messages`. Documents are never touched. |
| Everything for one visitor | run SQL (section 6) |

API form of the retention delete: `DELETE /v1/admin/events?older_than_days=90` with the `X-Admin-Key` header. Suggested policy: keep 90 days, and run the delete once a month. Mention your retention period in your privacy policy, because questions can contain personal details visitors typed.

### Redis (short-term memory, not Postgres)
Redis is a separate, temporary store. Losing it is harmless; the bot keeps working.
| Redis data | Lives for | Purpose |
|---|---|---|
| `history:<session>` | **30 minutes** after the last message (`SESSION_TTL_SECONDS`), last 6 turns | the bot's memory inside one chat, so follow-up questions work |
| answer cache | 1 hour, and cleared whenever documents change | instant repeat answers, no AI cost |
| `ratelimit:*` | about 1 minute to 1 day | stops spam |
| `budget:<day>:*` | 2 days | counts today's AI use against your daily caps |

So: **the bot forgets a conversation after 30 minutes of silence, but the text stays in Postgres** until you delete it.

## 5. Size and cost (rough)
- One chunk is about 2 to 3 KB (text + 1.5 KB embedding). 1,000 chunks is about 3 MB.
- A chat event plus 2 messages is about 2 to 6 KB. 10,000 questions is about 50 MB.
- Neon's free plan has a small storage limit (check your plan in the Neon dashboard). For a small site this is plenty, as long as you run the retention delete now and then.

## 6. Handy SQL (Neon -> SQL Editor)
```sql
-- how many rows in each table
SELECT 'documents' t, count(*) FROM documents
UNION ALL SELECT 'chunks', count(*) FROM chunks
UNION ALL SELECT 'conversation_messages', count(*) FROM conversation_messages
UNION ALL SELECT 'chat_events', count(*) FROM chat_events;

-- list tables and their sizes
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;

-- latest questions
SELECT created_at, outcome, question FROM chat_events ORDER BY created_at DESC LIMIT 20;

-- questions the bot could not answer (add documents for these)
SELECT question, count(*) FROM chat_events
WHERE outcome = 'low_confidence_fallback' GROUP BY question ORDER BY 2 DESC LIMIT 20;

-- delete ONE visitor's data (e.g. a privacy request)
DELETE FROM conversation_messages WHERE session_id = '<session id>';
DELETE FROM chat_events          WHERE session_id = '<session id>';

-- delete everything older than 90 days (same as the Settings page)
DELETE FROM chat_events          WHERE created_at < now() - interval '90 days';
DELETE FROM conversation_messages WHERE created_at < now() - interval '90 days';
```
Deleting a document by hand in SQL: delete its `chunks` first (`DELETE FROM chunks WHERE document_id = '...'`), then the `documents` row. The admin console does both for you, so prefer it.

## 7. Backups and moving data
- **Neon** keeps a restore history on its side (how far back depends on your Neon plan, see Neon -> Project settings). You can also create a branch as a snapshot before risky changes.
- Your **documents** can always be rebuilt by uploading the PDFs again, so keep the original files.
- Local Docker data does **not** move to Neon by itself. Copy it with `pg_dump` then `psql`, or just upload the documents again.
- Changing the embedding model or size later means re-uploading all documents (old embeddings no longer match).
- Table changes: the app only creates *missing* tables at startup. It does not alter existing ones. For future column changes, use migrations (Alembic), not manual edits.

## 8. Privacy checklist
- [ ] Told visitors (privacy policy) that chats are stored, and for how long
- [ ] Retention delete scheduled monthly (Settings page or the API)
- [ ] Neon password kept only in `.env` / host secrets, never in chat or git
- [ ] The admin password (`ADMIN_API_KEY`) is long and not shared
