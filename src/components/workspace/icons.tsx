import type { ReactNode } from 'react'
import type { WidgetKind } from '../../models/workspace-layout'

/**
 * Inline stroke icons for the workspace chrome: 16×16 viewBox, stroke 1.6,
 * round caps and joins, `currentColor`. Decorative — callers label the
 * control that holds them.
 */
function Svg({ size = 14, strokeWidth = 1.6, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const KIND_PATHS: Record<WidgetKind, ReactNode> = {
  lens: (
    <>
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
      <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeWidth={2.2} />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  notes: (
    <>
      <path d="M4 2.5h5.5L12.5 5.5v8H4z" />
      <path d="M6 8h4.5M6 10.5h4.5" />
    </>
  ),
  status: <path d="M3.5 13.5V10M8 13.5V6.5M12.5 13.5V3" />,
}

export function WidgetKindIcon({ kind, size = 14 }: { kind: WidgetKind; size?: number }) {
  return <Svg size={size}>{KIND_PATHS[kind]}</Svg>
}

/** A rounded rect split into three columns: the workspace / layout glyph. */
export function LayoutIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6.5 2.5v11M10 2.5v11" />
    </Svg>
  )
}

export function SaveIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 3.5A1 1 0 0 1 4 2.5h6.5l2.5 2.5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M5.5 2.5v3h4v-3M5 13.5V9.5h6v4" />
    </Svg>
  )
}

export function ChevronDownIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M4 6l4 4 4-4" /></Svg>
}

export function ChevronUpIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M4 10l4-4 4 4" /></Svg>
}

export function ChevronRightIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M6 4l4 4-4 4" /></Svg>
}

export function ChevronLeftIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M10 4l-4 4 4 4" /></Svg>
}

/** Two arrows chasing round: a recurring task. */
export function RepeatIcon({ size = 10 }: { size?: number }) {
  return (
    <Svg size={size} strokeWidth={1.8}>
      <path d="M12.5 6.5A4.5 4.5 0 0 0 4.2 5M3.5 9.5A4.5 4.5 0 0 0 11.8 11" />
      <path d="M4 2.5V5h2.5M12 13.5V11H9.5" />
    </Svg>
  )
}

/** A ring with a dot: jump to today. */
export function TodayIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 8h.01" strokeWidth={3} />
    </Svg>
  )
}

export function PlusIcon({ size = 14, strokeWidth = 1.6 }: { size?: number; strokeWidth?: number }) {
  return <Svg size={size} strokeWidth={strokeWidth}><path d="M8 3v10M3 8h10" /></Svg>
}

export function CloseIcon({ size = 10, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return <Svg size={size} strokeWidth={strokeWidth}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
}

export function MoreIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size} strokeWidth={2.4}>
      <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
    </Svg>
  )
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size} strokeWidth={2}><path d="M3.5 8.5l3 3 6-7" /></Svg>
}

export function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Svg>
  )
}

export function RevertIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H6" />
      <path d="M5.5 4L3 6.5 5.5 9" />
    </Svg>
  )
}

export function PencilIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M10.5 2.5l3 3L6 13H3v-3z" /></Svg>
}

export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
    </Svg>
  )
}

export function SplitRightIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M8 2.5v11" />
    </Svg>
  )
}

export function SplitBelowIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M2 8h12" />
    </Svg>
  )
}

export function CloseCellIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M6 6l4 4M10 6l-4 4" />
    </Svg>
  )
}

/** Funnel: a screen (top-bar) filter. */
export function FunnelIcon({ size = 12 }: { size?: number }) {
  return <Svg size={size}><path d="M2.5 3h11l-4.25 5.25V13l-2.5-1.5V8.25z" /></Svg>
}

/** Sort lines: list options. */
export function SortIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" /></Svg>
}

/** Two chain links: shared between widgets. */
export function LinkIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.75.75" />
      <path d="M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />
    </Svg>
  )
}

/** `@`: people. */
export function AtIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M10.5 8v1a2 2 0 0 0 3 0V8A5.5 5.5 0 1 0 11 12.6" />
    </Svg>
  )
}

/** `#`: tags. */
export function HashIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M6 2.5 5 13.5M11 2.5l-1 11M3 6h10.5M2.5 10H13" /></Svg>
}

/** A flag: follow-up. */
export function FlagIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M4 14V2.5M4 3h7.5l-1.5 3 1.5 3H4" /></Svg>
}

/** A half-filled circle: status. */
export function StatusRingIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" />
    </Svg>
  )
}

/** A magnifier: text search. */
export function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </Svg>
  )
}
