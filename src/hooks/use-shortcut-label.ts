import type { ShortcutId } from '../models/keyboard-shortcut'
import { useSettingsStore } from '../stores/settings-store'
import { shortcutLabel } from '../utils/shortcut-bindings'

/** The live keys of a binding as the user reads them (`Ctrl+Space`, `G then S`); follows the user's changes. */
export function useShortcutLabel(id: ShortcutId): string {
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  return shortcutLabel(id, overrides)
}
