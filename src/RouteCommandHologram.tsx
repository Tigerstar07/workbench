import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Html, Line, Sparkles as DreiSparkles } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'

type City = {
  name: string
  position: [number, number, number]
  status: string
}

type RoutePath = {
  from: string
  to: string
  color: string
  speed: number
  offset: number
  points: [number, number, number][]
}

const cities: City[] = [
  { name: 'Riga', position: [-2.05, 0.08, 0.05], status: 'parser hub' },
  { name: 'Liepaja', position: [-3.35, 0.1, -1.35], status: 'draft trip' },
  { name: 'Daugavpils', position: [1.4, 0.08, -1.45], status: 'review gate' },
  { name: 'Valmiera', position: [-0.65, 0.08, 1.05], status: 'route check' },
  { name: 'Tallinn', position: [0.85, 0.1, 2.3], status: 'demand signal' },
  { name: 'Vilnius', position: [2.65, 0.09, -0.95], status: 'ops queue' },
]

const routes: RoutePath[] = [
  {
    from: 'Riga',
    to: 'Liepaja',
    color: '#28dbe3',
    speed: 0.09,
    offset: 0.1,
    points: [
      [-2.05, 0.16, 0.05],
      [-2.75, 0.34, -0.5],
      [-3.35, 0.16, -1.35],
    ],
  },
  {
    from: 'Riga',
    to: 'Daugavpils',
    color: '#9cf56e',
    speed: 0.075,
    offset: 0.45,
    points: [
      [-2.05, 0.16, 0.05],
      [-0.15, 0.42, -0.45],
      [1.4, 0.16, -1.45],
    ],
  },
  {
    from: 'Riga',
    to: 'Tallinn',
    color: '#8ab4ff',
    speed: 0.07,
    offset: 0.72,
    points: [
      [-2.05, 0.16, 0.05],
      [-0.85, 0.48, 1.65],
      [0.85, 0.16, 2.3],
    ],
  },
  {
    from: 'Vilnius',
    to: 'Riga',
    color: '#ffcd6b',
    speed: 0.065,
    offset: 0.25,
    points: [
      [2.65, 0.16, -0.95],
      [0.35, 0.46, -0.18],
      [-2.05, 0.16, 0.05],
    ],
  },
]

function curveFromPoints(points: [number, number, number][]) {
  return new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)))
}

function AnimatedRoute({ route }: { route: RoutePath }) {
  const pulse = useRef<THREE.Mesh>(null)
  const curve = useMemo(() => curveFromPoints(route.points), [route.points])
  const linePoints = useMemo(() => curve.getPoints(64), [curve])

  useFrame(({ clock }) => {
    if (!pulse.current) return
    const t = (clock.elapsedTime * route.speed + route.offset) % 1
    pulse.current.position.copy(curve.getPoint(t))
  })

  return (
    <group>
      <Line points={linePoints} color={route.color} lineWidth={2.2} transparent opacity={0.78} />
      <mesh ref={pulse}>
        <sphereGeometry args={[0.055, 18, 18]} />
        <meshStandardMaterial color={route.color} emissive={route.color} emissiveIntensity={1.5} />
      </mesh>
    </group>
  )
}

function CityNode({ city, index }: { city: City; index: number }) {
  const mesh = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!mesh.current) return
    const lift = Math.sin(clock.elapsedTime * 1.7 + index * 0.8) * 0.025
    mesh.current.position.y = city.position[1] + lift
  })

  return (
    <group position={city.position}>
      <mesh ref={mesh}>
        <cylinderGeometry args={[0.13, 0.13, 0.035, 32]} />
        <meshStandardMaterial color="#0c1c20" emissive="#22d3ee" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, 0.07, 0]}>
        <sphereGeometry args={[0.07, 20, 20]} />
        <meshStandardMaterial color="#bffcff" emissive="#28dbe3" emissiveIntensity={1.2} />
      </mesh>
      <Html position={[0.16, 0.28, 0]} center distanceFactor={8} className="city-label">
        <span>{city.name}</span>
        <small>{city.status}</small>
      </Html>
    </group>
  )
}

function WorkflowPanel({
  position,
  title,
  value,
  color,
}: {
  position: [number, number, number]
  title: string
  value: string
  color: string
}) {
  return (
    <Float speed={1.4} rotationIntensity={0.08} floatIntensity={0.16}>
      <group position={position} rotation={[-0.22, -0.18, 0]}>
        <mesh>
          <boxGeometry args={[1.35, 0.54, 0.035]} />
          <meshStandardMaterial
            color="#071317"
            emissive={color}
            emissiveIntensity={0.18}
            roughness={0.42}
            metalness={0.18}
          />
        </mesh>
        <Html position={[0, 0, 0.035]} center distanceFactor={7.3} className="hologram-panel">
          <strong>{value}</strong>
          <span>{title}</span>
        </Html>
      </group>
    </Float>
  )
}

function HologramScene() {
  const rig = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    if (!rig.current) return
    rig.current.rotation.y = Math.sin(clock.elapsedTime * 0.18) * 0.08
    rig.current.rotation.x = -0.1 + Math.sin(clock.elapsedTime * 0.12) * 0.025
  })

  return (
    <>
      <color attach="background" args={['#02070a']} />
      <fog attach="fog" args={['#02070a', 6.5, 12]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[1.5, 6, 4]} intensity={1.8} color="#dfffff" />
      <pointLight position={[-3, 2.3, -2]} intensity={2} color="#22d3ee" />
      <pointLight position={[3, 2.1, -1.5]} intensity={1.4} color="#ffcd6b" />
      <group ref={rig} position={[0.12, -0.45, 0]} scale={0.88}>
        <gridHelper args={[7.5, 28, '#0f6d76', '#12333c']} position={[0, -0.02, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
          <planeGeometry args={[7.8, 5.4]} />
          <meshStandardMaterial color="#031014" transparent opacity={0.42} roughness={0.6} />
        </mesh>
        {routes.map((route) => (
          <AnimatedRoute key={`${route.from}-${route.to}`} route={route} />
        ))}
        {cities.map((city, index) => (
          <CityNode key={city.name} city={city} index={index} />
        ))}
        <WorkflowPanel
          position={[-2.9, 1.05, 0.8]}
          value="96%"
          title="structured extraction"
          color="#28dbe3"
        />
        <WorkflowPanel
          position={[1.9, 0.9, 0.95]}
          value="review"
          title="low-confidence gate"
          color="#ffcd6b"
        />
        <WorkflowPanel
          position={[0.5, 1.2, -1.95]}
          value="audit"
          title="dispatcher timeline"
          color="#9cf56e"
        />
        <DreiSparkles
          count={65}
          scale={[6.8, 2.4, 4.8]}
          size={2.2}
          speed={0.32}
          color="#72fff6"
          opacity={0.55}
        />
      </group>
    </>
  )
}

export function RouteCommandHologram() {
  return (
    <div className="hologram-shell" aria-label="Animated route command hologram">
      <Canvas
        dpr={[1, 1.7]}
        camera={{ position: [0, 4.5, 5.5], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <HologramScene />
        </Suspense>
      </Canvas>
      <div className="hologram-fallback" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
