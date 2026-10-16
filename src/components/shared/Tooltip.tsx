import { useTooltip } from './use-tooltip'

/**
 * Convenience wrapper: a `<span>` trigger around `children`.
 * Use `useTooltip` directly when the trigger is itself a button.
 */
export function Tooltip({ text, shortcut, className, style, children, ...rest }: {
  text: string | null | undefined
  shortcut?: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'onPointerEnter' | 'onPointerLeave' | 'onPointerDown' | 'onFocus' | 'onBlur'>) {
  const { triggerProps, tooltip } = useTooltip(text, { shortcut })
  return (
    <span {...rest} className={className} style={style} {...triggerProps}>
      {children}
      {tooltip}
    </span>
  )
}
