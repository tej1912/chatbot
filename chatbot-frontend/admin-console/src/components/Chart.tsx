import type { DailyPoint } from "../lib/types";
import { usd } from "../lib/format";

export function Chart({ daily, mode }: { daily: DailyPoint[]; mode: "msgs" | "cost" }) {
  const max = Math.max(0, ...daily.map((d) => (mode === "cost" ? d.cost_usd : d.messages)));
  if (!max) return <div className="empty">No data in this period yet.</div>;
  return (
    <div>
      <div className="chart">
        {daily.map((d, i) => (
          <div key={d.day + i} className="bar"
            data-tip={mode === "cost" ? `${d.day} · ${usd(d.cost_usd)}` : `${d.day} · ${d.messages} msgs, ${d.not_answered} not answered`}>
            {mode === "cost" ? (
              <div className="seg c" style={{ height: `${(d.cost_usd / max) * 100}%` }} />
            ) : (
              <>
                <div className="seg n" style={{ height: `${(d.not_answered / max) * 100}%` }} />
                <div className="seg a" style={{ height: `${((d.messages - d.not_answered) / max) * 100}%` }} />
              </>
            )}
          </div>
        ))}
      </div>
      <div className="axis"><span>{daily[0].day}</span><span>{daily[daily.length - 1].day}</span></div>
      {mode === "msgs" && (
        <div className="legend">
          <span><i style={{ background: "#5b3fd9" }} />Answered</span>
          <span><i style={{ background: "#f2b8c3" }} />Not answered</span>
        </div>
      )}
    </div>
  );
}
