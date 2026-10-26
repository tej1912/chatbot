# chatbot-frontend

React + TypeScript, npm only. **No Docker.** Two separate parts that both talk to `chatbot-backend`:

```
chatbot-frontend/
├── chatbot/
│   └── FloatingChatWidget.tsx   the chat bubble, one file, goes INTO your web portal
├── admin-console/               separate React + TS app (Vite) for you / your client: upload PDFs, conversations, cost
└── README.md
```

## 1. Chatbot: add it to your web portal
`FloatingChatWidget.tsx` is a drop-in replacement for your current `FloatingChatWidget.tsx`. Same props
(`isOpen`, `onToggle`, `onNavigatePricing`), same Tailwind look, same imports (`ChatMessage` from `../../types`,
`SmartBusinessLogo`, `lucide-react`). The mock replies are gone; it now streams real answers from the backend.

Steps
1. Replace the file in the portal (`src/components/chat/FloatingChatWidget.tsx`, wherever yours lives) with this one.
   If your path differs, only the two `import` lines at the top need adjusting.
2. Add to the portal's `.env`:
   ```
   VITE_CHAT_API_URL=http://localhost:8000
   ```
   In production use your public https backend URL. Restart `npm run dev` after changing `.env`.
3. Backend `.env`: add the portal address to `CORS_ORIGINS` (e.g. `http://localhost:5173`, later `https://your-site.com`), restart the backend.
4. Nothing else. Your existing `<FloatingChatWidget isOpen=... />` usage keeps working. (If the portal is not Vite, replace `import.meta.env.VITE_CHAT_API_URL` near the top of the file with your own config value.)

What it does: creates a signed session on first open (kept in `localStorage`), streams the answer, shows bold and bullet
lists safely (no raw HTML), retries once if the session expired, shows friendly messages on rate limit or server error,
and the reset button starts a new conversation. Quick-question chips show until the first question.

Things to know
- The "Federal Reserve Check 21 & MICR Certified" strip was copied from your file. Keep it only if it is true.
- Cloudflare Turnstile captcha is not in this version. Leave `TURNSTILE_SECRET` empty in the backend.
- The widget needs the Tailwind setup your portal already has (`animate-in`, `rounded-br-xs`, `shadow-2xs` etc. are from your original file).

## 2. Admin console
Its own app, **one single page** (no menu of pages), with the SmartBusiness logo. It also has a test chat bubble at the bottom right.
You enter the **admin password** (the `ADMIN_API_KEY` from the backend `.env`) once per browser tab. This is a small box on the same page,
not a separate login screen. It cannot be removed, because without it anyone who opens the page could delete your documents.

```powershell
cd admin-console
npm install
copy .env.example .env      # optional: VITE_API_BASE=http://localhost:8000
npm run dev                 # http://localhost:5173  (if the portal uses 5173: npm run dev -- --port 5174)
```
Logo: copy `smart.png` from the web portal's `public/` folder into `admin-console/public/smart.png`. Until then the logo shows the built-in SVG fallback.
Add the console's address to the backend `CORS_ORIGINS`. Production: `npm run build`, upload `dist/` to a static host, keep it private.

What is on the page (top to bottom)
| Section | What you see |
|---|---|
| Header | logo, backend health dot, Lock button |
| Add knowledge (top of the page) | drag and drop several PDFs (20 MB each) with a progress bar per file, edit each title, set a category, a warning when a title will replace an existing document, retry on failure; or paste text. Next to it: the documents list with search and delete |
| Usage & cost | period selector, questions, answer rate, speed, estimated cost, tokens, messages per day, cost per day, cost by model |
| Conversations | shows the **latest 5**; pick "Show" 10 / 25 / 50 / 100 for more (then Prev / Next), plus search, result filter, open a row for the full answer, export CSV |
| Delete old data | remove conversations older than N days |

```
admin-console/src/
├── lib/         api.ts (typed backend client), types.ts, ctx.tsx, useAsync.ts, format.ts
├── components/  SmartBusinessLogo (copied from the portal), Chart, Tile, RangeSelect, ChatWidget (+ chat.css)
└── sections/    Knowledge, Summary, Conversations, Maintenance
```
Notes
- Tailwind is installed only for `SmartBusinessLogo.tsx` (utilities only, no reset), so the rest of the admin is plain CSS.
- Costs are **estimates** (about 4 characters per token, list prices). Your provider's dashboard is the real bill. Edit prices with `MODEL_PRICES_JSON` in the backend `.env`.
- PDFs must contain real text; scanned images give "no text found".
- The password is kept only in the browser tab (session storage) and cleared on Lock or when the tab closes. Use https in production.

## Troubleshooting
| Symptom | Fix |
|---|---|
| CORS error in the console | add this page's address to backend `CORS_ORIGINS`, restart the backend |
| Chat answers "something went wrong reaching the server" | backend not running, wrong `VITE_CHAT_API_URL` (restart dev server after editing `.env`), or CORS |
| Every answer is "rate-limited by an upstream service" | LLM provider problem, read the **backend** logs |
| Admin says "Wrong admin password" | must equal `ADMIN_API_KEY` in the backend `.env` (restart the backend after changing it) |
