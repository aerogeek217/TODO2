import { useEffect, useState, type ReactNode } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useCanvasRailsStore, createLensSlot } from '../../../stores/canvas-rails-store'
import type { RailSide, Slot } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { Slot as SlotComponent } from './Slot'
import { SlotHeader } from './SlotHeader'
import { LensSlotContent } from './LensSlotContent'
import styles from './RailsFrame.module.css'

interface RailsFrameProps {
  children: ReactNode
}

/** Default rails: right-side lens slot showing the `thisweek` horizon. */
function useDefaultRails() {
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const listDefinitionsLoaded = useListDefinitionStore((s) => s.listDefinitions.length > 0)
  const { rails, hydrated, hydrate } = useCanvasRailsStore()

  useEffect(() => {
    if (hydrated) return
    if (!listDefinitionsLoaded) return
    const thisweekId = horizonSlots?.thisweek
    const slot = createLensSlot(thisweekId)
    hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
  }, [hydrated, hydrate, horizonSlots, listDefinitionsLoaded])

  return rails
}

function SlotRenderer({ slot }: { slot: Slot }) {
  const closeSlot = useCanvasRailsStore((s) => s.closeSlot)
  const [title, setTitle] = useState<string>('')
  const [count, setCount] = useState<number>(0)

  if (slot.kind === 'lens') {
    return (
      <SlotComponent
        header={(
          <SlotHeader
            title={<span>◴ {title || 'Lens'}</span>}
            meta={count > 0 ? count : undefined}
            onClose={() => closeSlot(slot.id)}
          />
        )}
      >
        <LensSlotContent
          listDefinitionId={slot.listDefinitionId}
          onTitleChange={(t, c) => {
            setTitle(t)
            setCount(c)
          }}
        />
      </SlotComponent>
    )
  }

  // notes / calendar land in later phases
  return (
    <SlotComponent
      header={<SlotHeader title={slot.kind} onClose={() => closeSlot(slot.id)} />}
    >
      <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-meta)' }}>
        Coming soon
      </div>
    </SlotComponent>
  )
}

export function RailsFrame({ children }: RailsFrameProps) {
  const rails = useDefaultRails()

  const renderRail = (side: RailSide) => {
    const rail = rails[side]
    if (!rail) return null
    return (
      <RailContainer side={side} rail={rail}>
        {rail.slots.map((slot) => (
          <SlotRenderer key={slot.id} slot={slot} />
        ))}
      </RailContainer>
    )
  }

  return (
    <div className={styles.frame}>
      {renderRail('left')}
      <div className={styles.center}>
        {renderRail('top')}
        <div className={styles.canvasHost}>{children}</div>
        {renderRail('bottom')}
      </div>
      {renderRail('right')}
    </div>
  )
}
