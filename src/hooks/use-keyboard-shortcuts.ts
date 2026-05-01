import { useEffect, useRef } from 'react'
import { CHORD_TIMEOUT_MS } from '../constants'
import {
  matchChord,
  SEQUENCE_BINDINGS,
  SEQUENCE_PREFIXES,
  SINGLE_BINDINGS,
  type ShortcutCallbacks,
  type ShortcutCtx,
} from '../services/keyboard-shortcuts'
import { useUIStore } from '../stores/ui-store'

interface KeyboardShortcutOptions extends ShortcutCallbacks {
  enabled?: boolean
}

export function useKeyboardShortcuts(options: KeyboardShortcutOptions) {
  const { enabled = true, ...callbacks } = options
  const pendingChordRef = useRef<{ key: string; timestamp: number } | null>(null)

  // Refresh on every render so handlers see the latest callbacks without
  // re-registering the keydown listener.
  const cbRef = useRef<ShortcutCallbacks>(callbacks)
  cbRef.current = callbacks

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null
      const isInput = isTextField(target) || isTextField(active)
      const ctx: ShortcutCtx = { e, callbacks: cbRef.current }

      // 1. Chord completion: if a sequence prefix is pending, try to consume
      //    this keystroke as the second key. Always clears pending — invalid
      //    second keys fall through to normal handling.
      const pending = pendingChordRef.current
      if (pending && Date.now() - pending.timestamp < CHORD_TIMEOUT_MS) {
        pendingChordRef.current = null
        if (!isInput) {
          const second = e.key.toLowerCase()
          const seq = SEQUENCE_BINDINGS.find(b => b.prefix === pending.key && b.key === second)
          if (seq) {
            e.preventDefault()
            await seq.handler(ctx)
            return
          }
        }
      } else if (pending) {
        pendingChordRef.current = null
      }

      // 2. Single binding lookup. Bindings opt in to firing in inputs via
      //    `allowInInput`; without that flag a focused input short-circuits.
      const binding = SINGLE_BINDINGS.find(b => matchChord(e, b.chord))
      if (binding) {
        if (isInput && !binding.allowInInput) return
        if (binding.blockedByEditPopup && useUIStore.getState().editPopupMode) return
        await binding.handler(ctx)
        return
      }

      // 3. Sequence prefix initiation: a bare key with no modifiers that
      //    starts a known sequence (e.g., `g`) primes pendingChordRef.
      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (SEQUENCE_PREFIXES.has(k)) {
          e.preventDefault()
          pendingChordRef.current = { key: k, timestamp: Date.now() }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
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
