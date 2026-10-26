import type { Stats } from "../lib/types";
import { Tile } from "../components/Tile";
import { Chart } from "../components/Chart";
import { compact, num, pct, usd } from "../lib/format";

export function Summary({ stats }: { stats: Stats | null }) {
  const t = stats?.totals;
  return (
    <section id="summary">
      <div className="stats">
        {t && <>
          <Tile k="Questions" v={num(t.messages)} s={`${num(t.sessions)} visitors`} />
          <Tile k="Answer rate" v={pct(t.answer_rate)} s={`${num(t.not_answered)} not answered`} />
          <Tile k="Avg. response" v={(t.avg_latency_ms / 1000).toFixed(1) + "s"} s={`confidence ${(t.avg_confidence || 0).toFixed(2)}`} />
          <Tile k="Estimated cost" v={usd(t.cost_usd)} s={`${usd(t.cost_per_llm_answer_usd)} per AI answer`} accent />
          <Tile k="Tokens in / out" v={`${compact(t.input_tokens)} / ${compact(t.output_tokens)}`} s={`${num(t.cache_hits)} answers from cache (free)`} />
        </>}
      </div>
      <div className="grid2">
        <div className="panel"><h3>Messages per day</h3>{stats && <Chart daily={stats.daily} mode="msgs" />}</div>
        <div className="panel"><h3>Estimated cost per day (USD)</h3>{stats && <Chart daily={stats.daily} mode="cost" />}
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>{stats?.cost_note || "Estimates only. Check your AI provider's dashboard for the real bill."}</p>
          <h3 className="mt">Cost by model</h3>
          <div className="table-wrap"><table><thead><tr><th>Model</th><th className="num">Answers</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {stats?.by_model.length === 0 && <tr><td colSpan={3} className="empty">No AI answers in this period.</td></tr>}
              {stats?.by_model.map((m) => <tr key={m.model}><td>{m.model + (m.priced ? "" : " (no price set)")}</td><td className="num">{num(m.answers)}</td><td className="num">{usd(m.cost_usd)}</td></tr>)}
            </tbody></table></div></div>
      </div>
    </section>
  );
}
