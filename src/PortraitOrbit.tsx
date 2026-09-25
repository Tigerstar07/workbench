import { RefreshCw, RotateCw, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Rotation = {
  x: number
  y: number
}

type DragState = {
  active: boolean
  startX: number
  startY: number
  baseX: number
  baseY: number
  lastTime: number
  lastRotationX: number
  lastRotationY: number
  vx: number
  vy: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function PortraitOrbit() {
  const [rotation, setRotation] = useState<Rotation>({ x: -4, y: -14 })
  const drag = useRef<DragState>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: -4,
    baseY: -14,
    lastTime: 0,
    lastRotationX: -4,
    lastRotationY: -14,
    vx: 0,
    vy: 0,
  })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const updateFromPointer = (clientX: number, clientY: number) => {
    if (!drag.current.active) {
      return
    }

    const deltaX = clientX - drag.current.startX
    const deltaY = clientY - drag.current.startY

    const newX = clamp(drag.current.baseX - deltaY * 0.18, -34, 34)
    const newY = drag.current.baseY + deltaX * 0.32

    const now = performance.now()
    const dt = now - drag.current.lastTime

    if (dt > 0) {
      const instVx = (newX - drag.current.lastRotationX) / dt
      const instVy = (newY - drag.current.lastRotationY) / dt

      // Low-pass filter to smooth out velocity changes
      drag.current.vx = drag.current.vx * 0.3 + instVx * 0.7
      drag.current.vy = drag.current.vy * 0.3 + instVy * 0.7

      drag.current.lastTime = now
      drag.current.lastRotationX = newX
      drag.current.lastRotationY = newY
    }

    setRotation({ x: newX, y: newY })
  }

  const startInertia = () => {
    const now = performance.now()
    const elapsedSinceLastMove = now - drag.current.lastTime

    // If there was no pointer move for a while, treat velocity as 0 (e.g. held still)
    if (elapsedSinceLastMove > 100) {
      drag.current.vx = 0
      drag.current.vy = 0
    }

    // Clamp velocity to prevent wild spinning
    const MAX_VELOCITY = 1.5 // degrees per ms
    drag.current.vx = clamp(drag.current.vx, -MAX_VELOCITY, MAX_VELOCITY)
    drag.current.vy = clamp(drag.current.vy, -MAX_VELOCITY, MAX_VELOCITY)

    const threshold = 0.01 // stop animation when spin slows down to this speed
    if (Math.abs(drag.current.vx) > threshold || Math.abs(drag.current.vy) > threshold) {
      let lastFrameTime = performance.now()
      const animate = () => {
        const currentNow = performance.now()
        const dt = currentNow - lastFrameTime
        lastFrameTime = currentNow

        // Apply friction
        const friction = Math.exp(-0.003 * dt)
        drag.current.vx *= friction
        drag.current.vy *= friction

        const currentVx = drag.current.vx
        const currentVy = drag.current.vy

        if (Math.abs(currentVx) < threshold && Math.abs(currentVy) < threshold) {
          drag.current.vx = 0
          drag.current.vy = 0
          rafRef.current = null
          return
        }

        setRotation((prev) => {
          const nextX = clamp(prev.x + currentVx * dt, -34, 34)
          const nextY = prev.y + currentVy * dt

          // Stop vertical rotation if hitting boundary
          if ((nextX <= -34 && currentVx < 0) || (nextX >= 34 && currentVx > 0)) {
            drag.current.vx = 0
          }

          return { x: nextX, y: nextY }
        })

        rafRef.current = requestAnimationFrame(animate)
      }
      rafRef.current = requestAnimationFrame(animate)
    }
  }

  const flipCard = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    drag.current.vx = 0
    drag.current.vy = 0
    setRotation((value) => ({ x: value.x, y: value.y + 180 }))
  }

  const resetCard = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    drag.current.vx = 0
    drag.current.vy = 0
    setRotation({ x: -4, y: -14 })
  }

  return (
    <div
      className="portrait-card"
      aria-label="Interactive spinning Roberts profile card"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) {
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }

        const now = performance.now()
        drag.current = {
          active: true,
          startX: event.clientX,
          startY: event.clientY,
          baseX: rotation.x,
          baseY: rotation.y,
          lastTime: now,
          lastRotationX: rotation.x,
          lastRotationY: rotation.y,
          vx: 0,
          vy: 0,
        }
      }}
      onPointerMove={(event) => updateFromPointer(event.clientX, event.clientY)}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        drag.current.active = false
        startInertia()
      }}
      onPointerCancel={() => {
        drag.current.active = false
        startInertia()
      }}
    >
      <div className="spin-card-scene">
        <div
          className="spin-card-object"
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          }}
        >
          <div className="card-face card-front" aria-hidden="true">
            <img src="/showcase/roberts-portrait-clean.png" alt="" draggable="false" />
            <div className="front-glass">
              <span>Roberts</span>
              <strong>Full-stack developer</strong>
            </div>
          </div>
          <div className="card-face card-back">
            <span className="back-kicker">Roberts Hartmanis</span>
            <h2>Full-stack developer in Riga.</h2>
            <p>
              Built Listio and Listio Drive. Outside those, mostly internal tools, automation and
              trading research.
            </p>
            <div className="back-proof-grid">
              <span>React</span>
              <span>TypeScript</span>
              <span>Node.js</span>
              <span>PostgreSQL</span>
            </div>
            <div className="back-mini">
              <Workflow size={18} />
              <span>Marketplace, ride sharing and booking automation.</span>
            </div>
          </div>
          <div className="card-face card-edge edge-left" />
          <div className="card-face card-edge edge-right" />
          <div className="card-face card-edge edge-top" />
          <div className="card-face card-edge edge-bottom" />
        </div>
      </div>
      <div className="spin-card-controls">
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={flipCard}>
          <RotateCw size={15} />
          Flip
        </button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={resetCard}>
          <RefreshCw size={15} />
          Reset
        </button>
      </div>
    </div>
  )
}
