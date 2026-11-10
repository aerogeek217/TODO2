import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'

/**
 * What an expression field holds that its filter doesn't yet: typed text not
 * written (`pending` — it writes after a pause, on blur or Enter), and
 * whether that text doesn't read (`unreadable` — it is never written).
 */
export interface ExpressionFieldState {
  pending: boolean
  unreadable: boolean
}

type Reporter = (key: string, state: ExpressionFieldState | null) => void

/**
 * Where the expression fields inside an editor with a Save button report
 * their text (the widget editors' Save / Discard): Save is offered while a
 * field holds typed text and held back while that text doesn't read.
 * Outside such an editor nobody listens.
 */
const ExpressionReportContext = createContext<Reporter | null>(null)

export const ExpressionReportProvider = ExpressionReportContext.Provider

/** An expression field reports its text's state to the editor it is in, if that one listens. */
export function useReportExpressionField(state: ExpressionFieldState): void {
  const report = useContext(ExpressionReportContext)
  const key = useId()
  const { pending, unreadable } = state
  useEffect(() => {
    report?.(key, { pending, unreadable })
  }, [report, key, pending, unreadable])
  useEffect(() => () => report?.(key, null), [report, key])
}

/**
 * The listening side: the reporter to provide (`ExpressionReportProvider`)
 * and what the fields under it hold together — any typed text not written,
 * any that doesn't read.
 */
export function useExpressionReports(): { report: Reporter; pending: boolean; unreadable: boolean } {
  const [fields, setFields] = useState<ReadonlyMap<string, ExpressionFieldState>>(new Map())
  const report = useCallback<Reporter>((key, state) => {
    setFields((prev) => {
      const was = prev.get(key)
      if (state == null ? was == null : was?.pending === state.pending && was.unreadable === state.unreadable) return prev
      const next = new Map(prev)
      if (state == null) next.delete(key)
      else next.set(key, state)
      return next
    })
  }, [])
  return useMemo(() => {
    const all = [...fields.values()]
    return { report, pending: all.some((f) => f.pending), unreadable: all.some((f) => f.unreadable) }
  }, [fields, report])
}
