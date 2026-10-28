import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useApp } from "../lib/ctx";
import { useAsync } from "../lib/useAsync";
import { dateOnly, num } from "../lib/format";

type Status = "ready" | "uploading" | "processing" | "done" | "bad";
interface QItem { id: number; file: File; title: string; status: Status; pct: number; msg: string }
const MAX = 20 * 1024 * 1024;
let seq = 0;
const baseName = (n: string) => n.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
const mb = (n: number) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");

export function Knowledge() {
  const { client, toast, onError } = useApp();
  const docs = useAsync(() => client.documents(), []);
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [queue, setQueue] = useState<QItem[]>([]);
  const [cat, setCat] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const existing = new Set((Array.isArray(docs.data) ? docs.data : []).map((d) => d.title.trim().toLowerCase()));
  const patch = (id: number, p: Partial<QItem>) => setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // warn before closing the tab in the middle of an upload
  useEffect(() => {
    if (!busy) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [busy]);

  function add(list: FileList | null) {
    if (!list || !list.length) return;
    setQueue((q) => {
      const items: QItem[] = [];
      Array.from(list).forEach((file) => {
        const dup = q.some((x) => x.file.name === file.name && x.file.size === file.size && x.status !== "done");
        if (dup) return;
        const bad = !/\.pdf$/i.test(file.name) ? "Not a PDF file" : file.size === 0 ? "File is empty" : file.size > MAX ? "Over 20 MB" : "";
        items.push({ id: ++seq, file, title: baseName(file.name), status: bad ? "bad" : "ready", pct: 0, msg: bad });
      });
      return [...q, ...items];
    });
  }
  function onDrop(e: DragEvent) { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }

  async function upload(e?: FormEvent) {
    e?.preventDefault();
    const todo = queue.filter((x) => x.status === "ready" || (x.status === "bad" && x.msg !== "Not a PDF file" && x.msg !== "Over 20 MB" && x.msg !== "File is empty"));
    if (!todo.length) return;
    setBusy(true);
    let ok = 0;
    for (const it of todo) {
      patch(it.id, { status: "uploading", msg: "Uploading…", pct: 0 });
      try {
        const r = await client.uploadPdf(it.file, {
          title: it.title.trim() || baseName(it.file.name),
          category: cat.trim(),
          onProgress: (p) => patch(it.id, p >= 100 ? { pct: 100, status: "processing", msg: "Reading and indexing…" } : { pct: p, msg: `Uploading ${p}%` }),
        });
        patch(it.id, { status: "done", pct: 100, msg: `${num(r.chunks)} sections${r.replaced ? " · replaced the old version" : ""}` });
        ok++;
      } catch (x) {
        patch(it.id, { status: "bad", msg: x instanceof Error ? x.message : "Failed" });
      }
    }
    setBusy(false); docs.reload();
    toast(ok === todo.length ? `${ok} document${ok === 1 ? "" : "s"} added` : `${ok} of ${todo.length} added, check the red items`);
    window.setTimeout(() => setQueue((q) => q.filter((x) => x.status !== "done")), 4000);
  }

  // paste-text tab
  const [tx, setTx] = useState({ title: "", cat: "", url: "", body: "" });
  const [txMsg, setTxMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function addText(e: FormEvent) {
    e.preventDefault();
    setTxMsg({ ok: true, text: "Adding…" });
    try {
      const r = await client.ingestText({ title: tx.title.trim(), text: tx.body, url: tx.url.trim() || undefined, category: tx.cat.trim() || undefined });
      setTxMsg({ ok: true, text: `Added “${r.title}” as ${r.chunks} sections.` });
      setTx({ title: "", cat: "", url: "", body: "" }); docs.reload();
    } catch (x) { setTxMsg({ ok: false, text: x instanceof Error ? x.message : "Failed" }); }
  }

  async function del(id: string, name: string) {
    if (!window.confirm(`Delete “${name}”? The assistant will stop answering from it.`)) return;
    try { await client.deleteDocument(id); toast("Deleted"); docs.reload(); } catch (x) { onError(x); }
  }

  const all = docs.data ?? [];
  const rows = all.filter((d) => !search || (d.title + " " + (d.category ?? "")).toLowerCase().includes(search.toLowerCase()));
  const ready = queue.filter((x) => x.status === "ready").length;
  const retry = queue.filter((x) => x.status === "bad" && !["Not a PDF file", "Over 20 MB", "File is empty"].includes(x.msg)).length;

  return (
    <section id="knowledge" className="grid2 know">
      <div className="panel">
        <div className="panel-head"><h3>Add knowledge</h3>
          <div className="tabs">
            <button type="button" className={"tab" + (tab === "pdf" ? " active" : "")} onClick={() => setTab("pdf")}>PDF files</button>
            <button type="button" className={"tab" + (tab === "text" ? " active" : "")} onClick={() => setTab("text")}>Paste text</button>
          </div>
        </div>
        <p className="muted small">The assistant answers only from what you add here. Uploading a file with the same title replaces the old version.</p>
        {tab === "pdf" ? (
          <form className="up" onSubmit={upload}>
            <div className={"drop" + (over ? " over" : "")} tabIndex={0} role="button" aria-label="Choose PDF files"
              onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
              onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setOver(false); }} onDrop={onDrop}>
              <div className="drop-ic">⬆</div>
              <div><b>{over ? "Drop to add" : "Drag PDFs here"}</b> or <u>browse your computer</u></div>
              <div className="tiny muted">You can add several files at once · up to 20 MB each · PDFs with real text (not scanned pictures)</div>
              <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </div>
            <label>Category for these files (optional)<input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. check-printing or time-attendance" /></label>
            {queue.length > 0 && (
              <ul className="queue">
                {queue.map((it) => {
                  const replaces = it.status === "ready" && existing.has(it.title.trim().toLowerCase());
                  const locked = it.status !== "ready";
                  return (
                    <li key={it.id} className={it.status}>
                      <div className="q-main">
                        <input className="q-title" value={it.title} disabled={locked} aria-label="Document title" onChange={(e) => patch(it.id, { title: e.target.value })} />
                        <div className="tiny muted">{it.file.name} · {mb(it.file.size)}{replaces ? " · will replace the existing document" : ""}</div>
                        {(it.status === "uploading" || it.status === "processing") && <div className={"bar" + (it.status === "processing" ? " busy" : "")}><i style={{ width: it.pct + "%" }} /></div>}
                      </div>
                      <span className={"st" + (it.status === "done" ? " ok" : it.status === "bad" ? " bad" : "")}>{it.msg || "Ready"}</span>
                      <button type="button" className="btn ghost small" aria-label="Remove from list" disabled={it.status === "uploading" || it.status === "processing"} onClick={() => setQueue((q) => q.filter((x) => x.id !== it.id))}>✕</button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="up-actions">
              <button className="btn primary" type="submit" disabled={busy || (ready + retry === 0)}>
                {busy ? "Uploading…" : ready + retry > 1 ? `Upload ${ready + retry} files` : retry ? "Retry upload" : "Upload & learn"}
              </button>
              {queue.length > 0 && !busy && <button type="button" className="btn ghost" onClick={() => setQueue([])}>Clear list</button>}
            </div>
          </form>
        ) : (
          <form className="up" onSubmit={addText}>
            <div className="row">
              <label>Title<input required value={tx.title} onChange={(e) => setTx({ ...tx, title: e.target.value })} /></label>
              <label>Category (optional)<input value={tx.cat} onChange={(e) => setTx({ ...tx, cat: e.target.value })} /></label>
            </div>
            <label>Page URL (optional, shown as the source)<input type="url" value={tx.url} onChange={(e) => setTx({ ...tx, url: e.target.value })} placeholder="https://..." /></label>
            <label>Content<textarea required rows={8} value={tx.body} onChange={(e) => setTx({ ...tx, body: e.target.value })} placeholder="Paste the page or document text here. Put section titles on their own line starting with #" /></label>
            {txMsg && <div className={"note " + (txMsg.ok ? "ok" : "bad")}>{txMsg.text}</div>}
            <button className="btn primary" type="submit">Add text</button>
          </form>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Documents <span className="muted">({all.length})</span></h3>
          <input className="search" placeholder="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th className="num">Sections</th><th>Added</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.url && /^https?:\/\//i.test(d.url) ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a> : d.title}</td>
                <td>{d.category && <span className="tag">{d.category}</span>}</td>
                <td className="num">{num(d.chunks)}</td><td>{dateOnly(d.created_at)}</td>
                <td className="num"><button className="btn ghost small" onClick={() => del(d.id, d.title)}>Delete</button></td>
              </tr>
            ))}
          </tbody></table></div>
        {!docs.loading && all.length === 0 && <div className="empty">No documents yet.<br />Add your first PDF on the left and the assistant can start answering from it.</div>}
        {!docs.loading && all.length > 0 && rows.length === 0 && <div className="empty">No document matches “{search}”.</div>}
      </div>
    </section>
  );
}