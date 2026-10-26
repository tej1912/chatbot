import { Fragment, useEffect, useState } from "react";
import { useApp } from "../lib/ctx";
import { useAsync } from "../lib/useAsync";
import { csvCell, num, usd, when } from "../lib/format";

const OUT: Record<string, [string, string]> = {
  answered: ["Answered", "ok"], cache_hit: ["Answered", "ok"], low_confidence_fallback: ["Not answered", "warn"], smalltalk: ["Small talk", ""],
  blocked_regex: ["Blocked", "bad"], blocked_nemo: ["Blocked", "bad"], budget_exhausted: ["Limit reached", "bad"],
};
function OutTag({ o }: { o: string }) {
  const m = OUT[o] ?? (o.startsWith("error") ? (["Error", "bad"] as [string, string]) : ([o, ""] as [string, string]));
  return <span className={"tag " + m[1]}>{m[0]}</span>;
}
const SIZES = [5, 10, 25, 50, 100];

export function Conversations({ days }: { days: number }) {
  const { client, toast, onError } = useApp();
  const [outcome, setOutcome] = useState("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(5); // shows the latest 5 until you pick more
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setOffset(0), [days]);
  useEffect(() => { const t = window.setTimeout(() => { setQ(qInput.trim()); setOffset(0); }, 350); return () => window.clearTimeout(t); }, [qInput]);
  const page = useAsync(() => client.conversations({ outcome, days, limit, offset, q }), [outcome, days, offset, q, limit]);
  const total = page.data?.total ?? 0;
  const to = Math.min(offset + limit, total);

  async function exportCsv() {
    try {
      const r = await client.conversations({ outcome, days, limit: 500, offset: 0, q });
      const lines = [["time", "outcome", "question", "answer", "confidence", "model", "cost_usd", "latency_ms"].join(",")];
      r.items.forEach((c) => lines.push([c.created_at, c.outcome, c.question, c.answer, c.confidence, c.model, c.cost_usd, c.latency_ms].map(csvCell).join(",")));
      const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = "conversations.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast(`Exported ${r.items.length} rows` + (r.total > 500 ? ` (first 500 of ${r.total})` : ""));
    } catch (e) { onError(e); }
  }

  return (
    <section id="conversations">
      <div className="panel">
        <h3>Conversations</h3>
        <div className="filters">
          <input className="search" placeholder="Search questions and answers" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setOffset(0); }}>
            <option value="all">All</option><option value="answered">Answered</option><option value="not_answered">Not answered</option>
            <option value="blocked">Blocked</option><option value="error">Errors</option><option value="smalltalk">Small talk</option>
          </select>
          <label className="inline-label">Show
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}>
              {SIZES.map((n) => <option key={n} value={n}>{n === 5 ? "latest 5" : n + " rows"}</option>)}
            </select>
          </label>
          <button className="btn ghost small" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Question</th><th>Result</th><th className="num">Conf.</th><th className="num">Cost</th><th className="num">Time</th></tr></thead>
          <tbody>
            {page.data?.items.map((c) => (
              <Fragment key={c.id}>
                <tr className="click" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <td>{when(c.created_at)}</td><td>{c.question.length > 90 ? c.question.slice(0, 90) + "…" : c.question}</td><td><OutTag o={c.outcome} /></td>
                  <td className="num">{c.confidence == null ? "–" : c.confidence.toFixed(2)}</td><td className="num">{c.cost_usd ? usd(c.cost_usd) : "–"}</td>
                  <td className="num">{c.latency_ms == null ? "–" : (c.latency_ms / 1000).toFixed(1) + "s"}</td>
                </tr>
                {open === c.id && (
                  <tr className="detail"><td colSpan={6} className="detail">
                    <b>Question</b>{c.question}<b>Answer</b>{c.answer || "(none)"}
                    <b>Details</b>{`Visitor ${c.session} · ${c.model ?? "no model"}${c.tier ? ` (${c.tier})` : ""} · ${c.outcome}`}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody></table></div>
        {!page.loading && total === 0 && <div className="empty">No conversations match.</div>}
        {(total > limit || offset > 0) && <div className="pager">
          <button className="btn ghost small" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
          <span className="muted small">{total ? offset + 1 : 0}–{to} of {num(total)}</span>
          <button className="btn ghost small" disabled={to >= total} onClick={() => setOffset(offset + limit)}>Next →</button>
        </div>}
        {total > limit && offset === 0 && <p className="tiny muted" style={{ margin: "8px 0 0" }}>Showing the latest {limit} of {num(total)}. Use "Show" to see more, or export CSV.</p>}
      </div>
    </section>
  );
}
