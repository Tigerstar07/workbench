import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  BrainCircuit,
  DatabaseZap,
  FileSearch,
  LockKeyhole,
  MailCheck,
  MapPinned,
  ShieldCheck,
  TrendingUp,
  Workflow,
} from 'lucide-react'

export type PortfolioProject = {
  title: string
  role: string
  status: string
  summary: string
  proofPoints: string[]
  links: { label: string; href: string }[]
  screenshots: { src: string; alt: string }[]
  accent: 'cyan' | 'green' | 'amber'
}

export type ExtractedTripField = {
  label: string
  value: string
  confidence: number
  edited?: boolean
}

export type AuditEvent = {
  actor: string
  action: string
  timestamp: string
  details: string
}

export type BookingScenario = {
  id: 'clean' | 'messy'
  label: string
  tag: string
  rawEmail: string
  confidence: number
  reviewRequired: boolean
  extractedFields: ExtractedTripField[]
  generatedDraft: {
    route: string
    date: string
    pickup: string
    passenger: string
    status: 'Ready for approval' | 'Needs human review'
  }
  auditTrail: AuditEvent[]
}

export type Capability = {
  icon: LucideIcon
  label: string
  detail: string
}

export const proofStats = [
  { value: '3', label: 'real products used as proof' },
  { value: '5', label: 'AI ops demos planned' },
  { value: '0', label: 'silent create actions' },
  { value: '100%', label: 'sandbox data in public demo' },
]

export const capabilities: Capability[] = [
  {
    icon: Workflow,
    label: 'Automation',
    detail: 'Turning emails, forms and spreadsheets into steps someone can check and approve.',
  },
  {
    icon: BrainCircuit,
    label: 'LLM features',
    detail: 'Structured output with a confidence score, and a sensible fallback when the model is unsure.',
  },
  {
    icon: LockKeyhole,
    label: 'Safety checks',
    detail: 'Audit logs, permissions, and demos that never touch real data.',
  },
  {
    icon: DatabaseZap,
    label: 'Full stack',
    detail: 'React, TypeScript, Node, SQL, background jobs and deploys.',
  },
]

export const bookingScenarios: BookingScenario[] = [
  {
    id: 'clean',
    label: 'High-confidence booking',
    tag: 'auto draft',
    confidence: 0.96,
    reviewRequired: false,
    rawEmail:
      'Subject: Riga to Liepaja booking\n\nHi Listio Drive team,\n\nPlease create a trip draft for Friday, June 19 at 08:00. Pickup: Krisjana Valdemara iela 1C, Riga. Destination: Kungu iela 38, Liepaja. Passenger: Anna K. One seat, no luggage, non-smoking car preferred.\n\nThanks.',
    extractedFields: [
      { label: 'Route', value: 'Riga -> Liepaja', confidence: 0.99 },
      { label: 'Date / time', value: '19 Jun, 08:00', confidence: 0.97 },
      { label: 'Pickup', value: 'Krisjana Valdemara iela 1C', confidence: 0.95 },
      { label: 'Drop-off', value: 'Kungu iela 38', confidence: 0.94 },
      { label: 'Passenger', value: 'Anna K.', confidence: 0.98 },
      { label: 'Preference', value: 'Non-smoking car', confidence: 0.92 },
    ],
    generatedDraft: {
      route: 'Riga -> Liepaja',
      date: 'Friday, 19 Jun at 08:00',
      pickup: 'Krisjana Valdemara iela 1C, Riga',
      passenger: 'Anna K. - 1 seat',
      status: 'Ready for approval',
    },
    auditTrail: [
      {
        actor: 'Mailbox sandbox',
        action: 'Received booking email',
        timestamp: '09:14',
        details: 'Synthetic message loaded into the parser queue.',
      },
      {
        actor: 'AI extractor',
        action: 'Generated structured fields',
        timestamp: '09:14',
        details: 'All required fields passed the confidence threshold.',
      },
      {
        actor: 'Dispatcher',
        action: 'Can approve draft',
        timestamp: '09:15',
        details: 'No silent creation. A human still confirms the trip.',
      },
    ],
  },
  {
    id: 'messy',
    label: 'Low-confidence booking',
    tag: 'human review',
    confidence: 0.71,
    reviewRequired: true,
    rawEmail:
      'Subject: ride maybe tomorrow\n\nCan you set up the same route as last week, maybe from Riga center to Liepaja after lunch? Passenger is M. I might need two seats if my colleague joins. Pickup near the old office, exact address later.',
    extractedFields: [
      { label: 'Route', value: 'Riga -> Liepaja', confidence: 0.82 },
      { label: 'Date / time', value: 'Tomorrow, after lunch', confidence: 0.58 },
      { label: 'Pickup', value: 'Riga center / old office', confidence: 0.46 },
      { label: 'Drop-off', value: 'Liepaja', confidence: 0.76 },
      { label: 'Passenger', value: 'M.', confidence: 0.68 },
      { label: 'Seats', value: '1-2 seats', confidence: 0.61 },
    ],
    generatedDraft: {
      route: 'Riga -> Liepaja',
      date: 'Needs exact date and time',
      pickup: 'Needs exact pickup address',
      passenger: 'M. - seat count unclear',
      status: 'Needs human review',
    },
    auditTrail: [
      {
        actor: 'Mailbox sandbox',
        action: 'Received ambiguous email',
        timestamp: '11:32',
        details: 'Synthetic message contains missing address and seat ambiguity.',
      },
      {
        actor: 'AI extractor',
        action: 'Flagged low-confidence fields',
        timestamp: '11:32',
        details: 'Date, pickup, and seat count fell below approval threshold.',
      },
      {
        actor: 'Review policy',
        action: 'Blocked auto approval',
        timestamp: '11:33',
        details: 'Draft can only continue after dispatcher correction.',
      },
    ],
  },
]

export const projects: PortfolioProject[] = [
  {
    title: 'Project Dawn',
    role: 'Local-first AI security workspace',
    status: 'Working prototype',
    summary:
      'A consent-gated passive web security scanner wired to a file-backed local-AI workspace and a long-running agent that checkpoints, compresses memory, and keeps working without losing context.',
    proofPoints: [
      'Deterministic, evidence-based findings the model only summarizes',
      'Long-running local agent with memory compression and a JSONL journal',
      'Authorization-gated, passive-only, no exploit payloads',
      'Try it live below, demo targets or a real URL you own',
    ],
    links: [{ label: 'Try the scanner', href: '#scanner' }],
    screenshots: [],
    accent: 'cyan',
  },
  {
    title: 'Booking Email -> Trip AI',
    role: 'AI operations demo',
    status: 'V1 sandbox',
    summary:
      'A dispatcher-grade flow that turns unstructured booking messages into structured trip drafts with confidence scoring, review gates, and audit history.',
    proofPoints: [
      'Structured extraction with visible confidence per field',
      'Human review before every create action',
      'Audit trail designed for operational accountability',
      'Synthetic data only in the public demo',
    ],
    links: [{ label: 'Explore demo', href: '#demo' }],
    screenshots: [{ src: '/showcase/listio-drive-map.png', alt: 'Listio Drive route map screenshot' }],
    accent: 'cyan',
  },
  {
    title: 'Listio Marketplace',
    role: 'Marketplace product proof',
    status: 'Live proof point',
    summary:
      'A Baltic classifieds and transactions platform spanning listings, categories, auctions, subscriptions, map browsing, and business integrations.',
    proofPoints: [
      'Public marketplace at listio.lv',
      'Category, auction, listing, and media workflows',
      'Business integration thinking through CRM/API import flows',
      'Operational polish across support, privacy, and platform pages',
    ],
    links: [{ label: 'Open listio.lv', href: 'https://listio.lv/' }],
    screenshots: [{ src: '/showcase/listio-marketplace.png', alt: 'Listio marketplace listings screenshot' }],
    accent: 'green',
  },
  {
    title: 'Listio Drive',
    role: 'Mobility operations product proof',
    status: 'Preview / live product surface',
    summary:
      'A Baltic ride-sharing product focused on city-to-city routes, reservations, safety signals, payment status, and operator-ready launch controls.',
    proofPoints: [
      'Public product surface at drive.listio.lv',
      'Route search, trip publishing, reservations, and messaging surfaces',
      'Public/private data separation for passenger and driver safety',
      'Launch readiness work around payments, safety, ops, and monitoring',
    ],
    links: [{ label: 'Open drive.listio.lv', href: 'https://drive.listio.lv/' }],
    screenshots: [
      { src: '/showcase/listio-drive-home.png', alt: 'Listio Drive desktop homepage screenshot' },
      { src: '/showcase/listio-drive-mobile.png', alt: 'Listio Drive mobile homepage screenshot' },
    ],
    accent: 'amber',
  },
  {
    title: 'Stock Momentum Radar',
    role: 'Local market-scanner MVP',
    status: 'V1 local prototype',
    summary:
      'A local momentum scanner for paper-trading research that ranks unusual movers with strict confidence gates, a tiny shortlist, and browser/sound alerts only when a ticker reaches CHECK NOW.',
    proofPoints: [
      'Attention-only classifier: IGNORE, WATCH, or CHECK NOW',
      'Strict gate requires catalyst, volume, relative volume, VWAP, and high-of-day alignment',
      'Shortlist capped to the few highest-confidence candidates',
      'Runs locally from npm run dev with a server-side scan endpoint',
    ],
    links: [{ label: 'Explore Trades', href: '#stock-radar' }],
    screenshots: [],
    accent: 'amber',
  },
  {
    title: 'Quant Research Machine',
    role: 'Data-first financial ML research workspace',
    status: 'Interactive MVP',
    summary:
      'A serious stock-research product surface with institutional source intake, daily market questions, ranked signal hypotheses, point-in-time risk flags, and leakage-aware validation graphs.',
    proofPoints: [
      'Source registry covers FRED/ALFRED, Treasury DTS, SEC Form 4/13F, earnings, market data, and options/OFI',
      'Daily research questions separate known facts from data still missing',
      'Signal queue ranks OFI, PEAD/SUE, insider buying, liquidity impulse, and 13F congruence',
      'Validation gates visibly block claims when survivor-bias-free and point-in-time data are missing',
    ],
    links: [{ label: 'Open research machine', href: '#/prediction-lab' }],
    screenshots: [],
    accent: 'cyan',
  },
]

export const recruiterBullets = [
  'Two live products, Listio and Listio Drive, built and run end to end.',
  'Comfortable across React, Node, SQL, payments, maps and background jobs.',
  'Most at home on internal tools, automation and dashboards.',
  'Public demos use made-up data, and target numbers are labelled as targets.',
]

export const targetRoles = [
  'Junior full-stack developer',
  'Automation developer',
  'Product Engineer',
  'Solutions / Automation Engineer',
  'Internal Tools Developer',
]

export const stackItems = [
  { icon: Workflow, label: 'React and TypeScript' },
  { icon: DatabaseZap, label: 'Node.js and SQL' },
  { icon: Bot, label: 'Local LLMs with Ollama' },
  { icon: FileSearch, label: 'Structured LLM output' },
  { icon: ShieldCheck, label: 'Passive security scanning' },
  { icon: TrendingUp, label: 'Market data APIs' },
  { icon: MailCheck, label: 'Email parsing' },
  { icon: MapPinned, label: 'Maps and routing' },
]
