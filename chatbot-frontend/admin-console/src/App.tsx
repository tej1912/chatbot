import { useCallback, useEffect, useState, type FormEvent } from "react";
import { makeClient, type Client } from "./lib/api";
import { AppProvider } from "./lib/ctx";
import { useAsync } from "./lib/useAsync";
import { SmartBusinessLogo } from "./components/SmartBusinessLogo";
import { RangeSelect } from "./components/RangeSelect";
import { ChatWidget } from "./components/ChatWidget";
import { Summary } from "./sections/Summary";
import { Knowledge } from "./sections/Knowledge";
import { Conversations } from "./sections/Conversations";
import { Maintenance } from "./sections/Maintenance";
import type { Health } from "./lib/types";

const API = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/+$/, "");
const get = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } };

export default function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [ready, setReady] = useState(false);
  const signOut = useCallback(() => { set("sb_key", null); setClient(null); }, []);

  // resume the password kept in this tab
  useEffect(() => {
    const key = get("sb_key");
    if (!key) { setReady(true); return; }
    const c = makeClient(API, key);
    c.usage().then(() => setClient(c)).catch(() => set("sb_key", null)).finally(() => setReady(true));
  }, []);

  return (
    <div>
      <Header client={client} onLock={signOut} />
      <main>
        {!ready ? null : client ? (
          <AppProvider client={client} signOut={signOut}><Dashboard client={client} /></AppProvider>
        ) : (
          <Unlock onDone={(c, key) => { set("sb_key", key); setClient(c); }} />
        )}
      </main>
    </div>
  );
}

function Header({ client, onLock }: { client: Client | null; onLock: () => void }) {
  const [health, setHealth] = useState<Health | "offline" | null>(null);
  useEffect(() => {
    let alive = true;
    const c = client ?? makeClient(API, "");
    const tick = () => c.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth("offline"));
    tick();
    const t = window.setInterval(tick, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [client]);
  const status = health === null ? "checking" : health === "offline" ? "offline" : health.status === "ok" ? "healthy" : health.status;
  const cls = status === "healthy" ? "ok" : status === "degraded" ? "warn" : status === "checking" ? "" : "bad";
  return (
    <header className="top">
      <SmartBusinessLogo size="sm" />
      <span className="admin-tag">Admin</span>
      <nav>{client && <><a href="#knowledge">Upload</a><a href="#summary">Usage &amp; cost</a><a href="#conversations">Conversations</a></>}</nav>
      <div className="top-right">
        <span className={"health " + cls} title={"Backend: " + API}><i /><span>{status}</span></span>
        {client && <button className="btn ghost small" onClick={onLock}>Lock</button>}
      </div>
    </header>
  );
}

/** Admin password (the ADMIN_API_KEY from the backend .env), asked once per browser tab. */
function Unlock({ onDone }: { onDone: (c: Client, key: string) => void }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const c = makeClient(API, key.trim());
    try { await c.usage(); onDone(c, key.trim()); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <form className="panel unlock" onSubmit={submit}>
      <h3>Enter the admin password to load the dashboard</h3>
      <div className="row inline">
        <label>Admin password<input type="password" autoFocus autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ADMIN_API_KEY from the backend .env" required /></label>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Open"}</button>
      </div>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
    </form>
  );
}

function Dashboard({ client }: { client: Client }) {
  const [days, setDays] = useState(30);
  const stats = useAsync(() => client.stats(days), [days]);
  return (
    <>
      <Knowledge />
      <div className="range-row"><h2>Last {days} days</h2><RangeSelect value={days} onChange={setDays} /></div>
      <Summary stats={stats.data} />
      <Conversations days={days} />
      <Maintenance />
      <ChatWidget apiBase={client.base} />
    </>
  );
}
