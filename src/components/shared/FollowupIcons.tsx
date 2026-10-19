// Follow-up glyphs (16×16 viewBox, stroke, currentColor). Sized in `em` so
// they follow the surrounding font size like `StatusIcon`.

const svgBase = {
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

/** Flag — the follow-up pill, the row's follow-up cell and editor group heading. `filled` fills the flag. */
export function FollowupFlagIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg {...svgBase} fill={filled ? 'currentColor' : 'none'}>
      <path d="M3.5 14V2.5M3.5 3h7l-1.5 2.5 1.5 2.5h-7" />
    </svg>
  )
}

/** Flag with a check — the "Mark followed up" action. */
export function FollowedUpIcon() {
  return (
    <svg {...svgBase}>
      <path d="M3.5 14V2.5M3.5 3h7l-1.5 2.5 1.5 2.5h-7" />
      <path d="M9 12.2l1.6 1.6 3.4-3.6" />
    </svg>
  )
}
