import { useState } from 'react'

/**
 * `value`, or the value returned before while `equal` says they are the same
 * — so a memo keyed on it re-runs only on a change that matters, not on every
 * new object (the Eisenhower panes after a name-only edit classify the tasks
 * as before).
 */
export function useEqualValue<T>(value: T, equal: (a: T, b: T) => boolean): T {
  const [kept, setKept] = useState(value)
  if (kept === value || equal(kept, value)) return kept
  setKept(value)
  return value
}
