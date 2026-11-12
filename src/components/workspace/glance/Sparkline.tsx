/**
 * A count's line over its days (a Number's
 * history): the last point dotted, in `color` (default the accent; a
 * Number's line takes the Number's colour, `number-colors.numberLineColor`).
 * Decorative — the number beside it carries the meaning. Nothing for fewer
 * than two points.
 */
export function Sparkline({ series, className, width = 76, height = 26, color = 'var(--color-accent)' }: {
  series: readonly number[]
  className?: string
  width?: number
  height?: number
  color?: string
}) {
  if (series.length < 2) return null
  const min = Math.min(...series)
  const max = Math.max(...series)
  const x = (i: number) => 2 + (i * (width - 4)) / (series.length - 1)
  const y = (v: number) => height - 4 - ((v - min) / Math.max(1, max - min)) * (height - 8)
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = series.length - 1
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-sparkline="">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(series[last] ?? 0)} r={2.4} fill={color} />
    </svg>
  )
}
