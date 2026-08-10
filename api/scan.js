// Passive, GET-only fetch proxy for the Project Dawn scanner demo.
//
// A browser cannot read another origin's response headers/body (CORS), so the
// real passive scan has to fetch the target server-side. This endpoint does a
// single GET, follows redirects, and returns the status, final URL, response
// headers, any Set-Cookie values, and an HTML snippet. It runs NO exploit
// payloads and refuses local/loopback/private targets (basic SSRF protection).
//
// Works as a Vercel/Netlify-style serverless function in production, and the
// same logic is mounted at /api/scan in the Vite dev server (see vite.config.ts).

const USER_AGENT = 'ProjectDawnPassiveScanner/0.1 (+defensive authorized assessment)'
const MAX_BYTES = 300_000
const TIMEOUT_MS = 12_000

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '0.0.0.0') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  const m = h.match(/^172\.(\d{1,3})\./)
  if (m) {
    const n = Number(m[1])
    if (n >= 16 && n <= 31) return true
  }
  return false
}

export async function fetchTarget(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Enter a valid URL, for example https://example.com' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' }
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: 'Local, loopback, and private-network targets are blocked.' }
  }

  try {
    const response = await fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/json,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const contentType = response.headers.get('content-type') || ''
    let html = ''
    if (!contentType || /text|html|json|xml|javascript/i.test(contentType)) {
      const buffer = await response.arrayBuffer()
      html = Buffer.from(buffer.slice(0, MAX_BYTES)).toString('utf8')
    }

    const headers = {}
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    let setCookie = []
    try {
      if (typeof response.headers.getSetCookie === 'function') {
        setCookie = response.headers.getSetCookie()
      } else if (headers['set-cookie']) {
        setCookie = [headers['set-cookie']]
      }
    } catch {
      setCookie = []
    }

    return {
      ok: true,
      status: response.status,
      finalUrl: response.url || url.href,
      requestedUrl: url.href,
      contentType,
      headers,
      setCookie,
      html,
    }
  } catch (error) {
    const name = error && error.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: 'Target did not respond within 12 seconds.' }
    }
    return { ok: false, error: `Request failed: ${(error && error.message) || 'network error'}` }
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost').searchParams.get('url')
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (!url) {
    res.statusCode = 400
    res.end(JSON.stringify({ ok: false, error: 'Missing url parameter.' }))
    return
  }
  const result = await fetchTarget(url)
  res.statusCode = 200
  res.end(JSON.stringify(result))
}
