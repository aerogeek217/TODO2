import { memo, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import type { PersistedTodoItem, Person, Tag } from '../../../models'
import type { ClustersTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'
import { sharedMemo } from '../../../utils/shared-memo'
import { themeColor } from '../../../utils/theme-color'
import { taskMapFaceFor, type WidgetFace } from '../../../utils/widget-face'
import { buildClusterGraph, layoutClusters, type ClusterGraph, type ClusterNode } from '../../../utils/work-clusters'
import { EntityMenu, type MenuEntity } from '../../shared/EntityMenu'
import { useTooltip } from '../../shared/use-tooltip'
import { clusterDrill } from '../glance/glance-drills'
import { WidgetNameLine } from '../WidgetTopLine'
import styles from './WorkClustersWidget.module.css'

/** The layout is worked out for the field's size rounded to this many px, so a divider drag doesn't redo it every frame. */
const LAYOUT_STEP_PX = 24
/** A bubble this wide or wider shows its name; this wide or wider its count too. */
const NAME_MIN_R = 17
const COUNT_MIN_R = 24

const graphMemo = sharedMemo((
  shown: readonly PersistedTodoItem[],
  people: ReadonlyMap<number, readonly Person[]>,
  tags: ReadonlyMap<number, readonly Tag[]>,
  today: Date,
): ClusterGraph => buildClusterGraph({ todos: shown, peopleOf: (id) => people.get(id), tagsOf: (id) => tags.get(id), today }), 2)

/** The people and tags of the open tasks the screen filter keeps, as a graph with its clusters. */
function useClusterGraph(): ClusterGraph {
  const base = useStatsBase()
  const people = usePersonStore((s) => s.assignedPeopleMap)
  const tags = useTagStore((s) => s.assignedTagsMap)
  return graphMemo(base.shown, people, tags, base.ctx.today)
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** A cluster's name as shown: its tag's, without the `Project:` naming convention's prefix. */
function clusterName(name: string): string {
  return name.replace(/^Project:\s*/i, '') || name
}

/** A cluster's heading: `ATLAS · 120 tasks · 23 overdue`. */
function clusterWords(name: string, tasks: number, overdue: number): string {
  return `${clusterName(name)} · ${plural(tasks, 'task')}${overdue > 0 ? ` · ${overdue} overdue` : ''}`
}

/** The clusters of two or more: the ones the widget draws a halo for and the faces list. */
function groupedClusters(graph: ClusterGraph) {
  return graph.clusters.map((c, i) => ({ ...c, index: i })).filter((c) => c.nodes.length >= 2)
}

/**
 * Work clusters (task maps B2, 2026-11-18): the open tasks' people and tags
 * (screen-filtered) as bubbles sized by their tasks, a person joined to a
 * tag by the tasks they share and drawn near it, so the teams round each
 * piece of work gather by themselves (`utils/work-clusters`). Each cluster
 * of two or more is outlined and named by its biggest tag; its name opens
 * its tasks. A line between two clusters is a bridge, drawn in amber. A
 * bubble opens the person / tag menu (Review, Show tasks, Edit, Delete);
 * hovering it lights its lines.
 */
export function WorkClustersWidget({ tab }: { tab: ClustersTab }) {
  const [faceRef, face] = useWidgetFace(taskMapFaceFor)
  return (
    <div ref={faceRef} className={styles.faceHost} data-clusters={tab.id}>
      {face === 'large' ? <ClustersFull /> : <ClustersFace face={face} />}
    </div>
  )
}

const showCluster = (name: string, todoIds: readonly number[]) => useUIStore.getState().showTaskDialog(clusterDrill(clusterName(name), todoIds))

/** Small: how many clusters, and the biggest. Medium: the clusters as rows. */
function ClustersFace({ face }: { face: Exclude<WidgetFace, 'large'> }) {
  const graph = useClusterGraph()
  const groups = groupedClusters(graph)
  if (face === 'small') {
    const biggest = groups.at(0)
    return (
      <div className={styles.smallFace} role="group" aria-label={`Work clusters: ${groups.length}`} data-clusters-face="small">
        <span className={styles.smallTitle}>Work clusters</span>
        <span className={styles.smallFigures}>
          <span className={styles.smallCount} data-testid="clusters-face-count">{groups.length}</span>
          <span className={styles.smallCaption}>{biggest ? `biggest: ${clusterName(biggest.name)}` : 'none yet'}</span>
        </span>
      </div>
    )
  }
  return (
    <>
    <WidgetNameLine name="Work clusters">
      <span className={styles.lineCount}>{plural(groups.length, 'cluster')}</span>
    </WidgetNameLine>
    <div className={styles.mediumFace} data-clusters-face="medium">
      {groups.length === 0 && <p className={styles.empty}>No people and tags share tasks yet.</p>}
      {groups.map((c) => (
        <button key={c.index} type="button" className={styles.clusterRow} onClick={() => showCluster(c.name, c.todoIds)}>
          <span className={styles.rowName}>{clusterName(c.name)}</span>
          {c.overdue > 0 && <span className={styles.rowLate}>{c.overdue} overdue</span>}
          <span className={styles.rowTotal}>{c.todoIds.length}</span>
        </button>
      ))}
    </div>
    </>
  )
}

interface BubbleProps {
  node: ClusterNode
  x: number
  y: number
  r: number
  /** Its strongest links' words for the tooltip (`Atlas 12, Billing 8`). */
  links: string
  dim: boolean
  onHover: (key: string | null) => void
  onOpen: (node: ClusterNode, at: { x: number; y: number }) => void
}

/** A person's or a tag's bubble. Memoized: plain props. */
const Bubble = memo(function Bubble({ node, x, y, r, links, dim, onHover, onOpen }: BubbleProps) {
  const name = node.kind === 'person' ? node.name : `#${node.name}`
  const meta = `${plural(node.count, 'open task')}${node.overdue > 0 ? ` · ${node.overdue} overdue` : ''}`
  const { triggerProps, tooltip } = useTooltip(`${name}\n${meta}${links ? `\nShares tasks with ${links}` : ''}`)
  const style = {
    left: x - r,
    top: y - r,
    width: r * 2,
    height: r * 2,
    ...(node.color ? { '--node-colour': themeColor(node.color) } : {}),
  } as CSSProperties
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    onOpen(node, e.detail === 0 ? { x: box.left + box.width / 2, y: box.bottom } : { x: e.clientX, y: e.clientY })
  }
  return (
    <button
      type="button"
      className={styles.bubble}
      style={style}
      data-kind={node.kind}
      data-dim={dim ? 'true' : undefined}
      data-cluster-node={node.key}
      aria-label={`${name}: ${meta}`}
      aria-haspopup="menu"
      {...triggerProps}
      onMouseEnter={() => onHover(node.key)}
      onMouseLeave={() => onHover(null)}
      onFocus={(e) => { triggerProps.onFocus?.(e); onHover(node.key) }}
      onBlur={() => { triggerProps.onBlur?.(); onHover(null) }}
      onClick={open}
    >
      {r >= NAME_MIN_R && <span className={styles.bubbleName} aria-hidden="true">{node.name}</span>}
      {r >= COUNT_MIN_R && <span className={styles.bubbleCount} aria-hidden="true">{node.count}</span>}
      {node.overdue > 0 && <span className={styles.badge} aria-hidden="true">{node.overdue}</span>}
      {tooltip}
    </button>
  )
})

/** The whole map (its large face). */
function ClustersFull() {
  const isMobile = useIsMobile()
  const graph = useClusterGraph()
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const [fieldRef, field] = useElementSize()
  const [hover, setHover] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ entity: MenuEntity; at: { x: number; y: number } } | null>(null)

  const stepW = Math.max(LAYOUT_STEP_PX, Math.round(field.width / LAYOUT_STEP_PX) * LAYOUT_STEP_PX)
  const stepH = Math.max(LAYOUT_STEP_PX, Math.round(field.height / LAYOUT_STEP_PX) * LAYOUT_STEP_PX)
  const layout = useMemo(() => layoutClusters(graph, stepW, stepH), [graph, stepW, stepH])
  // Drawn at the field's own size: the layout's place scaled from its rounded one.
  const sx = field.width > 0 ? field.width / stepW : 1
  const sy = field.height > 0 ? field.height / stepH : 1

  const groups = groupedClusters(graph)
  const hoveredIndex = hover == null ? -1 : graph.nodes.findIndex((n) => n.key === hover)
  const lit = useMemo(() => {
    if (hoveredIndex < 0) return null
    const set = new Set<number>([hoveredIndex])
    for (const l of graph.links) {
      if (l.a === hoveredIndex) set.add(l.b)
      if (l.b === hoveredIndex) set.add(l.a)
    }
    return set
  }, [graph, hoveredIndex])
  const linkWords = useMemo(() => graph.nodes.map((_, i) => graph.links
    .filter((l) => l.a === i || l.b === i)
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map((l) => `${graph.nodes[l.a === i ? l.b : l.a]!.name} ${l.weight}`)
    .join(', ')), [graph])

  const openNode = (node: ClusterNode, at: { x: number; y: number }) => {
    const entity: MenuEntity | undefined = node.kind === 'person'
      ? (() => { const p = people.find((x) => x.id === node.id); return p ? { kind: 'person' as const, entity: p } : undefined })()
      : (() => { const t = tags.find((x) => x.id === node.id); return t ? { kind: 'tag' as const, entity: t } : undefined })()
    if (entity) setMenu({ entity, at })
  }

  const ready = field.width > 0 && field.height > 0
  return (
    <>
      <WidgetNameLine name="Work clusters">
        <span className={styles.lineCount} data-testid="clusters-line-count">{plural(groups.length, 'cluster')}</span>
      </WidgetNameLine>
      <div className={styles.widget} data-mobile={isMobile ? 'true' : undefined}>
        <div className={styles.keys} aria-hidden="true">
          <span className={styles.key}><span className={styles.keyPerson} />Person</span>
          <span className={styles.key}><span className={styles.keyTag} />Tag</span>
          <span className={styles.keyNote}>
            Size: open tasks · Line: tasks shared · <span className={styles.keyBridge}>amber: between clusters</span>
            {graph.hidden > 0 && ` · ${graph.hidden} smaller not shown`}
          </span>
        </div>
        <div ref={fieldRef} className={styles.field} role="group" aria-label="People and tags, drawn together by the tasks they share">
          {graph.nodes.length === 0 && <p className={styles.empty} role="status">No open tasks with people or tags.</p>}
          {ready && layout.halos.map((h) => {
            const c = graph.clusters[h.cluster]!
            const style = { left: (h.x - h.r) * sx, top: (h.y - h.r) * sy, width: h.r * 2 * sx, height: h.r * 2 * sy } as CSSProperties
            // Its name on its top edge, kept inside the field.
            const width = Math.min(340, Math.max(110, h.r * 2 * sx - 24))
            const nameAt = {
              left: Math.min(Math.max(h.x * sx, width / 2), field.width - width / 2),
              top: Math.max((h.y - h.r) * sy, 10),
              maxWidth: width,
            } as CSSProperties
            return (
              <div key={h.cluster}>
                <div className={styles.halo} style={style} aria-hidden="true" />
                <button
                  type="button"
                  style={nameAt}
                  className={styles.haloName}
                  data-cluster={c.name}
                  aria-label={`${clusterName(c.name)} cluster: show ${plural(c.todoIds.length, 'task')}`}
                  onClick={() => showCluster(c.name, c.todoIds)}
                >
                  {clusterWords(c.name, c.todoIds.length, c.overdue)}
                </button>
              </div>
            )
          })}
          {ready && graph.links.map((l) => {
            const a = layout.nodes[l.a]!
            const b = layout.nodes[l.b]!
            const ax = a.x * sx
            const ay = a.y * sy
            const dx = b.x * sx - ax
            const dy = b.y * sy - ay
            const t = Math.max(1.5, Math.min(7, l.weight / 2))
            const on = lit ? l.a === hoveredIndex || l.b === hoveredIndex : null
            // A link of one task, and a bridge of fewer than three, shows only while one of its ends is hovered.
            if ((l.weight < 2 || (l.bridge && l.weight < 3)) && on !== true) return null
            const style = {
              left: ax,
              top: ay - t / 2,
              width: Math.hypot(dx, dy),
              height: t,
              transform: `rotate(${Math.atan2(dy, dx)}rad)`,
            } as CSSProperties
            return (
              <div
                key={`${l.a}-${l.b}`}
                className={styles.link}
                style={style}
                data-bridge={l.bridge ? 'true' : undefined}
                data-lit={on === true ? 'true' : on === false ? 'false' : undefined}
                aria-hidden="true"
              />
            )
          })}
          {ready && graph.nodes.map((n, i) => {
            const p = layout.nodes[i]!
            return (
              <Bubble
                key={n.key}
                node={n}
                x={p.x * sx}
                y={p.y * sy}
                r={p.r * Math.min(sx, sy)}
                links={linkWords[i] ?? ''}
                dim={lit != null && !lit.has(i)}
                onHover={setHover}
                onOpen={openNode}
              />
            )
          })}
        </div>
      </div>
      {menu && <EntityMenu entities={[menu.entity]} point={menu.at} closeOnScroll onClose={() => setMenu(null)} />}
    </>
  )
}
