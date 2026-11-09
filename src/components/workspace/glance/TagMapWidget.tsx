import { useMemo } from 'react'
import type { TagMapTab } from '../../../models/workspace-layout'
import { useTagMapData } from '../../../hooks/use-chart-data'
import { useElementSize } from '../../../hooks/use-element-size'
import { lensHidesFor, useLensHidden, useStatsBase } from '../../../hooks/use-glance-data'
import { TabLensSwitch } from '../LensSwitch'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { lateShare, type TagMapTile } from '../../../services/stats/tag-map'
import { squarify } from '../../../utils/treemap'
import { chartDrill } from './chart-drills'
import { ChartPanel } from './chart-parts'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Empty } from './section-parts'
import styles from './TagMapWidget.module.css'

/** A tile's name: a tag's with its `#`. */
const tileName = (t: TagMapTile) => (t.tag ? `#${t.label}` : t.label)

/** A tile's colour: the overdue colour at its late share (none late: neutral). */
function tileBackground(t: TagMapTile): string {
  const share = lateShare(t)
  if (share === 0) return 'var(--color-tint-6)'
  return `color-mix(in srgb, var(--color-overdue) ${Math.round(14 + 46 * share)}%, var(--color-surface))`
}

/** Copy: `Tag map 12 open`, then each tile, `#Atlas 23 (7 late)`. */
function tagMapLines(title: string, tiles: readonly TagMapTile[]): SummaryPart[][] {
  const open = new Set(tiles.flatMap((t) => t.ids)).size
  return [
    [{ label: title, count: `${open} open` }],
    tiles.map((t) => ({ label: tileName(t), count: `${t.ids.length}${t.lateIds.length > 0 ? ` (${t.lateIds.length} late)` : ''}` })),
  ]
}

/** The tiles laid out as a squarified treemap in the measured area; each opens its open tasks. */
function Treemap({ title, tiles, onDrill }: { title: string; tiles: readonly TagMapTile[]; onDrill?: OnGlanceDrill }) {
  const [ref, size] = useElementSize()
  const rects = useMemo(
    () => squarify(tiles.map((t) => t.ids.length), { x: 0, y: 0, w: size.width, h: size.height }),
    [tiles, size.width, size.height],
  )
  return (
    <div ref={ref} className={styles.area} role="group" aria-label={`${title}: open tasks by tag`}>
      {size.width > 0 && tiles.map((t, i) => {
        const r = rects[i]
        if (!r || r.w < 1 || r.h < 1) return null
        const words = `${tileName(t)}: ${t.ids.length} open, ${t.lateIds.length} late`
        const style = { left: r.x, top: r.y, width: r.w, height: r.h, background: tileBackground(t) }
        const content = (
          <>
            <span className={styles.name}>{tileName(t)}</span>
            <span className={styles.sub}>{`${t.ids.length} open · ${t.lateIds.length} late`}</span>
          </>
        )
        return onDrill ? (
          <button
            key={t.key}
            type="button"
            className={styles.tile}
            style={style}
            data-tile={t.key}
            aria-label={`${words}. Show tasks`}
            title={words}
            onClick={() => onDrill(chartDrill(
              `${title} · ${tileName(t)}`,
              'tag',
              t.tag ? `${title}: the open tasks tagged #${t.label}.` : `${title}: the open tasks with no tag.`,
              t.ids,
            ))}
          >
            {content}
          </button>
        ) : <div key={t.key} className={styles.tile} style={style} data-tile={t.key} title={words}>{content}</div>
      })}
    </div>
  )
}

/**
 * The Tag map widget (D26 P8, board Z1): a tile per tag on the open tasks
 * its filter keeps under the top bar's filter — every tag (and No tags), or
 * the ones its ⋯ menu picks —, sized by its open tasks and coloured by its
 * share that is late, so the big red ones jump out. A tile opens its
 * tasks. Small face: its title and the largest tag; medium and large: the
 * map.
 */
export function TagMapWidget({ tab, onResult, onDrill }: GlanceWidgetProps<TagMapTab>) {
  const config = tab.config
  const base = useStatsBase()
  const data = useTagMapData(base, config)
  const [faceRef, face] = useWidgetFace()
  const title = config.name.trim() || 'Tag map'
  const lines = useMemo(() => tagMapLines(title, data.tiles), [title, data.tiles])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, data.count.filtered)
  const top = data.tiles.at(0)
  const lensHides = lensHidesFor(useLensHidden(), config.filter)
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph="tag"
          glyphColor="var(--color-accent)"
          title={title}
          entry={top ? tileName(top) : undefined}
          value={String(top?.ids.length ?? 0)}
          caption="open"
        />
      ) : (
        <ChartPanel
          tabId={tab.id}
          kind="tagMap"
          title={title}
          glyph="tag"
          sub={config.tagIds ? `${config.tagIds.length} ${config.tagIds.length === 1 ? 'tag' : 'tags'}` : 'Every tag'}
          lens={<TabLensSwitch tab={tab} hides={lensHides} />}
        >
          {data.tiles.length === 0
            ? <Empty title="No open tasks" hint="The open tasks this map's filter keeps show here, a tile per tag." />
            : <Treemap title={title} tiles={data.tiles} onDrill={drill} />}
        </ChartPanel>
      )}
    </GlanceFrame>
  )
}
