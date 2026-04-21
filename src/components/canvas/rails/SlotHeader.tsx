import type { HTMLAttributes, ReactNode } from 'react'
import type { SlotKind } from '../../../models/canvas-rails'
import { WidgetHeader } from '../../shared/WidgetHeader'

interface SlotHeaderProps {
  title: ReactNode
  meta?: ReactNode
  slotKind: SlotKind
  onMore?: (anchor: { x: number; y: number }) => void
  onPopOut?: () => void
  menuOpen?: boolean
  onClose?: () => void
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement> }
  moreButtonRef?: React.Ref<HTMLButtonElement>
  onTitleClick?: (anchor: { x: number; y: number }) => void
  titleMenuOpen?: boolean
  onAddTab?: (kind: SlotKind) => void
}

export function SlotHeader({
  title,
  meta,
  slotKind,
  onMore,
  onPopOut,
  menuOpen,
  onClose,
  dragHandleProps,
  moreButtonRef,
  onTitleClick,
  titleMenuOpen,
  onAddTab,
}: SlotHeaderProps) {
  return (
    <WidgetHeader
      kind={slotKind}
      title={title}
      meta={meta}
      onMore={onMore}
      menuOpen={menuOpen}
      moreButtonRef={moreButtonRef}
      onPopOut={onPopOut}
      onClose={onClose}
      dragHandleProps={dragHandleProps ?? {}}
      onTitleClick={onTitleClick}
      titleMenuOpen={titleMenuOpen}
      onAddTab={onAddTab}
    />
  )
}
