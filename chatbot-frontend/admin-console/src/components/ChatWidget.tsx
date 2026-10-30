import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./chat.css";
import { SmartBusinessLogo } from "./SmartBusinessLogo";

/** Test chat for the admin console. Talks to the same backend as the website widget, using the backend URL you signed in with. */
interface Msg { id: number; role: "user" | "assistant"; text: string; time: string; chips?: string[] }
interface Session { token: string; exp: number }

const KEY = "sb_admin_chat_session";
const WELCOME = "Hello! Welcome to SmartBusiness Solutions. How can I help you with high-volume check printing, bank compliance, or Clock In / Clock Out attendance today?";
const CHIPS =[
  'How does batch check printing work?',
  'Tell me about Clock In Clock Out attendance',
  'How long is the free trial, and do I need a credit card?',
  'Is my bank account information secure?',
];
let seq = 0;
const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const welcome = (): Msg => ({ id: ++seq, role: "assistant", text: WELCOME, time: "Just now", chips: CHIPS });

const stored = (): Session | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as Session | null;
    if (s && s.token && s.exp > Date.now() + 5 * 60 * 1000) return s;
  } catch { /* ignore */ }
  return null;
};

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+?)`/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={i++}>{m[1]}</strong> : <code key={i++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return <ul key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return <ol key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>)}</ol>;
        return <p key={bi}>{lines.map((l, i) => <span key={i}>{i > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </>
  );
}

const Icon = ({ d, w = 2, style }: { d: string[]; w?: number; style?: CSSProperties }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={style}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
);

export function ChatWidget({ apiBase }: { apiBase: string }) {
  const api = apiBase.replace(/\/+$/, "");
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => [welcome()]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Promise<Session> | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const ensure = useCallback((): Promise<Session> => {
    const s = stored();
    if (s) return Promise.resolve(s);
    if (!pending.current) {
      pending.current = (async () => {
        const r = await fetch(`${api}/v1/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (r.status === 429) throw new Error("rate_limited");
        if (!r.ok) throw new Error("session_failed_" + r.status);
        const d = (await r.json()) as { token: string; expires_in: number };
        const sess = { token: d.token, exp: Date.now() + d.expires_in * 1000 };
        try { localStorage.setItem(KEY, JSON.stringify(sess)); } catch { /* ignore */ }
        return sess;
      })().finally(() => { pending.current = null; });
    }
    return pending.current;
  }, [api]);
  const drop = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } pending.current = null; };

  useEffect(() => { if (open) { end.current?.scrollIntoView({ behavior: "smooth" }); ensure().catch(() => undefined); } }, [open, msgs, typing, ensure]);

  const say = (t: string) => setMsgs((m) => [...m, { id: ++seq, role: "assistant", text: t, time: clock() }]);
  const post = (message: string, s: Session) =>
    fetch(`${api}/v1/chat`, { method: "POST", headers: { "Content-Type": "application/json", "X-Session-Token": s.token }, body: JSON.stringify({ message }) });

  async function send(override?: string) {
    const t = (override ?? text).trim();
    if (!t || busy) return;
    setText(""); setBusy(true); setTyping(true);
    setMsgs((m) => [...m.map((x) => ({ ...x, chips: undefined })), { id: ++seq, role: "user", text: t, time: clock() }]);
    const botId = ++seq;
    let started = false;
    const show = (full: string) => {
      if (!started) { started = true; setTyping(false); setMsgs((m) => [...m, { id: botId, role: "assistant", text: full, time: clock() }]); }
      else setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: full } : x)));
    };
    try {
      let s = await ensure();
      let r = await post(t, s);
      if (r.status === 401) { drop(); s = await ensure(); r = await post(t, s); }
      if (r.status === 429) { setTyping(false); say("You're sending messages a bit fast. Please wait a moment and try again."); return; }
      if (!r.ok || !r.body) throw new Error("chat_failed_" + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "", full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split("\n\n"); buf = blocks.pop() ?? "";
        for (const b of blocks) {
          const lines = b.split("\n");
          if (lines.some((l) => l.trim() === "event: debug")) continue;
          const line = lines.find((l) => l.startsWith("data: "));
          if (!line || line.slice(6) === "[DONE]") continue;
          full += line.slice(6).replace(/\\n/g, "\n");
          show(full);
        }
      }
      if (!started) { setTyping(false); say("Sorry, I didn't get a response. Please try again."); }
    } catch (e) {
      setTyping(false);
      if (!started) say(e instanceof Error && e.message === "rate_limited" ? "Too many chat sessions started from your network. Please wait a minute and try again." : "Sorry, something went wrong reaching the server. Please try again.");
    } finally { setTyping(false); setBusy(false); }
  }

  function reset() { drop(); ensure().catch(() => undefined); setMsgs([welcome()]); }

  return (
    <aside className="sbc" aria-label="Test chat">
      {open && (
        <div className="sbc-panel" role="dialog" aria-label="SmartBusiness Assistant">
          <div className="sbc-head">
            <span className="sbc-logo"><SmartBusinessLogo iconOnly size="sm" /><i /></span>
            <div className="sbc-ht"><b>SmartBusiness Assistant</b><small><em>●</em> Test chat · same bot as the website</small></div>
            <button className="sbc-ib" title="New conversation" aria-label="New conversation" onClick={reset}><Icon d={["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"]} /></button>
            <button className="sbc-ib" title="Close" aria-label="Close chat" onClick={() => setOpen(false)}><Icon d={["M6 6l12 12M18 6L6 18"]} /></button>
          </div>
          <div className="sbc-msgs" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={"sbc-row " + m.role}>
                <div className={"sbc-bubble " + m.role}>{m.role === "assistant" ? <Markdown text={m.text} /> : m.text}</div>
                <span className="sbc-time">{m.time}</span>
                {m.chips && <div className="sbc-chips">{m.chips.map((c) => <button key={c} onClick={() => send(c)}>{c}</button>)}</div>}
              </div>
            ))}
            {typing && <div className="sbc-typing"><span /><span /><span /></div>}
            <div ref={end} />
          </div>
          <div className="sbc-input">
            <input value={text} maxLength={2000} placeholder="Ask about check printing, clock in/out..." onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button aria-label="Send message" disabled={!text.trim() || busy} onClick={() => send()}><Icon d={["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"]} /></button>
          </div>
        </div>
      )}
      <button className="sbc-launch" aria-label="Toggle test chat" onClick={() => setOpen(!open)}>
        <Icon w={2} d={open ? ["M6 6l12 12M18 6L6 18"] : ["M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.7-.8L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"]} style={{ width: 24, height: 24 }} />
      </button>
    </aside>
  );
}
