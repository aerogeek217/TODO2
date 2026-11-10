import { useEffect, useState } from 'react'

/**
 * The screen filter's field's placeholder (the top bar's, the phone filter
 * sheet's, the task dialog's filter bar's): `Filter…`, and while `cycling`
 * (the empty field has the focus) the token examples in turn (D16), so the
 * grammar can be found.
 */
export const FILTER_PLACEHOLDERS = ['Filter…', 'Filter… @person', 'Filter… #tag', 'Filter… !status', 'Filter… overdue', 'Filter… due fri'] as const
const PLACEHOLDER_MS = 2500

export function useFilterPlaceholder(cycling: boolean): string {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!cycling) return
    const id = setInterval(() => setStep((n) => n + 1), PLACEHOLDER_MS)
    return () => clearInterval(id)
  }, [cycling])
  return cycling ? FILTER_PLACEHOLDERS[step % FILTER_PLACEHOLDERS.length] ?? 'Filter…' : 'Filter…'
}
