import type { TintSpan } from '../../services/nlp-token-tints'
import styles from './TintedText.module.css'

/**
 * A field's text with its tinted token spans (`services/nlp-token-tints`):
 * the mirror a host lays exactly under (Quick Add) or over (the search box)
 * an input whose own text is transparent, in the same font and padding.
 * Tints are a background and a box-shadow, never padding, so no character
 * moves.
 */
export function TintedText({ text, spans }: { text: string; spans: readonly TintSpan[] }) {
  const out: React.ReactNode[] = []
  let at = 0
  for (const s of spans) {
    if (s.start < at || s.end > text.length) continue
    if (s.start > at) out.push(text.slice(at, s.start))
    out.push(<span key={s.start} className={styles.tint} data-tint={s.tint}>{text.slice(s.start, s.end)}</span>)
    at = s.end
  }
  out.push(text.slice(at))
  // A trailing space would collapse; keep the mirror as wide as the input text.
  return <>{out}{'​'}</>
}
