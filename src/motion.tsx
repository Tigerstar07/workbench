import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  type HTMLMotionProps,
} from 'framer-motion'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

/* Thin progress bar pinned to the top of the viewport, driven by scroll. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 })

  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />
}

type RevealProps = {
  children: ReactNode
  className?: string
  /** Stagger index — each step adds delayStep seconds. */
  index?: number
  delayStep?: number
  /** Travel distance in px before settling. */
  y?: number
  as?: 'div' | 'section' | 'article' | 'li' | 'span'
  style?: CSSProperties
  /** Adds a spring hover-lift (framer controls transform, so CSS :hover can't). */
  lift?: boolean
}

/* Fade + lift on first scroll into view. Honors reduced-motion. */
export function Reveal({
  children,
  className,
  index = 0,
  delayStep = 0.07,
  y = 26,
  as = 'div',
  style,
  lift = false,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div

  return (
    <MotionTag
      ref={ref}
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y, filter: 'blur(6px)' }}
      animate={
        inView
          ? { opacity: 1, y: 0, filter: 'blur(0px)' }
          : reduce
            ? undefined
            : { opacity: 0, y, filter: 'blur(6px)' }
      }
      whileHover={lift && !reduce ? { y: -6 } : undefined}
      transition={{
        duration: 0.7,
        delay: index * delayStep,
        ease: [0.22, 1, 0.36, 1],
      }}
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
  duration?: number
  className?: string
}

/* Counts up from 0 to `to` once scrolled into view. */
export function Counter({
  to,
  suffix = '',
  prefix = '',
  decimals = 0,
  duration = 1.5,
  className,
}: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotion()
  const hasAnimatedRef = useRef(false)
  const prevToRef = useRef(0)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) {
      if (hasAnimatedRef.current) {
        prevToRef.current = to
      }
      return
    }
    if (reduce) {
      prevToRef.current = to
      hasAnimatedRef.current = true
      return
    }
    const startVal = prevToRef.current
    prevToRef.current = to
    hasAnimatedRef.current = true

    const controls = animate(startVal, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => setDisplay(value),
    })
    return () => controls.stop()
  }, [inView, to, duration, reduce])

  const displayValue = reduce ? to : display
  const isNegative = displayValue < 0
  const absDisplay = Math.abs(displayValue)

  return (
    <span ref={ref} className={className}>
      {isNegative ? '-' : ''}
      {prefix}
      {absDisplay.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  )
}

/* Button/anchor that drifts toward the cursor and springs back. */
export function Magnetic({
  children,
  className,
  strength = 0.32,
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

/* Rotating word that types in and deletes, cycling through a list. */
export function TypingRotator({ words, className }: { words: string[]; className?: string }) {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [text, setText] = useState(words[0] ?? '')
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'deleting'>('pausing')

  useEffect(() => {
    if (reduce) return
    const current = words[index] ?? ''
    let timeout: ReturnType<typeof setTimeout>

    if (phase === 'typing') {
      if (text.length < current.length) {
        timeout = setTimeout(() => setText(current.slice(0, text.length + 1)), 60)
      } else {
        timeout = setTimeout(() => setPhase('pausing'), 1400)
      }
    } else if (phase === 'pausing') {
      timeout = setTimeout(() => setPhase('deleting'), 1100)
    } else {
      if (text.length > 0) {
        timeout = setTimeout(() => setText(current.slice(0, text.length - 1)), 32)
      } else {
        timeout = setTimeout(() => {
          setIndex((value) => (value + 1) % words.length)
          setPhase('typing')
        }, 0)
      }
    }

    return () => clearTimeout(timeout)
  }, [text, phase, index, words, reduce])

  // Kick off the first type cycle.
  useEffect(() => {
    if (reduce) return
    const timeout = setTimeout(() => {
      setText('')
      setPhase('typing')
    }, 0)
    return () => clearTimeout(timeout)
  }, [reduce])

  return (
    <span className={className}>
      {text}
      {!reduce && <span className="type-caret" aria-hidden="true" />}
    </span>
  )
}
