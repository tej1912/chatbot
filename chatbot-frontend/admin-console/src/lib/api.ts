import type { Conversation, ConversationPage, DocumentRow, Health, IngestResult, Pricing, Stats, Usage } from "./types";

export class AuthError extends Error {}

export interface Client {
  base: string;
  usage(): Promise<Usage>;
  stats(days: number): Promise<Stats>;
  pricing(): Promise<Pricing>;
  conversations(p: { outcome: string; days: number; limit: number; offset: number; q?: string }): Promise<ConversationPage>;
  deleteEvents(days: number): Promise<{ deleted_events: number; deleted_messages: number }>;
  documents(): Promise<DocumentRow[]>;
  deleteDocument(id: string): Promise<void>;
  ingestText(p: { title: string; text: string; url?: string; category?: string }): Promise<IngestResult>;
  uploadPdf(file: File, o: { title?: string; category?: string; onProgress?: (pct: number) => void }): Promise<IngestResult>;
  health(): Promise<Health>;
}

export function makeClient(base: string, key: string): Client {
  const root = base.replace(/\/+$/, "");

  async function req<T>(method: string, path: string, json?: unknown): Promise<T> {
    const headers: Record<string, string> = { "X-Admin-Key": key };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await fetch(root + path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
    } catch {
      throw new Error(`Cannot reach the backend at ${root}. Is it running, and is this page's address in CORS_ORIGINS?`);
    }
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (r.status === 401 || r.status === 403) throw new AuthError("Wrong admin password.");
    if (!r.ok) {
      const d = data?.detail;
      throw new Error((typeof d === "string" ? d : d ? JSON.stringify(d) : "") || `Request failed (${r.status})`);
    }
    return data as T;
  }

  const qs = (o: Record<string, string | number | undefined>) =>
    Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  return {
    base: root,
    usage: () => req<Usage>("GET", "/v1/admin/usage"),
    stats: (days) => req<Stats>("GET", `/v1/admin/stats?days=${days}`),
    pricing: () => req<Pricing>("GET", "/v1/admin/pricing"),
    conversations: (p) => req<ConversationPage>("GET", "/v1/admin/conversations?" + qs(p)),
    deleteEvents: (days) => req("DELETE", `/v1/admin/events?older_than_days=${days}`),
    documents: () => req<DocumentRow[]>("GET", "/v1/documents"),
    deleteDocument: async (id) => { await req("DELETE", `/v1/documents/${encodeURIComponent(id)}`); },
    ingestText: (p) => req<IngestResult>("POST", "/v1/ingest", { ...p, replace: true }),
    uploadPdf: (file, o) =>
      new Promise<IngestResult>((resolve, reject) => {
        const fd = new FormData();
        fd.append("file", file);
        if (o.title) fd.append("title", o.title);
        if (o.category) fd.append("category", o.category);
        const x = new XMLHttpRequest();
        x.open("POST", root + "/v1/ingest/pdf");
        x.setRequestHeader("X-Admin-Key", key);
        x.upload.onprogress = (e) => { if (e.lengthComputable) o.onProgress?.(Math.round((e.loaded / e.total) * 100)); };
        x.onload = () => {
          let j: any = null;
          try { j = JSON.parse(x.responseText); } catch { /* ignore */ }
          if (x.status === 401 || x.status === 403) return reject(new AuthError("Wrong admin password."));
          if (x.status >= 200 && x.status < 300) return resolve(j as IngestResult);
          reject(new Error(typeof j?.detail === "string" ? j.detail : `Failed (${x.status})`));
        };
        x.onerror = () => reject(new Error("Network error"));
        x.send(fd);
      }),
    health: async () => {
      const r = await fetch(root + "/readyz");
      return (await r.json()) as Health;
    },
  };
}

export type { Conversation };
