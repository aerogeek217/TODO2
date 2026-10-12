// Slash-command glyphs (16×16 viewBox, currentColor, sized in `em`). The
// colour comes from the caller: each command keeps its marker / pill colour.
// Decorative.

import type { SlashCommandName } from '../../services/slash-commands'
import { FocusIcon, ImportantIcon, UrgentIcon } from './MarkerIcons'
import { FollowupFlagIcon } from './FollowupIcons'
import { StatusIcon } from './StatusIcon'

const strokeSvg = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 16 16',
  style: { verticalAlign: '-0.125em', flexShrink: 0 } as const,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** A calendar page: the due date. */
export function CalendarIcon() {
  return (
    <svg {...strokeSvg}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
    </svg>
  )
}

/** Two arrows chasing round: a repeating task. */
export function RepeatGlyph() {
  return (
    <svg {...strokeSvg} strokeWidth={1.7}>
      <path d="M12.5 6.5A4.5 4.5 0 0 0 4.2 5M3.5 9.5A4.5 4.5 0 0 0 11.8 11" />
      <path d="M4 2.5V5h2.5M12 13.5V11H9.5" />
    </svg>
  )
}

/** The menu glyph of a command. */
export function CommandIcon({ command }: { command: SlashCommandName }) {
  switch (command) {
    case 'urgent': return <UrgentIcon />
    case 'important': return <ImportantIcon />
    case 'focus': return <FocusIcon />
    case 'due': return <CalendarIcon />
    case 'followup': return <FollowupFlagIcon />
    case 'repeat': return <RepeatGlyph />
    case 'status': return <StatusIcon icon="circle" />
  }
}
