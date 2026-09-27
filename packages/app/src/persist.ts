import * as React from "react";

/**
 * State that outlives a reload — panel widths, which panels are open, the
 * code pane's view. A convenience only: when storage is unavailable
 * (private windows, blocked site data) it is plain state, and nothing
 * depends on it being there.
 */
export function usePersistent<T>(
  key: string,
  initial: T,
  valid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const storageKey = `replay:${key}`;
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return initial;
      const parsed: unknown = JSON.parse(stored);
      return valid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const set = React.useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Not persisted; still set.
      }
    },
    [storageKey],
  );
  return [value, set];
}

export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

export const oneOf =
  <T extends string>(...values: readonly T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T);
