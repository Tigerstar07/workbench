// Binance Spot Testnet execution client.
//
// Crypto execution can be routed here with BOT_CRYPTO_VENUE=binance. Stocks stay
// on Alpaca paper; the old Alpaca crypto path remains available by setting
// BOT_CRYPTO_VENUE=alpaca.
//
// Keys: generate an HMAC_SHA256 key at https://testnet.binance.vision (login with
// GitHub), then put them in .env.local as BINANCE_TESTNET_API_KEY / _API_SECRET.
// I cannot create the account or the keys for you — that is yours to do.
//
// Docs: https://developers.binance.com/docs/binance-spot-api-docs/testnet
import { createHmac } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://testnet.binance.vision'
const REQUEST_TIMEOUT_MS = 10_000
const RECV_WINDOW_MS = 5_000

function envValue(name: string) {
  return typeof process !== 'undefined' ? process?.env?.[name]?.trim() : undefined
}

function credentials() {
  const key = envValue('BINANCE_TESTNET_API_KEY')
  const secret = envValue('BINANCE_TESTNET_API_SECRET')
  return key && secret ? { key, secret } : null
}

export function binanceConfigured() {
  return credentials() !== null
}

function baseUrl() {
  return (envValue('BINANCE_TESTNET_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

// Map a bot crypto base (e.g. "BTC", "SOL") to a Binance spot symbol. Binance
// quotes the majors in USDT on the testnet, so BTC -> BTCUSDT. Stablecoins are
// never traded as a base.
const QUOTE_ASSET = 'USDT'
export function mapBaseToBinanceSymbol(base: string) {
  const clean = base.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!clean || clean === QUOTE_ASSET) return null
  return `${clean}${QUOTE_ASSET}`
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type Query = Record<string, string | number | undefined>

function buildQuery(params: Query) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
}

async function binanceFetch<T>(path: string, init?: { method?: string; headers?: Record<string, string>; query?: string }): Promise<T> {
  const method = init?.method ?? 'GET'
  const url = `${baseUrl()}${path}${init?.query ? `?${init.query}` : ''}`
  const response = await fetch(url, {
    method,
    headers: init?.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === 'object' && 'msg' in parsed ? String((parsed as { msg: unknown }).msg) : text
    throw new Error(`Binance ${response.status}: ${detail || 'request failed'}`)
  }
  return parsed as T
}

// A signed request: append timestamp + recvWindow, HMAC-SHA256 the query string
// with the secret, attach the signature, and send the API key header.
async function binanceSignedRequest<T>(path: string, params: Query = {}, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<T> {
  const creds = credentials()
  if (!creds) throw new Error('Binance testnet keys are not configured (BINANCE_TESTNET_API_KEY / _API_SECRET).')
  const query = buildQuery({ ...params, recvWindow: RECV_WINDOW_MS, timestamp: Date.now() })
  const signature = createHmac('sha256', creds.secret).update(query).digest('hex')
  return binanceFetch<T>(path, {
    method,
    headers: { 'X-MBX-APIKEY': creds.key },
    query: `${query}&signature=${signature}`,
  })
}

// ---- public (unauthenticated) ---------------------------------------------
export async function binancePing(): Promise<boolean> {
  await binanceFetch('/api/v3/ping')
  return true
}

export async function binanceServerTime(): Promise<number> {
  const data = await binanceFetch<{ serverTime: number }>('/api/v3/time')
  return data.serverTime
}

export type BinanceSymbolFilters = {
  symbol: string
  stepSize: number | null // LOT_SIZE quantity increment
  minQty: number | null
  minNotional: number | null
  tickSize: number | null // PRICE_FILTER price increment
}

export async function binanceSymbolFilters(symbol: string): Promise<BinanceSymbolFilters | null> {
  const data = await binanceFetch<{ symbols?: Array<{ symbol: string; filters: Array<Record<string, string>> }> }>(
    '/api/v3/exchangeInfo',
    { query: buildQuery({ symbol }) },
  )
  const entry = data.symbols?.find((item) => item.symbol === symbol)
  if (!entry) return null
  const num = (value: string | undefined) => (value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null)
  const lot = entry.filters.find((filter) => filter.filterType === 'LOT_SIZE')
  const price = entry.filters.find((filter) => filter.filterType === 'PRICE_FILTER')
  const notional = entry.filters.find((filter) => filter.filterType === 'NOTIONAL' || filter.filterType === 'MIN_NOTIONAL')
  return {
    symbol,
    stepSize: num(lot?.stepSize),
    minQty: num(lot?.minQty),
    minNotional: num(notional?.minNotional),
    tickSize: num(price?.tickSize),
  }
}

// ---- signed (authenticated) -----------------------------------------------
export type BinanceBalance = { asset: string; free: number; locked: number }

export async function binanceAccount(): Promise<{ canTrade: boolean; balances: BinanceBalance[] }> {
  const data = await binanceSignedRequest<{ canTrade: boolean; balances: Array<{ asset: string; free: string; locked: string }> }>(
    '/api/v3/account',
  )
  return {
    canTrade: Boolean(data.canTrade),
    balances: (data.balances ?? [])
      .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
      .filter((b) => b.free > 0 || b.locked > 0),
  }
}

// Validate an order against Binance's signature + symbol filters WITHOUT placing
// it (POST /api/v3/order/test). Used by the self-test to prove signed trading
// works end-to-end before any real testnet order is ever sent.
export async function binanceTestOrder(base: string, side: 'BUY' | 'SELL', quoteOrderQty: number): Promise<boolean> {
  const symbol = mapBaseToBinanceSymbol(base)
  if (!symbol) throw new Error(`No Binance symbol for base "${base}".`)
  await binanceSignedRequest('/api/v3/order/test', { symbol, side, type: 'MARKET', quoteOrderQty }, 'POST')
  return true
}

// ---- trading primitives (phase 2) -----------------------------------------
function round2(value: number) {
  return Math.round(value * 100) / 100
}

// Floor a quantity to the symbol's LOT_SIZE step so Binance never rejects it.
export function roundDownToStep(qty: number, step: number | null) {
  if (!step || step <= 0) return qty
  const decimals = Math.max(0, Math.round(Math.log10(1 / step)))
  return Number((Math.floor(qty / step) * step).toFixed(decimals))
}

export async function binanceTickerPrice(symbol: string): Promise<number> {
  const data = await binanceFetch<{ price: string }>('/api/v3/ticker/price', { query: buildQuery({ symbol }) })
  return Number(data.price)
}

export type BinanceFill = { orderId: number; base: string; symbol: string; qty: number; avgPrice: number; quote: number }

type BinanceOrderResp = { orderId: number; executedQty: string; cummulativeQuoteQty: string }
function fillFromOrder(base: string, symbol: string, order: BinanceOrderResp): BinanceFill {
  const qty = Number(order.executedQty)
  const quote = Number(order.cummulativeQuoteQty)
  return { orderId: order.orderId, base, symbol, qty, avgPrice: qty > 0 ? quote / qty : 0, quote }
}

// Market BUY by USDT amount (quoteOrderQty) — fills synchronously; the response
// carries the executed qty + average fill price.
export async function placeBinanceMarketBuy(base: string, quoteUsdt: number, clientOrderId?: string): Promise<BinanceFill> {
  const symbol = mapBaseToBinanceSymbol(base)
  if (!symbol) throw new Error(`No Binance symbol for base "${base}".`)
  const params: Query = { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: round2(quoteUsdt) }
  if (clientOrderId) params.newClientOrderId = clientOrderId
  return fillFromOrder(base, symbol, await binanceSignedRequest<BinanceOrderResp>('/api/v3/order', params, 'POST'))
}

// Market SELL a base quantity (floored to LOT_SIZE) — closes a held position.
export async function placeBinanceMarketSell(base: string, qty: number, clientOrderId?: string): Promise<BinanceFill> {
  const symbol = mapBaseToBinanceSymbol(base)
  if (!symbol) throw new Error(`No Binance symbol for base "${base}".`)
  const filters = await binanceSymbolFilters(symbol).catch(() => null)
  const sellQty = roundDownToStep(qty, filters?.stepSize ?? null)
  if (sellQty <= 0) throw new Error(`Sell qty ${qty} rounds below LOT_SIZE for ${symbol}.`)
  const params: Query = { symbol, side: 'SELL', type: 'MARKET', quantity: sellQty }
  if (clientOrderId) params.newClientOrderId = clientOrderId
  return fillFromOrder(base, symbol, await binanceSignedRequest<BinanceOrderResp>('/api/v3/order', params, 'POST'))
}

export async function binanceUsdtBalance(): Promise<number> {
  const account = await binanceAccount()
  return account.balances.find((balance) => balance.asset === QUOTE_ASSET)?.free ?? 0
}

export type BinanceSelfTest = {
  configured: boolean
  baseUrl: string
  ping: boolean
  serverTimeSkewMs: number | null
  account: { ok: boolean; canTrade: boolean; usdt: number | null; assets: number } | null
  testOrder: { ok: boolean; detail: string } | null
  error: string | null
}

// One-call connectivity check the /api/binance/test endpoint exposes. Public ping
// works with no keys; account + a dry-run test order light up once keys are added.
export async function binanceSelfTest(): Promise<BinanceSelfTest> {
  const result: BinanceSelfTest = {
    configured: binanceConfigured(),
    baseUrl: baseUrl(),
    ping: false,
    serverTimeSkewMs: null,
    account: null,
    testOrder: null,
    error: null,
  }
  try {
    result.ping = await binancePing()
    const serverTime = await binanceServerTime()
    result.serverTimeSkewMs = Date.now() - serverTime
  } catch (error) {
    result.error = `connectivity: ${message(error)}`
    return result
  }
  if (!result.configured) return result
  try {
    const account = await binanceAccount()
    const usdt = account.balances.find((b) => b.asset === QUOTE_ASSET)
    result.account = { ok: true, canTrade: account.canTrade, usdt: usdt ? usdt.free : 0, assets: account.balances.length }
  } catch (error) {
    result.account = { ok: false, canTrade: false, usdt: null, assets: 0 }
    result.error = `account: ${message(error)}`
    return result
  }
  try {
    await binanceTestOrder('BTC', 'BUY', 15)
    result.testOrder = { ok: true, detail: 'signed dry-run order accepted (nothing executed)' }
  } catch (error) {
    result.testOrder = { ok: false, detail: message(error) }
  }
  return result
}
