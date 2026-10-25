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
      <circle cx="2.75" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="12" r=".9" fill="currentColor" stroke="none" />
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
  eisenhower: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M8 2.5v11M2.5 8h11" />
    </>
  ),
  dashboard: (
    <path d="M3.5 2.5h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM9.5 2.5h3a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1zM3.5 10.5h3a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1zM9.5 8h3a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
  ),
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
    <Svg size={size}>
      <path d="M12.5 6.5A4.5 4.5 0 0 0 4.2 5M3.5 9.5A4.5 4.5 0 0 0 11.8 11" />
      <path d="M4 2.5V5h2.5M12 13.5V11H9.5" />
    </Svg>
  )
}

/** A page with a folded corner and two lines: a task's progress / notes. */
export function NotesIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3.5 2h6l3 3v9h-9z" />
      <path d="M9.5 2v3h3" />
      <path d="M5.5 8.5h5M5.5 11h3.5" />
    </Svg>
  )
}

/** Lines of text: show titles. */
export function TitlesIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M3 4.5h10M3 8h10M3 11.5h6" /></Svg>
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

/** The Settings gear (stroke ≈ 1.9 at 16px): Settings, Customize dashboard. */
export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
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

/** A full-width band: a rounded rect with a thick bar along its top (or bottom) edge. */
export function BandIcon({ edge, size = 14 }: { edge: 'top' | 'bottom'; size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d={edge === 'top' ? 'M3.5 5h9' : 'M3.5 11h9'} strokeWidth={2.6} />
    </Svg>
  )
}

/** Six dots in two rows of three: a panel header's drag grip. */
export function GripIcon() {
  return (
    <svg width="15" height="9" viewBox="0 0 15 9" fill="currentColor" aria-hidden="true">
      {[1.5, 7.5, 13.5].map((x) => [1.5, 7.5].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />))}
    </svg>
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

/** Glasses: a lens (a layout's saved screen filter); `slashed` = lifted for now. */
export function GlassesIcon({ size = 16, slashed = false }: { size?: number; slashed?: boolean }) {
  return (
    <Svg size={size}>
      <circle cx="4.5" cy="10" r="3" />
      <circle cx="11.5" cy="10" r="3" />
      <path d="M7.5 10h1M1.5 9.5 3.5 4h2M14.5 9.5 12.5 4h-2" />
      {slashed && <path d="M2.5 14 13.5 3" />}
    </Svg>
  )
}

/** Sort lines: a list's group · sort. */
export function SortIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" /></Svg>
}

/** An arrow up (a sort's natural order) or down (reversed). */
export function SortDirectionIcon({ direction, size = 14 }: { direction: 'asc' | 'desc'; size?: number }) {
  return (
    <Svg size={size}>
      {direction === 'asc'
        ? <path d="M8 13V3M4 7l4-4 4 4" />
        : <path d="M8 3v10M4 9l4 4 4-4" />}
    </Svg>
  )
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

/** A box with an arrow out of its corner: open. */
export function OpenIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M9.5 2.5h4v4M13.5 2.5 8 8" />
      <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </Svg>
  )
}

/** A check in a circle: complete. */
export function CheckCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.75 8.25l1.6 1.6 2.9-3.2" />
    </Svg>
  )
}

/** A head and shoulders: a person. */
export function PersonIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" />
    </Svg>
  )
}

/** An envelope: email. */
export function EnvelopeIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.75 8 8.75l5.5-4" />
    </Svg>
  )
}

/** A short bar: the mixed state of a checkbox item. */
export function DashIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size} strokeWidth={2}><path d="M4.5 8h7" /></Svg>
}

/** A page with a folded corner: the sync file. */
export function FileIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4 2h5l3.5 3.5V14H4z" />
      <path d="M9 2v3.5h3.5" />
    </Svg>
  )
}

/** A padlock: access to the sync file is needed. */
export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Svg>
  )
}

/** Two bars: sync paused. */
export function PauseIcon({ size = 14 }: { size?: number }) {
  return <Svg size={size}><path d="M6 4v8M10 4v8" /></Svg>
}

/** A circle with an exclamation mark: something failed. */
export function AlertCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.2v3.3M8 10.8h.01" />
    </Svg>
  )
}

/** A triangle with an exclamation mark: a warning (backups). */
export function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.2h.01" />
    </Svg>
  )
}

/** A circle with an i: a status note. */
export function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3.3M8 5.2h.01" />
    </Svg>
  )
}
