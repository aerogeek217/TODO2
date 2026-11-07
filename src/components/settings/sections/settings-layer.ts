import { createContext, useContext, useEffect } from 'react'

/**
 * Counts the editors and dialogs a settings section has opened over the
 * Settings modal (People / Status / Tag / Theme colors editors, the delete
 * completed popup, …). While any is open, Esc belongs to that layer, not to
 * the modal. Outside the modal (the mobile Settings page) there is no
 * provider and the hook does nothing.
 */
export const SettingsLayerContext = createContext<((delta: 1 | -1) => void) | null>(null)

/**
 * Whether the rows are on the phone's Settings page (`SettingsSectionBody`
 * provides it): there a description shows under its label, since touch
 * opens no tooltip; in the desktop modal (the default) it sits behind an ⓘ.
 */
export const SettingsMobileContext = createContext(false)

/** Registers a stacked layer with the Settings modal while `open` is true. */
export function useStackedLayer(open: boolean): void {
  const register = useContext(SettingsLayerContext)
  useEffect(() => {
    if (!open || !register) return
    register(1)
    return () => register(-1)
  }, [open, register])
}
