import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Client } from "./api";

interface Ctx {
  client: Client;
  toast: (msg: string) => void;
  /** Report an error from a request as a toast. */
  onError: (e: unknown) => void;
}
const C = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function AppProvider({ client, children }: { client: Client; children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<number>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 3200);
  }, []);
  const onError = useCallback((e: unknown) => {
    toast(e instanceof Error ? e.message : "Something went wrong");
  }, [toast]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <C.Provider value={{ client, toast, onError }}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </C.Provider>
  );
}