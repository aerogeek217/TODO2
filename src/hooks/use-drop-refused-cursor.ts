import { useEffect } from 'react'

/**
 * While `refused`, the not-allowed cursor shows wherever the pointer is (a
 * drag over a target that would refuse the drop): `data-drop-refused` on
 * `<html>`, styled with the refusal tooltip (`shared/RefusalTooltip`).
 */
export function useDropRefusedCursor(refused: boolean): void {
  useEffect(() => {
    if (!refused) return
    const root = document.documentElement
    root.setAttribute('data-drop-refused', '')
    return () => root.removeAttribute('data-drop-refused')
  }, [refused])
}
