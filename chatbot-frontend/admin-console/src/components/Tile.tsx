export function Tile({ k, v, s, accent }: { k: string; v: string; s?: string; accent?: boolean }) {
  return (
    <div className={"stat" + (accent ? " accent" : "")}>
      <div className="k">{k}</div><div className="v">{v}</div><div className="s">{s ?? ""}</div>
    </div>
  );
}
