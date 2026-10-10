import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ensurePlatforms,
  ensureReportContent,
  platformContentLoaded,
  reportContentLoaded,
} from "./catalogue";

let tick = 0;
const listeners = new Set<() => void>();

function bump() {
  tick += 1;
  for (const l of listeners) l();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

const getTick = () => tick;

/** True once every listed platform's questions/assets are in the catalogue. */
export function useEnsurePlatforms(ids: readonly string[]): boolean {
  const key = useMemo(() => [...ids].sort().join(","), [ids]);
  const version = useSyncExternalStore(subscribe, getTick, getTick);
  const ready = ids.every((id) => platformContentLoaded(id));

  useEffect(() => {
    if (ids.every((id) => platformContentLoaded(id))) return;
    let cancelled = false;
    void ensurePlatforms(ids).then(() => {
      if (!cancelled) bump();
    });
    return () => {
      cancelled = true;
    };
  }, [key, ids, version]);

  return ready;
}

/** True once full frameworks (ISM etc.) are merged for report / baseline annotation. */
export function useEnsureReportContent(): boolean {
  const version = useSyncExternalStore(subscribe, getTick, getTick);
  const ready = reportContentLoaded();

  useEffect(() => {
    if (reportContentLoaded()) return;
    let cancelled = false;
    void ensureReportContent().then(() => {
      if (!cancelled) bump();
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return ready;
}
