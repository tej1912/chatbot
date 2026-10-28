import { useEffect, useState } from "react";
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
const client = makeClient(API);

export default function App() {
  return (
    <div>
      <Header />
      <main>
        <AppProvider client={client}><Dashboard client={client} /></AppProvider>
      </main>
    </div>
  );
}

function Header() {
  const [health, setHealth] = useState<Health | "offline" | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => client.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth("offline"));
    tick();
    const t = window.setInterval(tick, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const status = health === null ? "checking" : health === "offline" ? "offline" : health.status === "ok" ? "healthy" : health.status;
  const cls = status === "healthy" ? "ok" : status === "degraded" ? "warn" : status === "checking" ? "" : "bad";
  return (
    <header className="top">
      <SmartBusinessLogo size="sm" />
      <span className="admin-tag">Admin</span>
      <nav><a href="#knowledge">Upload</a><a href="#summary">Usage &amp; cost</a><a href="#conversations">Conversations</a></nav>
      <div className="top-right">
        <span className={"health " + cls} title={"Backend: " + API}><i /><span>{status}</span></span>
      </div>
    </header>
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