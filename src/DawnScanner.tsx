import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ChevronDown,
  Copy,
  Check,
  Gauge,
  Globe,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type Tier = 'breach' | 'exploitable' | 'hardening' | 'info'

type Finding = {
  id: string
  module: string
  title: string
  severity: Severity
  tier: Tier
  evidence: string
  impact: string
  remediation: string
}

type LogLine = {
  phase: string
  message: string
  status: 'running' | 'complete' | 'warning' | 'error'
}

type ScanTarget = {
  id: string
  label: string
  url: string
  blurb: string
  posture: string
  discovery: { pages: number; assets: number; paths: number }
  findings: Finding[]
}

type ScanResponse = {
  ok: boolean
  error?: string
  status?: number
  finalUrl?: string
  requestedUrl?: string
  contentType?: string
  headers?: Record<string, string>
  setCookie?: string[]
  html?: string
}

const SEVERITY_META: Record<Severity, { label: string; weight: number; color: string }> = {
  critical: { label: 'Critical', weight: 42, color: '#e5484d' },
  high: { label: 'High', weight: 24, color: '#f5860a' },
  medium: { label: 'Medium', weight: 11, color: '#e0a400' },
  low: { label: 'Low', weight: 4, color: '#1fa97f' },
  info: { label: 'Info', weight: 1, color: '#0b8fa0' },
}

const TIER_META: Record<Tier, { label: string }> = {
  breach: { label: 'Breach path' },
  exploitable: { label: 'Exploitable' },
  hardening: { label: 'Hardening' },
  info: { label: 'Disclosure' },
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const TIER_ORDER: Record<Tier, number> = { breach: 4, exploitable: 3, hardening: 2, info: 1 }

const TARGETS: ScanTarget[] = [
  {
    id: 'acme',
    label: 'acme-shop',
    url: 'https://acme-shop.dawn-lab.dev',
    blurb: 'Intentionally weak e-commerce demo',
    posture: 'Multiple breach paths',
    discovery: { pages: 6, assets: 9, paths: 18 },
    findings: [
      {
        id: 'dangerous_exposure.env',
        module: 'dangerousExposure',
        title: 'Publicly reachable .env file',
        severity: 'critical',
        tier: 'breach',
        evidence: 'GET /.env -> 200, body contains DB_PASSWORD, STRIPE_SECRET_KEY, JWT_SECRET.',
        impact:
          'Anyone requesting this URL reads live secrets directly — a straight path to database and payment-processor compromise.',
        remediation: 'Remove the file from the web root and rotate every exposed credential immediately.',
      },
      {
        id: 'secrets.stripe_live_key',
        module: 'secrets',
        title: 'Live Stripe key in delivered JavaScript',
        severity: 'critical',
        tier: 'breach',
        evidence: 'main.4f1a.js:218 contains "sk_live_51M..." returned with the app bundle.',
        impact: 'A secret API key can be lifted from the browser and used as-is against the linked account.',
        remediation: 'Move secret keys server-side, ship only publishable keys, and revoke the leaked key.',
      },
      {
        id: 'client_code.dom_xss',
        module: 'clientCode',
        title: 'DOM-XSS sink fed by location.hash',
        severity: 'high',
        tier: 'exploitable',
        evidence: 'search.js: element.innerHTML = decodeURIComponent(location.hash.slice(1)).',
        impact: 'Attacker-controlled input runs as script in a victim browser, enabling session theft or account takeover.',
        remediation: 'Render untrusted input with textContent or a sanitizer; never assign it to innerHTML.',
      },
      {
        id: 'cookies.missing_httponly',
        module: 'cookies',
        title: 'Session cookie missing HttpOnly + Secure',
        severity: 'high',
        tier: 'exploitable',
        evidence: 'Set-Cookie: sid=...; Path=/ — no HttpOnly, Secure, or SameSite attributes.',
        impact: 'Combined with the XSS sink above, the session cookie can be read by injected script and hijacked.',
        remediation: 'Set HttpOnly, Secure, and SameSite=Lax/Strict on all session cookies.',
      },
      {
        id: 'headers.missing_csp',
        module: 'headers',
        title: 'No Content-Security-Policy',
        severity: 'medium',
        tier: 'hardening',
        evidence: 'Response headers contain no Content-Security-Policy directive.',
        impact: 'There is nothing to contain the XSS bug above once it fires.',
        remediation: "Add a strict CSP (default-src 'self') and tighten script-src.",
      },
      {
        id: 'transport.no_hsts',
        module: 'transport',
        title: 'HSTS not enforced',
        severity: 'medium',
        tier: 'hardening',
        evidence: 'No Strict-Transport-Security header on the HTTPS response.',
        impact: 'A network attacker can attempt protocol downgrade to read traffic and cookies.',
        remediation: 'Send Strict-Transport-Security with a long max-age and includeSubDomains.',
      },
      {
        id: 'stack.version_disclosure',
        module: 'versionIntel',
        title: 'Server + framework version disclosed',
        severity: 'info',
        tier: 'info',
        evidence: 'Server: nginx/1.18.0 — X-Powered-By: Express; build banner exposes app v2.3.1.',
        impact: 'Lets an attacker fingerprint the stack and look up known CVEs for the exact version.',
        remediation: 'Suppress Server / X-Powered-By banners and version strings in responses.',
      },
    ],
  },
  {
    id: 'listio',
    label: 'listio-drive',
    url: 'https://listio-drive.dawn-lab.dev',
    blurb: 'Production-style app, well configured',
    posture: 'Hardened — only minor signals',
    discovery: { pages: 8, assets: 11, paths: 18 },
    findings: [
      {
        id: 'headers.permissions_policy',
        module: 'headers',
        title: 'Permissions-Policy could be tightened',
        severity: 'low',
        tier: 'hardening',
        evidence: 'Permissions-Policy present but allows geolocation=* across all origins.',
        impact: 'Slightly wider feature surface than needed; low standalone risk.',
        remediation: 'Scope geolocation and camera/microphone to self where features actually run.',
      },
      {
        id: 'stack.minor_banner',
        module: 'versionIntel',
        title: 'Generic server banner present',
        severity: 'info',
        tier: 'info',
        evidence: 'Server: cloudflare — no precise version leaked; app build hash not exposed.',
        impact: 'Minimal fingerprinting value. Listed for completeness.',
        remediation: 'No action required; banner is already generic.',
      },
      {
        id: 'cookies.ok',
        module: 'cookies',
        title: 'Session cookies correctly flagged',
        severity: 'info',
        tier: 'info',
        evidence: 'Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax — all protections present.',
        impact: 'No issue. Confirms good session-cookie hygiene.',
        remediation: 'No change needed.',
      },
    ],
  },
  {
    id: 'legacy',
    label: 'legacy-portal',
    url: 'https://legacy-portal.dawn-lab.dev',
    blurb: 'Aging internal portal',
    posture: 'Exploitable input + disclosure',
    discovery: { pages: 5, assets: 7, paths: 18 },
    findings: [
      {
        id: 'injection.reflected_param',
        module: 'injectionSurfaces',
        title: 'Unvalidated parameter reaches server logic',
        severity: 'high',
        tier: 'exploitable',
        evidence: '/report?id= reflects raw input into the page and into a SQL-shaped query string.',
        impact: 'A classic entry point for SQL injection or reflected XSS; needs authorized active testing to confirm.',
        remediation: 'Parameterize queries and validate/encode all request input server-side.',
      },
      {
        id: 'dangerous_exposure.swagger',
        module: 'dangerousExposure',
        title: 'OpenAPI / Swagger UI publicly exposed',
        severity: 'medium',
        tier: 'info',
        evidence: 'GET /api-docs -> 200 with full interactive Swagger UI and route list.',
        impact: 'Hands an attacker the entire authenticated API surface to plan against.',
        remediation: 'Require authentication for API docs or disable them in production.',
      },
      {
        id: 'mixedContent.passive',
        module: 'mixedContent',
        title: 'Mixed content over HTTPS',
        severity: 'medium',
        tier: 'hardening',
        evidence: '3 images and 1 script referenced over http:// from an https:// page.',
        impact: 'The http script can be tampered with on the network path and run in page context.',
        remediation: 'Serve all subresources over HTTPS and add upgrade-insecure-requests.',
      },
      {
        id: 'headers.missing_xfo',
        module: 'headers',
        title: 'No clickjacking protection',
        severity: 'low',
        tier: 'hardening',
        evidence: 'No X-Frame-Options and no frame-ancestors in CSP.',
        impact: 'The portal can be framed by a malicious site for clickjacking.',
        remediation: "Add frame-ancestors 'none' (or 'self') to the CSP.",
      },
      {
        id: 'stack.version_disclosure',
        module: 'versionIntel',
        title: 'PHP version disclosed',
        severity: 'info',
        tier: 'info',
        evidence: 'X-Powered-By: PHP/7.2.34 (end-of-life branch).',
        impact: 'Signals an unsupported runtime with public CVEs.',
        remediation: 'Hide the banner and upgrade to a supported PHP release.',
      },
    ],
  },
]

function sortFindings(list: Finding[]) {
  return [...list].sort(
    (a, b) =>
      TIER_ORDER[b.tier] - TIER_ORDER[a.tier] ||
      SEVERITY_META[b.severity].weight - SEVERITY_META[a.severity].weight,
  )
}

function riskScore(findings: Finding[]) {
  return Math.min(100, findings.reduce((sum, f) => sum + SEVERITY_META[f.severity].weight, 0))
}

function riskGrade(score: number) {
  if (score >= 75) return { grade: 'F', label: 'Critical exposure', color: '#e5484d' }
  if (score >= 50) return { grade: 'D', label: 'High risk', color: '#f5860a' }
  if (score >= 28) return { grade: 'C', label: 'Needs work', color: '#e0a400' }
  if (score >= 12) return { grade: 'B', label: 'Mostly solid', color: '#1fa97f' }
  return { grade: 'A', label: 'Strong posture', color: '#16a34a' }
}

function buildReport(meta: { url: string; profile: string }, findings: Finding[]) {
  const score = riskScore(findings)
  const grade = riskGrade(score)
  const counts = SEVERITY_ORDER.map(
    (sev) => `${SEVERITY_META[sev].label}: ${findings.filter((f) => f.severity === sev).length}`,
  ).join(' · ')
  const top = sortFindings(findings)
    .slice(0, 5)
    .map(
      (f, i) =>
        `${i + 1}. **${f.title}** _(${SEVERITY_META[f.severity].label} · ${TIER_META[f.tier].label})_\n   ${f.remediation}`,
    )
    .join('\n')

  return `# Project Dawn — Passive Assessment
**Target:** ${meta.url}
**Profile:** ${meta.profile} (passive only · no exploit payloads)
**Risk score:** ${score}/100 — Grade ${grade.grade} (${grade.label})

## Findings by severity
${counts}

## Fix priorities
${top || '_No issues detected by the passive checks._'}

> Findings are deterministic, evidence-based facts from response headers and
> delivered markup. Passive GET only — no exploit payloads were sent.
`
}

/* Real passive checks over the proxy response — headers + delivered HTML only. */
function analyzeResponse(scan: ScanResponse): Finding[] {
  const findings: Finding[] = []
  const h = scan.headers || {}
  const finalUrl = scan.finalUrl || scan.requestedUrl || ''
  const isHttps = finalUrl.startsWith('https://')
  const html = scan.html || ''
  const csp = h['content-security-policy'] || ''

  if (!isHttps) {
    findings.push({
      id: 'transport.no_https',
      module: 'transport',
      title: 'Served over plain HTTP',
      severity: 'high',
      tier: 'exploitable',
      evidence: `Final URL resolved to ${finalUrl || 'an http:// address'}.`,
      impact: 'Traffic and cookies can be read or modified by anyone on the network path.',
      remediation: 'Redirect all traffic to HTTPS and enable HSTS.',
    })
  } else if (!h['strict-transport-security']) {
    findings.push({
      id: 'transport.no_hsts',
      module: 'transport',
      title: 'HSTS not enforced',
      severity: 'medium',
      tier: 'hardening',
      evidence: 'No Strict-Transport-Security header on the HTTPS response.',
      impact: 'A network attacker can attempt a protocol downgrade to read traffic and cookies.',
      remediation: 'Send Strict-Transport-Security with a long max-age and includeSubDomains.',
    })
  }

  if (!csp) {
    findings.push({
      id: 'headers.missing_csp',
      module: 'headers',
      title: 'No Content-Security-Policy',
      severity: 'medium',
      tier: 'hardening',
      evidence: 'Response has no Content-Security-Policy header.',
      impact: 'Nothing constrains script sources, so any XSS bug runs unrestricted.',
      remediation: "Add a strict CSP (default-src 'self') and tighten script-src.",
    })
  }

  if (!h['x-frame-options'] && !/frame-ancestors/i.test(csp)) {
    findings.push({
      id: 'headers.missing_xfo',
      module: 'headers',
      title: 'No clickjacking protection',
      severity: 'low',
      tier: 'hardening',
      evidence: 'No X-Frame-Options header and no frame-ancestors directive in the CSP.',
      impact: 'The page can be framed by a malicious site for clickjacking.',
      remediation: "Add frame-ancestors 'self' to the CSP (or X-Frame-Options: SAMEORIGIN).",
    })
  }

  if (!/nosniff/i.test(h['x-content-type-options'] || '')) {
    findings.push({
      id: 'headers.missing_xcto',
      module: 'headers',
      title: 'MIME sniffing not disabled',
      severity: 'low',
      tier: 'hardening',
      evidence: 'No X-Content-Type-Options: nosniff header.',
      impact: 'Browsers may sniff content types, widening the surface for some injection attacks.',
      remediation: 'Send X-Content-Type-Options: nosniff.',
    })
  }

  if (!h['referrer-policy']) {
    findings.push({
      id: 'headers.missing_referrer',
      module: 'headers',
      title: 'No Referrer-Policy',
      severity: 'info',
      tier: 'hardening',
      evidence: 'No Referrer-Policy header on the response.',
      impact: 'Full URLs may leak to third parties via the Referer header.',
      remediation: 'Set Referrer-Policy: strict-origin-when-cross-origin (or stricter).',
    })
  }

  if (
    (h['access-control-allow-origin'] || '') === '*' &&
    /true/i.test(h['access-control-allow-credentials'] || '')
  ) {
    findings.push({
      id: 'headers.cors_wildcard_credentials',
      module: 'headers',
      title: 'Unsafe CORS: wildcard origin with credentials',
      severity: 'high',
      tier: 'exploitable',
      evidence: 'Access-Control-Allow-Origin: * together with Allow-Credentials: true.',
      impact: "Any website can read this site's authenticated responses — direct exposure of logged-in data.",
      remediation: 'Echo a strict allow-list of origins instead of * when credentials are allowed.',
    })
  }

  const banners: string[] = []
  if (h['server']) banners.push(`Server: ${h['server']}`)
  if (h['x-powered-by']) banners.push(`X-Powered-By: ${h['x-powered-by']}`)
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i)
  if (generator) banners.push(`Generator: ${generator[1]}`)
  if (banners.length) {
    findings.push({
      id: 'stack.version_disclosure',
      module: 'versionIntel',
      title: 'Software / version disclosed',
      severity: 'info',
      tier: 'info',
      evidence: banners.join(' · '),
      impact: 'Lets an attacker fingerprint the stack and look up known CVEs for the exact version.',
      remediation: 'Suppress Server / X-Powered-By banners and generator tags in responses.',
    })
  }

  if (scan.setCookie && scan.setCookie.length) {
    const flat = scan.setCookie.join(' ; ')
    const missing: string[] = []
    if (!/httponly/i.test(flat)) missing.push('HttpOnly')
    if (!/secure/i.test(flat)) missing.push('Secure')
    if (!/samesite/i.test(flat)) missing.push('SameSite')
    if (missing.length) {
      findings.push({
        id: 'cookies.missing_flags',
        module: 'cookies',
        title: `Cookie missing ${missing.join(' / ')}`,
        severity: missing.includes('HttpOnly') ? 'medium' : 'low',
        tier: missing.includes('HttpOnly') ? 'exploitable' : 'hardening',
        evidence: `Set-Cookie is missing: ${missing.join(', ')}.`,
        impact: 'Weak cookie protection makes session theft or CSRF more realistic if another bug exists.',
        remediation: 'Set HttpOnly, Secure, and SameSite=Lax/Strict on session cookies.',
      })
    }
  }

  if (isHttps && html) {
    const mixed = (html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) || []).filter(
      (s) => !/http:\/\/(localhost|127\.0\.0\.1)/i.test(s),
    )
    if (mixed.length) {
      findings.push({
        id: 'mixedContent.passive',
        module: 'mixedContent',
        title: 'Mixed content over HTTPS',
        severity: 'medium',
        tier: 'hardening',
        evidence: `${mixed.length} subresource reference(s) over http:// on an https:// page.`,
        impact: 'http subresources can be tampered with on the network path and run in page context.',
        remediation: 'Serve every subresource over HTTPS and add upgrade-insecure-requests.',
      })
    }
  }

  return findings
}

// Modules surfaced (in order) during a real scan so the stream shows what ran.
const REAL_MODULES = ['transport', 'headers', 'cookies', 'mixedContent', 'versionIntel']

export function DawnScanner() {
  const reduce = useReducedMotion()
  const [mode, setMode] = useState<'demo' | 'real'>('demo')
  const [targetId, setTargetId] = useState(TARGETS[0].id)
  const [realInput, setRealInput] = useState('https://example.com')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [revealed, setRevealed] = useState<Finding[]>([])
  const [allFindings, setAllFindings] = useState<Finding[]>([])
  const [progress, setProgress] = useState(0)
  const [score, setScore] = useState(0)
  const [showReport, setShowReport] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportMeta, setReportMeta] = useState<{ url: string; profile: string }>({
    url: TARGETS[0].url,
    profile: 'baseline',
  })

  const runId = useRef(0)
  const consoleRef = useRef<HTMLDivElement>(null)

  const target = useMemo(() => TARGETS.find((t) => t.id === targetId) ?? TARGETS[0], [targetId])
  const demoFindings = useMemo(() => sortFindings(target.findings), [target])

  // After a finished run, score from the full set; while scanning, from revealed.
  const finalScore = useMemo(() => riskScore(allFindings), [allFindings])
  const grade = riskGrade(status === 'idle' ? 0 : score)

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  const resetState = () => {
    runId.current += 1
    setStatus('idle')
    setLogs([])
    setRevealed([])
    setAllFindings([])
    setProgress(0)
    setScore(0)
    setShowReport(false)
    setError(null)
  }

  // Reset when switching demo target or scan mode.
  useEffect(() => {
    const timeout = window.setTimeout(() => resetState(), 0)
    return () => window.clearTimeout(timeout)
  }, [targetId, mode])

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const revealFindings = async (id: number, findings: Finding[]) => {
    let running = 0
    for (let i = 0; i < findings.length; i += 1) {
      await wait(reduce ? 16 : 170)
      if (runId.current !== id) return false
      running = Math.min(100, running + SEVERITY_META[findings[i].severity].weight)
      setRevealed((prev) => [...prev, findings[i]])
      setScore(running)
    }
    return true
  }

  const runDemoScan = async () => {
    const id = ++runId.current
    setStatus('scanning')
    setLogs([])
    setRevealed([])
    setProgress(0)
    setScore(0)
    setShowReport(false)
    setError(null)
    setReportMeta({ url: target.url, profile: 'baseline' })

    const sorted = demoFindings
    setAllFindings(sorted)
    const modules = Array.from(new Set(sorted.map((f) => f.module)))
    const timeline: LogLine[] = [
      { phase: 'scope', message: 'Authorization accepted and target normalized', status: 'complete' },
      { phase: 'fetch', message: `Fetching ${target.url}`, status: 'running' },
      { phase: 'fetch', message: 'Fetched entry page with HTTP 200', status: 'complete' },
      { phase: 'crawl', message: 'Discovering same-origin pages and client assets', status: 'running' },
      {
        phase: 'crawl',
        message: `Mapped ${target.discovery.pages} page(s) and ${target.discovery.assets} script asset(s)`,
        status: 'complete',
      },
      { phase: 'exposure', message: 'Checking bounded sensitive exposure paths', status: 'running' },
      { phase: 'exposure', message: `Checked ${target.discovery.paths} sensitive path(s)`, status: 'complete' },
      ...modules.flatMap((m): LogLine[] => {
        const count = sorted.filter((f) => f.module === m).length
        return [
          { phase: 'analyze', message: `Running ${m}`, status: 'running' },
          { phase: 'analyze', message: `${m} produced ${count} finding(s)`, status: count > 0 ? 'warning' : 'complete' },
        ]
      }),
      { phase: 'report', message: 'Writing Markdown report', status: 'running' },
      { phase: 'report', message: `Report saved to ${target.id}-scan.md`, status: 'complete' },
    ]

    for (let i = 0; i < timeline.length; i += 1) {
      await wait((timeline[i].status === 'running' ? 250 : 190) * (reduce ? 0.12 : 1))
      if (runId.current !== id) return
      setLogs((prev) => [...prev, timeline[i]])
      setProgress((i + 1) / timeline.length)
    }

    const ok = await revealFindings(id, sorted)
    if (!ok || runId.current !== id) return
    setScore(riskScore(sorted))
    setStatus('done')
  }

  const log = (id: number, line: LogLine) => {
    if (runId.current !== id) return
    setLogs((prev) => [...prev, line])
  }

  const runRealScan = async () => {
    const id = ++runId.current
    const targetUrl = realInput.trim()
    setStatus('scanning')
    setLogs([])
    setRevealed([])
    setAllFindings([])
    setProgress(0)
    setScore(0)
    setShowReport(false)
    setError(null)
    setReportMeta({ url: targetUrl, profile: 'live-passive' })

    log(id, { phase: 'scope', message: 'Authorization confirmed · passive GET only', status: 'complete' })
    setProgress(0.1)
    await wait(reduce ? 16 : 240)
    log(id, { phase: 'fetch', message: `Fetching ${targetUrl} via /api/scan`, status: 'running' })
    setProgress(0.25)

    let data: ScanResponse
    try {
      const response = await fetch(`/api/scan?url=${encodeURIComponent(targetUrl)}`, {
        headers: { accept: 'application/json' },
      })
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('no-endpoint')
      }
      data = (await response.json()) as ScanResponse
    } catch (err) {
      if (runId.current !== id) return
      const message =
        err instanceof Error && err.message === 'no-endpoint'
          ? 'The /api/scan endpoint is not available on this host. It works with `npm run dev` and on serverless hosts (Vercel/Netlify). Use the demo targets, or deploy with functions enabled.'
          : 'Could not reach the scan endpoint.'
      log(id, { phase: 'fetch', message: 'Scan endpoint unavailable', status: 'error' })
      setError(message)
      setStatus('idle')
      return
    }

    if (runId.current !== id) return
    if (!data.ok) {
      log(id, { phase: 'fetch', message: data.error || 'Request failed', status: 'error' })
      setError(data.error || 'The target could not be fetched.')
      setStatus('idle')
      return
    }

    log(id, {
      phase: 'fetch',
      message: `Fetched ${data.finalUrl} with HTTP ${data.status}`,
      status: 'complete',
    })
    setProgress(0.4)
    if (data.finalUrl && data.requestedUrl && data.finalUrl !== data.requestedUrl) {
      log(id, { phase: 'fetch', message: `Followed redirect to ${data.finalUrl}`, status: 'complete' })
    }

    const found = sortFindings(analyzeResponse(data))
    setAllFindings(found)

    const headerCount = Object.keys(data.headers || {}).length
    log(id, { phase: 'analyze', message: `Parsed ${headerCount} response header(s)`, status: 'complete' })

    for (let i = 0; i < REAL_MODULES.length; i += 1) {
      const m = REAL_MODULES[i]
      const count = found.filter((f) => f.module === m).length
      await wait(reduce ? 16 : 220)
      if (runId.current !== id) return
      log(id, { phase: 'analyze', message: `Running ${m}`, status: 'running' })
      await wait(reduce ? 12 : 140)
      if (runId.current !== id) return
      log(id, {
        phase: 'analyze',
        message: `${m} produced ${count} finding(s)`,
        status: count > 0 ? 'warning' : 'complete',
      })
      setProgress(0.4 + (0.4 * (i + 1)) / REAL_MODULES.length)
    }

    log(id, { phase: 'report', message: 'Writing Markdown report', status: 'running' })
    await wait(reduce ? 12 : 160)
    if (runId.current !== id) return
    log(id, { phase: 'report', message: 'Report ready', status: 'complete' })
    setProgress(1)

    const ok = await revealFindings(id, found)
    if (!ok || runId.current !== id) return
    setScore(riskScore(found))
    setStatus('done')
  }

  const runScan = () => {
    if (!consent || status === 'scanning') return
    if (mode === 'real' && !realInput.trim()) {
      setError('Enter a URL to scan.')
      return
    }
    void (mode === 'demo' ? runDemoScan() : runRealScan())
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildReport(reportMeta, allFindings))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can be blocked; ignore silently in the sandbox.
    }
  }

  // Tally totals: demo idle shows the target's totals; real idle shows nothing.
  const tallyTotals = mode === 'demo' && status === 'idle' ? target.findings : allFindings
  const tallies = SEVERITY_ORDER.map((sev) => ({
    sev,
    count: (status === 'idle' ? [] : revealed).filter((f) => f.severity === sev).length,
    total: tallyTotals.filter((f) => f.severity === sev).length,
  }))

  const postureText =
    status === 'idle'
      ? mode === 'demo'
        ? target.posture
        : 'Enter a URL and run a passive scan'
      : status === 'done' && allFindings.length === 0
        ? 'No issues found by passive checks'
        : grade.label

  // Gauge geometry: 270deg arc.
  const radius = 78
  const circ = 2 * Math.PI * radius
  const arc = 0.75
  const shown = status === 'idle' ? 0 : score
  const dash = circ * arc * (shown / 100)
  const gaugeColor = riskGrade(shown).color

  return (
    <div className="dawn">
      <div className="dawn-controls">
        <div className="dawn-mode" role="tablist" aria-label="Scan mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'demo'}
            className={mode === 'demo' ? 'active' : ''}
            onClick={() => setMode('demo')}
          >
            Demo targets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'real'}
            className={mode === 'real' ? 'active' : ''}
            onClick={() => setMode('real')}
          >
            <Globe size={14} /> Scan a real URL
          </button>
        </div>

        {mode === 'demo' ? (
          <div className="dawn-targets" role="tablist" aria-label="Demo scan targets">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === targetId}
                className={t.id === targetId ? 'dawn-chip active' : 'dawn-chip'}
                onClick={() => setTargetId(t.id)}
              >
                <strong>{t.label}</strong>
                <small>{t.blurb}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="dawn-note">
            Live passive scan via a server-side GET (no exploit payloads). Only scan sites you own or
            are authorized to assess. Local, loopback, and private-network hosts are blocked.
          </p>
        )}

        <div className="dawn-bar">
          {mode === 'demo' ? (
            <div className="dawn-url" title={target.url}>
              <span className="dawn-url-scheme">https://</span>
              {target.url.replace('https://', '')}
            </div>
          ) : (
            <input
              type="url"
              className="dawn-url-input"
              value={realInput}
              spellCheck={false}
              placeholder="https://example.com"
              onChange={(event) => setRealInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runScan()
              }}
              aria-label="URL to scan"
            />
          )}
          <label className={consent ? 'dawn-consent on' : 'dawn-consent'}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span className="dawn-check" aria-hidden="true">
              <Check size={13} />
            </span>
            I&apos;m authorized to assess this target
          </label>
          <div className="dawn-actions">
            <button
              type="button"
              className="dawn-run"
              disabled={!consent || status === 'scanning'}
              onClick={runScan}
            >
              {status === 'scanning' ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Scanning
                </>
              ) : (
                <>
                  <Play size={16} />
                  {status === 'done' ? 'Re-run scan' : 'Run passive scan'}
                </>
              )}
            </button>
            {(status !== 'idle' || error) && (
              <button type="button" className="dawn-reset" onClick={resetState} aria-label="Reset scan">
                <RotateCcw size={15} />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="dawn-error" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="dawn-grid">
        <div className="dawn-console-wrap">
          <div className="dawn-panel-head">
            <Terminal size={15} />
            <span>Live scan stream</span>
            <div className="dawn-progress-track" aria-hidden="true">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
          <div className="dawn-console" ref={consoleRef}>
            {logs.length === 0 && (
              <p className="dawn-empty">
                {mode === 'demo'
                  ? 'Pick a target, confirm authorization, then run the scan. These are pre-recorded sandbox results — no network requests.'
                  : 'Type a URL, confirm authorization, then run. Dawn fetches it once, server-side, and analyzes the response headers and delivered markup.'}
              </p>
            )}
            <AnimatePresence initial={false}>
              {logs.map((line, i) => (
                <motion.div
                  key={`${line.phase}-${i}`}
                  className={`dawn-log ${line.status}`}
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <span className="dawn-log-phase">{line.phase}</span>
                  <span className="dawn-log-msg">{line.message}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {status === 'scanning' && <span className="dawn-cursor" aria-hidden="true" />}
          </div>
        </div>

        <div className="dawn-gauge-wrap">
          <div className="dawn-panel-head">
            <Gauge size={15} />
            <span>Risk posture</span>
          </div>
          <div className="dawn-gauge">
            <svg viewBox="0 0 200 200" width="180" height="180">
              <circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke="rgba(132, 244, 255, 0.14)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${circ * arc} ${circ}`}
                transform="rotate(135 100 100)"
              />
              <motion.circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={gaugeColor}
                strokeWidth="14"
                strokeLinecap="round"
                transform="rotate(135 100 100)"
                initial={false}
                animate={{ strokeDasharray: `${dash} ${circ}` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{ filter: `drop-shadow(0 0 8px ${gaugeColor}66)` }}
              />
            </svg>
            <div className="dawn-gauge-center">
              <strong style={{ color: gaugeColor }}>{Math.round(shown)}</strong>
              <span>risk / 100</span>
              <div className="dawn-grade" style={{ color: gaugeColor, borderColor: `${gaugeColor}55` }}>
                {riskGrade(shown).grade}
              </div>
            </div>
          </div>
          <p className="dawn-posture" style={{ color: status === 'idle' ? '#9cc0c7' : gaugeColor }}>
            {postureText}
          </p>
          <div className="dawn-tallies">
            {tallies.map((t) => (
              <div key={t.sev} className="dawn-tally">
                <span className="dawn-dot" style={{ background: SEVERITY_META[t.sev].color }} />
                <span className="dawn-tally-label">{SEVERITY_META[t.sev].label}</span>
                <strong>{mode === 'demo' && status === 'idle' ? t.total : t.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dawn-findings">
        <AnimatePresence initial={false}>
          {revealed.map((finding, i) => {
            const meta = SEVERITY_META[finding.severity]
            return (
              <motion.article
                key={finding.id + finding.title}
                className="dawn-finding"
                style={{ ['--sev' as string]: meta.color }}
                initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.02, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="dawn-finding-top">
                  <span className="dawn-sev" style={{ background: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="dawn-tier">{TIER_META[finding.tier].label}</span>
                  <code className="dawn-module">{finding.module}</code>
                </div>
                <h4>{finding.title}</h4>
                <p className="dawn-evidence">{finding.evidence}</p>
                <p className="dawn-impact">{finding.impact}</p>
                <p className="dawn-fix">
                  <ShieldCheck size={14} />
                  {finding.remediation}
                </p>
              </motion.article>
            )
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {status === 'done' && (
          <motion.div
            className="dawn-report"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <button
              type="button"
              className="dawn-report-head"
              aria-expanded={showReport}
              onClick={() => setShowReport((v) => !v)}
            >
              <ShieldAlert size={15} />
              <span>
                Generated Markdown report — {allFindings.length} finding{allFindings.length === 1 ? '' : 's'},
                grade {riskGrade(finalScore).grade}
              </span>
              <ChevronDown size={16} className={showReport ? 'rot' : ''} />
            </button>
            <AnimatePresence initial={false}>
              {showReport && (
                <motion.div
                  className="dawn-report-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="dawn-report-inner">
                    <button type="button" className="dawn-copy" onClick={copyReport}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <pre>{buildReport(reportMeta, allFindings)}</pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
