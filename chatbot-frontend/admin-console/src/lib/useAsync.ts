import { useEffect, useState } from "react";
import { useApp } from "./ctx";

/** Run an async loader whenever deps change. Ignores stale responses. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], silent = false) {
  const { onError } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader().then((d) => { if (alive) setData(d); }).catch((e) => { if (alive && !silent) onError(e); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, loading, reload: () => setTick((t) => t + 1) };
}
