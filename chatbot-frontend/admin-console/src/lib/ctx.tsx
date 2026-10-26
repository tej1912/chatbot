import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthError, type Client } from "./api";

interface Ctx {
  client: Client;
  signOut: () => void;
  toast: (msg: string) => void;
  /** Report an error from a request: bad key signs out, anything else shows a toast. */
  onError: (e: unknown) => void;
}
const C = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function AppProvider({ client, signOut, children }: { client: Client; signOut: () => void; children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<number>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 3200);
  }, []);
  const onError = useCallback((e: unknown) => {
    if (e instanceof AuthError) signOut();
    else toast(e instanceof Error ? e.message : "Something went wrong");
  }, [signOut, toast]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <C.Provider value={{ client, signOut, toast, onError }}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </C.Provider>
  );
}
