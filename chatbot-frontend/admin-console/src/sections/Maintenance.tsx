import { useState } from "react";
import { useApp } from "../lib/ctx";

export function Maintenance() {
  const { client, toast, onError } = useApp();
  const [days, setDays] = useState(90);
  const [msg, setMsg] = useState("");
  async function purge() {
    if (!(days >= 1)) return toast("Enter a number of days");
    if (!window.confirm(`Permanently delete all conversations and analytics older than ${days} days? Documents are not affected.`)) return;
    try { const r = await client.deleteEvents(days); setMsg(`Deleted ${r.deleted_events} analytics rows and ${r.deleted_messages} messages.`); } catch (e) { onError(e); }
  }
  return (
    <div className="panel">
      <h3>Delete old conversation data</h3>
      <p className="muted small">Removes saved conversations and analytics older than the number of days. Cannot be undone.</p>
      <div className="row inline"><label>Older than (days)<input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} /></label>
        <button className="btn danger" onClick={purge}>Delete</button></div>
      {msg && <div className="note ok">{msg}</div>}
    </div>
  );
}
