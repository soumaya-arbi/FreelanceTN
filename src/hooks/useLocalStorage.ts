"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const initialRaw = useMemo(() => JSON.stringify(initialValue), [initialValue]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initialRaw : stored;
    } catch {
      return initialRaw;
    }
  }, [key, initialRaw]);

  const getServerSnapshot = useCallback(() => initialRaw, [initialRaw]);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<T>(() => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  }, [raw, initialValue]);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      } catch {
        // Ignore storage failures (private mode, quota, etc.).
      }
    },
    [key, value],
  );

  return [value, setValue] as const;
}
