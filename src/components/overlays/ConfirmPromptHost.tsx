import { useUIStore } from '../../stores/ui-store'
import { ConfirmDialog } from '../shared/Dialog'

/**
 * Shows the oldest question in `ui-store.confirmPrompts` (`askConfirmation`)
 * as the shared confirm dialog, above any other dialog. Mounted outside the
 * app shell, so a question asked during startup (e.g. while the sync file
 * loads) still shows.
 */
export function ConfirmPromptHost() {
  const prompts = useUIStore((s) => s.confirmPrompts)
  const answer = useUIStore((s) => s.answerConfirmation)
  const prompt = prompts.at(0)
  if (!prompt) return null
  return (
    <ConfirmDialog
      // A new key per question resets the initial focus.
      key={`${prompts.length}:${prompt.title}`}
      open
      title={prompt.title}
      message={prompt.message}
      confirmLabel={prompt.confirmLabel}
      cancelLabel={prompt.cancelLabel ?? 'Cancel'}
      danger={prompt.danger ?? false}
      initialFocus={prompt.cancelIsDefault ? 'cancel' : 'confirm'}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
      nested
    />
  )
}
