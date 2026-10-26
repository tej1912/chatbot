import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, RotateCcw, ShieldCheck } from 'lucide-react';
import { ChatMessage } from '../../types';
import { SmartBusinessLogo } from '../common/SmartBusinessLogo';

/**
 * SmartBusiness chat widget, connected to the RAG backend (chatbot-backend).
 * Drop-in replacement for the old mock FloatingChatWidget: same props, same look.
 *
 * Needs ONE env var in the web portal (.env):
 *   VITE_CHAT_API_URL=https://chat-api.yourdomain.com      (local: http://localhost:8000)
 * and the portal's address must be listed in the backend CORS_ORIGINS.
 */

interface FloatingChatWidgetProps {
  isOpen: boolean;
  onToggle: () => void;
  onNavigatePricing: () => void;
}

// ---------- backend connection ----------
const API_BASE: string = (
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CHAT_API_URL) ||
  'http://localhost:8000'
).replace(/\/+$/, '');

const SESSION_KEY = 'sb_chat_session';
interface Session { token: string; exp: number }

const readSession = (): Session | null => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null;
    if (s && s.token && s.exp > Date.now() + 5 * 60 * 1000) return s; // refresh 5 min before expiry
  } catch { /* ignore */ }
  return null;
};
const dropSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } };

let sessionInFlight: Promise<Session> | null = null;
const ensureSession = (): Promise<Session> => {
  const s = readSession();
  if (s) return Promise.resolve(s);
  if (!sessionInFlight) {
    sessionInFlight = (async () => {
      const r = await fetch(`${API_BASE}/v1/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (r.status === 429) throw new Error('rate_limited');
      if (!r.ok) throw new Error(`session_failed_${r.status}`);
      const d = (await r.json()) as { token: string; expires_in: number };
      const sess = { token: d.token, exp: Date.now() + d.expires_in * 1000 };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch { /* ignore */ }
      return sess;
    })().finally(() => { sessionInFlight = null; });
  }
  return sessionInFlight;
};

const postChat = (message: string, s: Session) =>
  fetch(`${API_BASE}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': s.token },
    body: JSON.stringify({ message }),
  });

/** Read the server-sent-events stream and call onText with the full answer so far. */
async function streamAnswer(resp: Response, onText: (full: string) => void): Promise<boolean> {
  if (!resp.body) return false;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.some((l) => l.trim() === 'event: debug')) continue;
      const line = lines.find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') continue;
      full += payload.replace(/\\n/g, '\n');
      onText(full);
    }
  }
  return full.length > 0;
}

// ---------- tiny markdown (bold, code, bullets, numbers) rendered as React nodes, never raw HTML ----------
const inline = (text: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] !== undefined
        ? <strong key={i++}>{m[1]}</strong>
        : <code key={i++} className="px-1 rounded bg-slate-100 text-[11px]">{m[2]}</code>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/\n{2,}/).map((block, bi) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return null;
      if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
        return <ul key={bi} className="list-disc pl-4 space-y-0.5">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l)))
        return <ol key={bi} className="list-decimal pl-4 space-y-0.5">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>)}</ol>;
      return <p key={bi} className={bi ? 'mt-2' : ''}>{lines.map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
    })}
  </>
);

// ---------- texts ----------
const WELCOME_TEXT =
  'Hello! Welcome to SmartBusiness Solutions. How can I help you with high-volume check printing, bank compliance, or Clock In / Clock Out attendance today?';
const WELCOME_ACTIONS = [
  'How does batch check printing & dispatch work?',
  'Tell me about Clock In Clock Out attendance',
  'Are checks compliant with Federal Reserve MICR standards?',
  'What are the pricing tiers for high volume?',
];
const makeWelcome = (id: string): ChatMessage => ({
  id,
  sender: 'assistant',
  text: WELCOME_TEXT,
  timestamp: 'Just now',
  suggestedActions: WELCOME_ACTIONS,
});
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const FloatingChatWidget: React.FC<FloatingChatWidgetProps> = ({
  isOpen,
  onToggle,
  onNavigatePricing
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcome('msg-1')]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [unreadCount, setUnreadCount] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      scrollToBottom();
    }
  }, [isOpen, messages, isTyping]);

  // warm up the server session when the chat opens (errors show on first send)
  useEffect(() => {
    if (isOpen) ensureSession().catch(() => undefined);
  }, [isOpen]);

  const addAssistant = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: `bot-${Date.now()}-${prev.length}`, sender: 'assistant', text, timestamp: clock() }]);
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputValue).trim();
    if (!text || isBusy) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: clock()
    };

    // chips are only useful before the first question
    setMessages((prev) => [...prev.map((m) => (m.suggestedActions ? { ...m, suggestedActions: undefined } : m)), userMsg]);
    if (!textToSend) setInputValue('');
    setIsTyping(true);
    setIsBusy(true);

    const botId = `bot-${Date.now()}`;
    let started = false;
    const showText = (full: string) => {
      if (!started) {
        started = true;
        setIsTyping(false);
        setMessages((prev) => [...prev, { id: botId, sender: 'assistant', text: full, timestamp: clock() }]);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, text: full } : m)));
      }
    };

    try {
      let session = await ensureSession();
      let resp = await postChat(text, session);
      if (resp.status === 401) { // token expired: get a new session, retry once
        dropSession();
        session = await ensureSession();
        resp = await postChat(text, session);
      }
      if (resp.status === 429) {
        setIsTyping(false);
        addAssistant("You're sending messages a bit fast. Please wait a moment and try again.");
        return;
      }
      if (!resp.ok) throw new Error(`chat_failed_${resp.status}`);
      const got = await streamAnswer(resp, showText);
      if (!got && !started) {
        setIsTyping(false);
        addAssistant("Sorry, I didn't get a response. Please try again.");
      }
    } catch (err) {
      setIsTyping(false);
      if (!started) {
        addAssistant(
          err instanceof Error && err.message === 'rate_limited'
            ? 'Too many chat sessions started from your network. Please wait a minute and try again.'
            : 'Sorry, something went wrong reaching the server. Please try again.'
        );
      }
      console.error('chat error:', err);
    } finally {
      setIsTyping(false);
      setIsBusy(false);
    }
  };

  const handleReset = () => {
    // new conversation = new server session (the server keeps history per session)
    dropSession();
    ensureSession().catch(() => undefined);
    setMessages([
      {
        id: 'msg-reset',
        sender: 'assistant',
        text: 'Conversation reset. How can SmartBusiness Solutions assist you today?',
        timestamp: 'Just now',
        suggestedActions: [
          'How does batch check printing work?',
          'Clock In Clock Out features',
          'Explore pricing tiers'
        ]
      }
    ]);
  };

  return (
    <aside aria-label="Customer Support Chat" className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      
      {/* Floating Chat Window (Aside Container) */}
      {isOpen && (
        <div className="mb-4 w-[92vw] sm:w-[380px] h-[520px] bg-white rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-200">
          
          {/* Header */}
          <div className="bg-slate-900 px-4 py-3.5 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <SmartBusinessLogo iconOnly size="sm" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
              </div>
              <div>
                <h4 className="font-bold text-sm leading-tight text-white">SmartBusiness Assistant</h4>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span className="text-emerald-400">●</span>
                  <span>Live Concierge &bull; &lt; 2m reply</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleReset}
                title="Reset conversation"
                className="p-1.5 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onToggle}
                aria-label="Close chat"
                className="p-1.5 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Notice Banner */}
          <div className="bg-indigo-50/70 border-b border-indigo-100/50 px-3.5 py-1.5 flex items-center justify-between text-[11px] text-indigo-900">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-indigo-600" />
              Federal Reserve Check 21 & MICR Certified
            </span>
            <button
              onClick={onNavigatePricing}
              className="font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              Plans
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/40 text-xs" aria-live="polite">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-xs'
                      : 'bg-white border border-slate-200/80 text-slate-800 shadow-2xs rounded-bl-xs'
                  }`}
                >
                  {msg.sender === 'user' ? <p>{msg.text}</p> : <Markdown text={msg.text} />}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 px-1">
                  {msg.timestamp}
                </span>

                {/* Suggested Action Chips (if present) */}
                {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 max-w-[95%]">
                    {msg.suggestedActions.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(action)}
                        className="text-left bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-600 px-2.5 py-1 rounded-full text-[11px] transition-colors shadow-2xs cursor-pointer"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 text-slate-400 p-2 bg-white rounded-xl border border-slate-100 w-20">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="p-3 bg-white border-t border-slate-100 flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              maxLength={2000}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about check printing, clock in/out..."
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isBusy}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-40 text-white rounded-xl transition-all cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

        </div>
      )}

      {/* Floating Launcher Button */}
      <button
        onClick={onToggle}
        className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-xl hover:shadow-2xl transition-all hover:scale-105 cursor-pointer"
        aria-label="Toggle SmartBusiness chat assistant"
      >
        {isOpen ? (
          <X className="w-6 h-6 transition-transform group-hover:rotate-90 duration-200" />
        ) : (
          <>
            <MessageSquare className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
                {unreadCount}
              </span>
            )}
          </>
        )}
      </button>

    </aside>
  );
};
