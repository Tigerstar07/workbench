import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type HTMLMotionProps,
} from 'framer-motion'
import { useRef, type CSSProperties, type ReactNode } from 'react'

type RevealProps = {
  children: ReactNode
  className?: string
  /** Kept for call sites that still pass a stagger index. */
  index?: number
  delayStep?: number
  y?: number
  as?: 'div' | 'section' | 'article' | 'li' | 'span'
  style?: CSSProperties
  /** Small hover lift (framer owns the transform, so CSS :hover can't). */
  lift?: boolean
}

/*
 * Content used to fade and blur in on scroll. It now renders straight away, so nothing
 * is invisible while JavaScript catches up, and only the optional hover lift remains.
 */
export function Reveal({ children, className, as = 'div', style, lift = false }: RevealProps) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div

  return (
    <MotionTag
      className={className}
      style={style}
      whileHover={lift && !reduce ? { y: -3 } : undefined}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </MotionTag>
  )
}

type CounterProps = {
  to: number
  suffix?: string
  prefix?: string
  decimals?: number
  className?: string
}

/* Formatted number. Trading figures should not count up from zero. */
export function Counter({ to, suffix = '', prefix = '', decimals = 0, className }: CounterProps) {
  const isNegative = to < 0

  return (
    <span className={className}>
      {isNegative ? '-' : ''}
      {prefix}
      {Math.abs(to).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  )
}

/* Button/anchor that drifts slightly toward the cursor and springs back. */
export function Magnetic({
  children,
  className,
  strength = 0.18,
  ...rest
}: HTMLMotionProps<'a'> & { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 250, damping: 18, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 250, damping: 18, mass: 0.4 })

  return (
    <motion.a
      ref={ref}
      className={className}
      style={{ x: reduce ? 0 : sx, y: reduce ? 0 : sy }}
      onPointerMove={(event) => {
        if (reduce || !ref.current) return
        const rect = ref.current.getBoundingClientRect()
        x.set((event.clientX - (rect.left + rect.width / 2)) * strength)
        y.set((event.clientY - (rect.top + rect.height / 2)) * strength)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
      {...rest}
    >
      {children}
    </motion.a>
  )
}
