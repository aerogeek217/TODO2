// The Focus marker: a ring with a filled centre dot (16×16 viewBox,
// currentColor). Sized in `em` so it follows the surrounding font size.

/** The focus glyph (decorative); `tooltip` adds a hover tooltip. */
export function FocusIcon({ tooltip }: { tooltip?: string } = {}) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      style={{ verticalAlign: '-0.125em', flexShrink: 0 }}
      aria-hidden
    >
      {tooltip && <title>{tooltip}</title>}
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  )
}

/**
 * The marker a task row shows before its title when the task is in focus:
 * 14×14, `--color-marker-focus`, labelled "Focus". Display only.
 */
export function FocusMarker({ size = 14 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Focus"
      data-testid="focus-marker"
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: size,
        lineHeight: 0,
        color: 'var(--color-marker-focus)',
      }}
    >
      {/* The tooltip rides the SVG (not a `title` attribute on the span), so
          row queries for the title text's `[title]` keep finding the title. */}
      <FocusIcon tooltip="Focus" />
    </span>
  )
}
