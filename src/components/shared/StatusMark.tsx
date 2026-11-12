import type { StatusLook } from '../../models/status'
import { statusIconValue } from '../../models/icon'
import { EmojiGlyph } from './EmojiGlyph'
import { StatusIcon } from './StatusIcon'

/**
 * A status's mark wherever a status is drawn (rows, pickers, chips, the
 * facts rail, a Breakdown's status rows, Settings): its emoji where it has
 * one (J17), else its glyph (the default one when it has none) — at the
 * size of the text around it (`1em`), in the color around it. A muted emoji
 * takes that color as the glyph does (the status's color, set by the
 * caller); a color emoji keeps its own. `filled` is the glyph's filled form.
 */
export function StatusMark({ status, filled }: { status: StatusLook; filled?: boolean }) {
  const icon = statusIconValue(status)
  if (icon.kind === 'emoji') return <EmojiGlyph emoji={icon.emoji} muted={icon.show !== 'color'} size="1em" />
  return <StatusIcon icon={icon.key} filled={filled} />
}
