import { useEffect, useRef } from 'react'
import { CHORD_TIMEOUT_MS } from '../constants'
import { SHORTCUT_IDS, shortcutSpec, type ShortcutId } from '../models/keyboard-shortcut'
import {
  SHORTCUT_HANDLERS,
  type ShortcutCallbacks,
  type ShortcutCtx,
} from '../services/keyboard-shortcuts'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { resolveBindings } from '../utils/shortcut-bindings'
import { comboMatchesEvent, sequenceKeyMatchesEvent } from '../utils/shortcut-chord'
import { useLatestRef } from './use-latest-ref'

interface KeyboardShortcutOptions extends ShortcutCallbacks {
  enabled?: boolean
}

/**
 * The app's keyboard shortcuts (desktop): matches each key press against the
 * live bindings — the defaults with the user's changes
 * (`settings.shortcutOverrides`), read at the key press, so a change applies
 * at once — and runs the binding's handler.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutOptions) {
  const { enabled = true, ...callbacks } = options
  const pendingChordRef = useRef<{ key: string; timestamp: number } | null>(null)

  // Refresh on every commit so handlers see the latest callbacks without
  // re-registering the keydown listener.
  const cbRef = useLatestRef<ShortcutCallbacks>(callbacks)

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null
      // Inside a modal dialog no app shortcut fires, not even the ones
      // allowed in text fields (they'd act on the page behind it).
      if (inModal(target) || inModal(active)) {
        pendingChordRef.current = null
        return
      }
      const isInput = isTextField(target) || isTextField(active)
      const ctx: ShortcutCtx = { e, callbacks: cbRef.current }
      const bindings = resolveBindings(useSettingsStore.getState().shortcutOverrides)

      // 1. Sequence completion: if a sequence's first key is pending, try to
      //    consume this keystroke as its second key. Always clears pending —
      //    an unmatched second key falls through to normal handling.
      const pending = pendingChordRef.current
      if (pending && Date.now() - pending.timestamp < CHORD_TIMEOUT_MS) {
        pendingChordRef.current = null
        if (!isInput) {
          const seq = SHORTCUT_IDS.find((id) => {
            const [first, second] = bindings[id]
            return second !== undefined && first.key === pending.key && sequenceKeyMatchesEvent(e, second)
          })
          if (seq) {
            e.preventDefault()
            await SHORTCUT_HANDLERS[seq](ctx)
            return
          }
        }
      } else if (pending) {
        pendingChordRef.current = null
      }

      // 2. Single-combo lookup. Bindings opt in to firing in inputs via
      //    `allowInInput`; without that flag a focused input short-circuits.
      const single: ShortcutId | undefined = SHORTCUT_IDS.find((id) => {
        const [only, second] = bindings[id]
        return second === undefined && comboMatchesEvent(e, only)
      })
      if (single) {
        const spec = shortcutSpec(single)
        if (isInput && !spec.allowInInput) return
        if (spec.blockedByEditPopup && useUIStore.getState().editPopupMode) return
        await SHORTCUT_HANDLERS[single](ctx)
        return
      }

      // 3. Sequence start: a plain key with no modifiers that is the first
      //    key of a sequence (e.g. `g`) waits for the second.
      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (SHORTCUT_IDS.some((id) => bindings[id].length === 2 && bindings[id][0].key === k)) {
          e.preventDefault()
          pendingChordRef.current = { key: k, timestamp: Date.now() }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, cbRef])
}

function inModal(el: HTMLElement | null): boolean {
  return typeof el?.closest === 'function' && el.closest('[data-shortcut-scope="modal"]') !== null
}

function isTextField(el: HTMLElement | null): boolean {
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (el.isContentEditable) return true
  if (typeof el.closest !== 'function') return false
  if (el.closest('[contenteditable="true"], [contenteditable=""]')) return true
  if (el.closest('[data-shortcut-scope="none"]')) return true
  return false
}
