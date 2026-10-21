import { useEffect, useState } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { ConfirmDialog } from '../shared/Dialog'

/** What has the focus now (`null`: nothing — the page itself). */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * Shows the oldest question in `ui-store.confirmPrompts` (`askConfirmation`)
 * as the shared confirm dialog, above any other dialog. Mounted outside the
 * app shell, so a question asked during startup (e.g. while the sync file
 * loads) still shows. Questions asked one after another are one run: once
 * the last is answered, the focus goes back to what had it before the first
 * (each next dialog opened from the one before, which is gone by then).
 */
export function ConfirmPromptHost() {
  const prompts = useUIStore((s) => s.confirmPrompts)
  const answer = useUIStore((s) => s.answerConfirmation)
  const prompt = prompts.at(0)
  const [run, setRun] = useState<{ opener: HTMLElement | null } | null>(null)
  if (prompt && run === null) setRun({ opener: focusedElement() })
  if (!prompt && run !== null) setRun(null)
  useEffect(() => {
    if (!run) return
    return () => {
      const { opener } = run
      const active = document.activeElement
      const focusLeft = !active || active === document.body || !active.isConnected
      if (opener?.isConnected && focusLeft) opener.focus()
    }
  }, [run])
  if (!prompt) return null
  return (
    <ConfirmDialog
      // One key per question: a new one resets the initial focus; one queued
      // behind it leaves the one on screen (and its focus) alone.
      key={prompt.id}
      open
      title={prompt.title}
      message={prompt.message}
      confirmLabel={prompt.confirmLabel}
      danger={prompt.danger ?? false}
      initialFocus={prompt.cancelIsDefault ? 'cancel' : 'confirm'}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
      nested
    />
  )
}
