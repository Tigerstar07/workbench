import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  CarFront,
  FileText,
  GitBranch,
  Mail,
  MailCheck,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import './App.css'
import {
  bookingScenarios,
  capabilities,
  recruiterBullets,
  stackItems,
  targetRoles,
  type BookingScenario,
} from './data'
import { Magnetic, Reveal } from './motion'

const PortraitOrbit = lazy(() =>
  import('./PortraitOrbit').then((module) => ({ default: module.PortraitOrbit })),
)
const DawnScanner = lazy(() =>
  import('./DawnScanner').then((module) => ({ default: module.DawnScanner })),
)
const StockMomentumRadar = lazy(() =>
  import('./StockMomentumRadar').then((module) => ({ default: module.StockMomentumRadar })),
)
const MonteCarloRiskLab = lazy(() =>
  import('./MonteCarloRiskLab').then((module) => ({ default: module.MonteCarloRiskLab })),
)

type ExperienceId = 'stock' | 'dawn' | 'booking' | 'montecarlo'

const routeByExperience: Record<ExperienceId, string> = {
  stock: 'radar',
  dawn: 'dawn',
  booking: 'booking',
  montecarlo: 'prediction-lab',
}

function experienceFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'radar' || hash === 'stock-radar') return 'stock'
  if (hash === 'dawn' || hash === 'scanner') return 'dawn'
  if (hash === 'booking' || hash === 'demo') return 'booking'
  if (hash === 'prediction-lab' || hash === 'stock-ml' || hash === 'montecarlo' || hash === 'risk') return 'montecarlo'
  return null
}

function NavProjects({ onOpenExperience }: { onOpenExperience: (id: ExperienceId) => void }) {
  const [open, setOpen] = useState(false)
  const select = (id: ExperienceId) => {
    onOpenExperience(id)
    setOpen(false)
  }

  return (
    <div className="nav-projects" onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Projects
        <ChevronDown size={15} />
      </button>
      <div className={open ? 'projects-menu open' : 'projects-menu'}>
        <a href="#/prediction-lab" onClick={() => select('montecarlo')}>
          <strong>Strategy simulator</strong>
          <span>Strategy against the market</span>
        </a>
        <a href="#/dawn" onClick={() => select('dawn')}>
          <strong>Project Dawn</strong>
          <span>Passive website security check</span>
        </a>
        <a href="#/radar" onClick={() => select('stock')}>
          <strong>Momentum radar</strong>
          <span>Stocks and crypto on the move</span>
        </a>
        <a href="#/booking" onClick={() => select('booking')}>
          <strong>Booking email parser</strong>
          <span>Email to trip draft</span>
        </a>
        <a href="https://drive.listio.lv/" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
          <strong>Listio Drive</strong>
          <span>Ride sharing, live</span>
        </a>
        <a href="https://listio.lv/" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
          <strong>Listio Marketplace</strong>
          <span>Classifieds, live</span>
        </a>
      </div>
    </div>
  )
}

function ConfidenceMeter({ value, reviewRequired }: { value: number; reviewRequired: boolean }) {
  const percent = Math.round(value * 100)

  return (
    <div className="confidence-meter" aria-label={`Confidence ${percent} percent`}>
      <div>
        <span>Confidence</span>
        <strong>{percent}%</strong>
      </div>
      <div className="meter-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>{reviewRequired ? 'Needs human review before create.' : 'Ready for dispatcher approval.'}</p>
    </div>
  )
}

function ScenarioSwitcher({
  scenario,
  onScenarioChange,
}: {
  scenario: BookingScenario
  onScenarioChange: (scenario: BookingScenario) => void
}) {
  return (
    <div className="scenario-switcher" aria-label="Booking demo scenarios">
      {bookingScenarios.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === scenario.id ? 'active' : ''}
          aria-pressed={item.id === scenario.id}
          onClick={() => onScenarioChange(item)}
        >
          <span>{item.label}</span>
          <small>{item.tag}</small>
        </button>
      ))}
    </div>
  )
}

function DemoSection() {
  const [scenario, setScenario] = useState(bookingScenarios[0])
  const [approved, setApproved] = useState(false)
  const weakFields = useMemo(
    () => scenario.extractedFields.filter((field) => field.confidence < 0.76),
    [scenario],
  )

  const selectScenario = (next: BookingScenario) => {
    setScenario(next)
    setApproved(false)
  }

  return (
    <section className="section demo-section" id="demo">
      <Reveal className="section-heading">
        <p className="eyebrow">Demo</p>
        <h2>Booking email to trip draft</h2>
        <p>
          Made-up emails only. The parser pulls out the trip details, scores how sure it is about each
          one, and nothing is created until a person approves it.
        </p>
      </Reveal>
      <div className="demo-grid">
        <Reveal as="article" className="demo-card email-card" index={0} lift>
          <div className="card-head">
            <span>Sandbox email</span>
            <ScenarioSwitcher scenario={scenario} onScenarioChange={selectScenario} />
          </div>
          <pre>{scenario.rawEmail}</pre>
        </Reveal>
        <Reveal as="article" className="demo-card" index={1} lift>
          <div className="card-head split">
            <div>
              <span>Extractor output</span>
              <h3>{scenario.reviewRequired ? 'Review required' : 'Approval-ready draft'}</h3>
            </div>
            <ConfidenceMeter value={scenario.confidence} reviewRequired={scenario.reviewRequired} />
          </div>
          <div className="field-grid">
            {scenario.extractedFields.map((field, fieldIndex) => (
              <div
                className={field.confidence < 0.76 ? 'field-row attention' : 'field-row'}
                key={field.label}
                style={{ animationDelay: `${fieldIndex * 60}ms` }}
              >
                <span>{field.label}</span>
                <strong>{field.value}</strong>
                <small>{Math.round(field.confidence * 100)}%</small>
              </div>
            ))}
          </div>
          {weakFields.length > 0 && (
            <p className="review-note">{weakFields.length} low-confidence fields block approval.</p>
          )}
        </Reveal>
        <Reveal as="article" className="demo-card" index={2} lift>
          <div className="card-head split">
            <div>
              <span>Trip draft</span>
              <h3>{scenario.generatedDraft.status}</h3>
            </div>
            <BadgeCheck size={22} />
          </div>
          <dl className="draft-list">
            <div>
              <dt>Route</dt>
              <dd>{scenario.generatedDraft.route}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{scenario.generatedDraft.date}</dd>
            </div>
            <div>
              <dt>Pickup</dt>
              <dd>{scenario.generatedDraft.pickup}</dd>
            </div>
            <div>
              <dt>Passenger</dt>
              <dd>{scenario.generatedDraft.passenger}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="primary-button full"
            disabled={scenario.reviewRequired}
            onClick={() => setApproved(true)}
          >
            Approve draft
            <ArrowRight size={16} />
          </button>
          <p className="small-copy">
            {approved ? 'Approved locally in the sandbox.' : 'Human approval stays part of the workflow.'}
          </p>
        </Reveal>
        <Reveal as="article" className="demo-card" index={3} lift>
          <div className="card-head split">
            <div>
              <span>Audit trail</span>
              <h3>Inspectable decisions</h3>
            </div>
            <ShieldCheck size={22} />
          </div>
          <ol className="audit-list">
            {scenario.auditTrail.map((event) => (
              <li key={`${event.timestamp}-${event.action}`}>
                <time>{event.timestamp}</time>
                <div>
                  <strong>{event.action}</strong>
                  <span>{event.actor}</span>
                  <p>{event.details}</p>
                </div>
              </li>
            ))}
            {approved && (
              <li>
                <time>09:16</time>
                <div>
                  <strong>Dispatcher approved draft</strong>
                  <span>Sandbox action</span>
                  <p>No external systems or private data were touched.</p>
                </div>
              </li>
            )}
          </ol>
        </Reveal>
      </div>
    </section>
  )
}

function AboutDepth() {
  return (
    <section className="section about-depth" id="about">
      <Reveal className="section-heading">
        <p className="eyebrow">About</p>
        <h2>Full-stack developer, mostly TypeScript.</h2>
        <p>
          I built Listio, a Latvian classifieds marketplace, and Listio Drive, a ride-sharing app for
          the Baltics. The projects on this page are smaller tools I made along the way, mostly for
          trading research and for automating dull admin work. I use AI coding tools every day and
          read what they write before it ships.
        </p>
      </Reveal>
    </section>
  )
}

function RecruiterBrief() {
  return (
    <section className="section recruiter-section" id="recruiter">
      <Reveal className="section-heading">
        <p className="eyebrow">For recruiters</p>
        <h2>The short version</h2>
      </Reveal>
      <div className="brief-grid">
        <Reveal as="article" index={0} lift>
          <h3>Roles I&apos;m looking for</h3>
          <ul>
            {targetRoles.map((role) => (
              <li key={role}>{role}</li>
            ))}
          </ul>
        </Reveal>
        <Reveal as="article" index={1} lift>
          <h3>What I bring</h3>
          <ul>
            {recruiterBullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </Reveal>
        <Reveal as="article" index={2} lift>
          <h3>Tools I use</h3>
          <div className="stack-grid">
            {stackItems.map((item) => {
              const Icon = item.icon
              return (
                <span key={item.label}>
                  <Icon size={15} />
                  {item.label}
                </span>
              )
            })}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

const experienceCards = [
  {
    id: 'stock' as const,
    icon: TrendingUp,
    title: 'Momentum radar',
    label: 'Live market data',
    body: 'US stocks and crypto that are moving right now, with chart stats, news links and strict entry rules for a paper-trading bot.',
    action: 'Open radar',
  },
  {
    id: 'montecarlo' as const,
    icon: GitBranch,
    title: 'Strategy simulator',
    label: 'Quant research',
    body: 'Runs a trading strategy against the market over 50 simulated markets, costs included, to see whether the edge survives.',
    action: 'Open simulator',
  },
  {
    id: 'dawn' as const,
    icon: ShieldCheck,
    title: 'Project Dawn',
    label: 'Security scanner',
    body: 'Checks a site you own for missing headers, exposed files and risky scripts. It never sends attack traffic.',
    action: 'Open scanner',
  },
  {
    id: 'booking' as const,
    icon: MailCheck,
    title: 'Booking email parser',
    label: 'Automation demo',
    body: 'Reads a messy booking email, fills in a trip draft and flags the fields it is unsure about.',
    action: 'Open workflow',
  },
  {
    id: 'drive',
    icon: CarFront,
    title: 'Listio Drive',
    label: 'Live mobility product',
    body: 'Ride sharing in the Baltics: route search, bookings, and separate rider and driver views.',
    action: 'Visit site',
    href: 'https://drive.listio.lv/',
  },
  {
    id: 'marketplace',
    icon: ShoppingBag,
    title: 'Listio Marketplace',
    label: 'Live marketplace',
    body: 'Latvian classifieds with categories, subscriptions and a map view.',
    action: 'Visit site',
    href: 'https://listio.lv/',
  },
]

function ExperienceLauncher({ onOpenExperience }: { onOpenExperience: (id: ExperienceId) => void }) {
  return (
    <section className="section launcher-section" id="projects">
      <Reveal className="section-heading compact-heading">
        <p className="eyebrow">Projects</p>
        <h2>Open one</h2>
        <p>The first four run on this page. The last two are live products and open in a new tab.</p>
      </Reveal>
      <div className="tool-launcher-grid">
        {experienceCards.map((card, index) => {
          const Icon = card.icon
          const isInternal = 'id' in card && (card.id === 'stock' || card.id === 'dawn' || card.id === 'booking' || card.id === 'montecarlo')
          const className = isInternal ? 'tool-launch-card' : 'tool-launch-card'

          if ('href' in card) {
            return (
              <Reveal as="article" key={card.title} index={index} lift>
                <a className="tool-launch-card" href={card.href} target="_blank" rel="noreferrer">
                  <Icon size={23} />
                  <span>{card.label}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <strong>{card.action}</strong>
                </a>
              </Reveal>
            )
          }

          return (
            <Reveal as="article" key={card.title} index={index} lift>
              <button
                type="button"
                className={className}
                onClick={() => onOpenExperience(card.id as ExperienceId)}
              >
                <Icon size={23} />
                <span>{card.label}</span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <strong>{card.action}</strong>
              </button>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}

function WorkspaceContent({
  activeExperience,
  onBack,
}: {
  activeExperience: ExperienceId
  onBack: () => void
}) {
  return (
    <Suspense fallback={<div className="stock-loading">Loading workspace...</div>}>
      {activeExperience === 'stock' && <StockMomentumRadar />}
      {activeExperience === 'dawn' && <DawnScanner />}
      {activeExperience === 'booking' && <DemoSection />}
      {activeExperience === 'montecarlo' && <MonteCarloRiskLab onBack={onBack} />}
    </Suspense>
  )
}

function WorkspacePage({
  activeExperience,
  onBack,
}: {
  activeExperience: ExperienceId
  onBack: () => void
}) {
  const meta = {
    stock: {
      eyebrow: '',
      title: 'Momentum Radar',
      body: '',
    },
    dawn: {
      eyebrow: '',
      title: 'Project Dawn scanner',
      body: 'A passive security check for sites you own. It reads what the site already serves and writes up what it finds.',
    },
    booking: {
      eyebrow: '',
      title: 'Booking email parser',
      body: 'Sample emails only. The parser fills in a trip draft and flags anything it is unsure of.',
    },
    montecarlo: {
      eyebrow: '',
      title: 'Strategy simulator',
      body: 'Runs the strategy against the market across many simulated markets and shows what stops it from counting as a real edge.',
    },
  }[activeExperience]

  return (
    <section className={`workspace-page ${activeExperience}`}>
      <div className="workspace-shell">
        <div className="workspace-top">
          <button type="button" className="workspace-back" onClick={onBack}>
            <ArrowRight size={16} />
            Back
          </button>
          <div>
            {meta.eyebrow && <p className="eyebrow">{meta.eyebrow}</p>}
            <h1>{meta.title}</h1>
            {meta.body && <p>{meta.body}</p>}
          </div>
        </div>
        <div className={`workbench-panel ${activeExperience}`}>
          <WorkspaceContent activeExperience={activeExperience} onBack={onBack} />
        </div>
      </div>
    </section>
  )
}

function App() {
  const [activePage, setActivePage] = useState<ExperienceId | null>(() => experienceFromHash())

  useEffect(() => {
    const syncRoute = () => setActivePage(experienceFromHash())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  const openExperience = (id: ExperienceId) => {
    setActivePage(id)
    window.location.hash = `/${routeByExperience[id]}`
    // Land at the top of the new workspace instantly. A smooth scroll here races
    // the layout swap (the workspace has a different height than the portfolio),
    // which leaves a residual scroll that tucks the title under the fixed nav.
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }

  const goHome = () => {
    setActivePage(null)
    window.location.hash = 'top'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main>

      <header className="site-nav">
        <a className="brand" href="#top" onClick={goHome}>
          <span>R</span>
          Roberts
        </a>
        <nav aria-label="Primary navigation">
          <NavProjects onOpenExperience={openExperience} />
          <a href="#/dawn" onClick={() => openExperience('dawn')}>Demo</a>
          <a href="#/radar" onClick={() => openExperience('stock')}>Radar</a>
          <a href="#recruiter" onClick={() => setActivePage(null)}>Recruiter</a>
          <a href="mailto:roberts@lords.id.lv">Contact</a>
        </nav>
      </header>

      {activePage && <WorkspacePage activeExperience={activePage} onBack={goHome} />}

      {!activePage && (
        <>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Roberts Hartmanis, Riga</p>
          <h1>Hi, I&apos;m Roberts. This is where I keep the tools I&apos;ve built.</h1>
          <p className="hero-lede">
            A stock and crypto scanner with a paper-trading bot, a strategy simulator, a passive
            website security scanner and a booking email parser. They all run here in the browser.
            My live products, Listio and Listio Drive, are linked further down.
          </p>
          <div className="hero-actions">
            <Magnetic className="primary-button" href="#/radar" onClick={() => openExperience('stock')}>
              Open the radar
              <ArrowRight size={17} />
            </Magnetic>
            <a className="secondary-button" href="#projects">
              All projects
            </a>
          </div>
        </div>
        <div className="portrait-stage">
          <Suspense fallback={<div className="portrait-card portrait-loading">Loading interactive card</div>}>
            <PortraitOrbit />
          </Suspense>
          <div className="portrait-note">Drag the photo to turn it</div>
        </div>
        <a className="scroll-cue" href="#about" aria-label="Scroll to content">
          <span />
        </a>
      </section>

      <section className="capability-strip" aria-label="What Roberts does">
        {capabilities.map((capability, index) => {
          const Icon = capability.icon
          return (
            <Reveal as="article" key={capability.label} index={index} lift>
              <Icon size={21} />
              <h2>{capability.label}</h2>
              <p>{capability.detail}</p>
            </Reveal>
          )
        })}
      </section>

      <AboutDepth />
      <ExperienceLauncher onOpenExperience={openExperience} />
      <RecruiterBrief />

      <footer className="site-footer">
        <div>
          <strong>Roberts</strong>
          <p>Full-stack developer in Riga.</p>
        </div>
        <div className="footer-links">
          <a href="mailto:roberts@lords.id.lv">
            <Mail size={16} />
            roberts@lords.id.lv
          </a>
          <a href="https://github.com/Tigerstar07" target="_blank" rel="noreferrer">
            <GitBranch size={16} />
            GitHub
          </a>
          <a href="https://roberts-web-studio.pages.dev/" target="_blank" rel="noreferrer">
            <FileText size={16} />
            Portfolio site
          </a>
        </div>
      </footer>
        </>
      )}
    </main>
  )
}

export default App
