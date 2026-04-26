import { useEffect, useMemo } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoEventStore } from '../../../stores/todo-event-store'
import { selectDisciplineMetrics, type ScoreMetric } from '../../../services/stats/discipline'
import { weeklyBuckets } from '../../../services/stats/buckets'
import styles from './ScoreboardSlotContent.module.css'

const WEEKS = 12

/**
 * Rail/float widget body for the `scoreboard` widget kind. Renders a three-card
 * grid (defer / completion / lag) with 12-week sparklines, driven by
 * `selectDisciplineMetrics` over `todoEvents` + `todos`.
 *
 * Subscribes to `useTodoStore.todos` (any field-only or id-set mutation
 * produces a new array reference — see `bulkUpdateField` in store-helpers) and
 * pulls events via `useTodoEventStore.loadInRange` on mount + on every todos
 * change. The event-store cache is shared across stat widgets.
 */
export function ScoreboardSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const events = useTodoEventStore((s) => s.events)

  const window = useMemo(() => {
    const now = new Date()
    const buckets = weeklyBuckets(now, WEEKS, weekStartsOn)
    return {
      from: buckets[0]?.start ?? now,
      to: buckets[buckets.length - 1]?.end ?? now,
      now,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartsOn])

  useEffect(() => {
    void useTodoEventStore.getState().loadInRange(window.from, window.to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.from.getTime(), window.to.getTime(), todos, todosVersion])

  const metrics = useMemo(
    () => selectDisciplineMetrics({
      events,
      todos,
      now: window.now,
      weekStartsOn,
      weeks: WEEKS,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, todos, todosVersion, weekStartsOn, window.now.getTime()],
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.rangeLabel}>{WEEKS} weeks</div>
      <div className={styles.grid}>
        {metrics.map((m) => (
          <ScoreCard key={m.id} metric={m} />
        ))}
      </div>
    </div>
  )
}

function ScoreCard({ metric }: { metric: ScoreMetric }) {
  const last = metric.values.at(-1) ?? 0
  const first = metric.values[0] ?? 0
  const delta = last - first
  const improving = metric.lowerIsBetter ? delta < 0 : delta > 0
  const flat = delta === 0

  return (
    <div className={styles.card}>
      <div className={styles.label}>{metric.label}</div>
      <div className={styles.valueRow}>
        <div className={styles.value} style={{ color: metric.color }}>
          {metric.format(last)}
        </div>
        <div className={styles.unit}>{metric.unit.trim()}</div>
        <div
          className={`${styles.delta} ${
            flat ? styles.deltaFlat : improving ? styles.deltaDown : styles.deltaUp
          }`}
        >
          {flat ? '·' : improving ? '↓' : '↑'} {Math.abs(delta).toFixed(1)}
        </div>
      </div>
      <div className={styles.blurb}>{metric.blurb}</div>
      <div className={styles.sparkWrap}>
        <MiniLine values={metric.values} color={metric.color} />
      </div>
      <div className={styles.baseline}>
        vs. start: {metric.format(first)}{metric.unit.trim()}
      </div>
    </div>
  )
}

function MiniLine({
  values,
  color,
  height = 36,
  width = 320,
}: {
  values: number[]
  color: string
  height?: number
  width?: number
}) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const pad = 3
  const xs = values.map((_, i) => pad + (i / (values.length - 1)) * (width - pad * 2))
  const ys = values.map(
    (v) => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2),
  )
  const path = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(ys[i] ?? pad).toFixed(1)}`)
    .join(' ')
  const lastIdx = values.length - 1
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path
        d={path}
        stroke={color}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={xs[lastIdx]} cy={ys[lastIdx]} r={2.5} fill={color} />
      <circle cx={xs[0]} cy={ys[0]} r={1.4} fill="currentColor" opacity={0.4} />
    </svg>
  )
}
