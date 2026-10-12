import type { ReactNode } from 'react'

/** 14px stroke icons for the Settings section list (16×16 viewBox, `currentColor`). Decorative. */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function AppearanceIcon() {
  return <Svg><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" /></Svg>
}

export function TaskDefaultsIcon() {
  return <Svg><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M5.5 8.2l1.8 1.8 3.3-3.6" /></Svg>
}

export function EntitiesIcon() {
  return <Svg><circle cx="8" cy="8" r="2.4" /><path d="M10.4 8v.9a1.9 1.9 0 0 0 3.6.8A6 6 0 1 0 11.2 13" /></Svg>
}

export function CompletedIcon() {
  return <Svg><path d="M3 8.5l3.2 3.2L13 4.8" /></Svg>
}

export function FileStorageIcon() {
  return <Svg><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></Svg>
}

export function BackupsIcon() {
  return <Svg><path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.7" /><path d="M2.5 2.8v2.5H5" /><path d="M8 5.2V8l1.8 1.3" /></Svg>
}

export function ImportExportIcon() {
  return <Svg><path d="M8 2.5v7.5M5 7l3 3 3-3" /><path d="M3 12.5h10" /></Svg>
}

export function DataIntegrityIcon() {
  return <Svg><ellipse cx="8" cy="4" rx="4.5" ry="1.8" /><path d="M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4" /><path d="M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" /></Svg>
}

export function KeyboardIcon() {
  return <Svg><rect x="1.8" y="4" width="12.4" height="8" rx="1.6" /><path d="M4.5 6.6h.01M7 6.6h.01M9.5 6.6h.01M12 6.6h.01M5.5 9.4h5" strokeWidth={1.8} /></Svg>
}

export function AboutIcon() {
  return <Svg><circle cx="8" cy="8" r="5.5" /><path d="M8 7.4v3.2M8 5.3h.01" strokeWidth={1.8} /></Svg>
}
