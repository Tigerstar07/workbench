export type StockProviderId = 'alpaca' | 'yahoo' | 'massive' | 'ibkr'

export type StockProviderCapability =
  | 'screeners'
  | 'snapshots'
  | 'quotes'
  | 'trades'
  | 'websocket'
  | 'one-minute-bars'
  | 'second-bars'
  | 'paper-orders'

export type StockProviderDescriptor = {
  id: StockProviderId
  label: string
  role: 'active' | 'fallback' | 'planned'
  capabilities: StockProviderCapability[]
  envKeys: string[]
}

export const STOCK_PROVIDER_REGISTRY: StockProviderDescriptor[] = [
  {
    id: 'alpaca',
    label: 'Alpaca',
    role: 'active',
    capabilities: ['screeners', 'snapshots', 'quotes', 'trades', 'websocket', 'one-minute-bars', 'paper-orders'],
    envKeys: ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY'],
  },
  {
    id: 'yahoo',
    label: 'Yahoo Finance',
    role: 'fallback',
    capabilities: ['screeners', 'snapshots', 'one-minute-bars'],
    envKeys: [],
  },
  {
    id: 'massive',
    label: 'Massive/Polygon',
    role: 'planned',
    capabilities: ['snapshots', 'quotes', 'trades', 'one-minute-bars', 'second-bars'],
    envKeys: ['MASSIVE_API_KEY'],
  },
  {
    id: 'ibkr',
    label: 'IBKR',
    role: 'planned',
    capabilities: ['snapshots', 'quotes', 'trades', 'one-minute-bars'],
    envKeys: ['IBKR_GATEWAY_URL'],
  },
]

export function configuredStockProviders(env: Record<string, string | undefined> = {}) {
  return STOCK_PROVIDER_REGISTRY.map((provider) => ({
    ...provider,
    configured: provider.envKeys.length === 0 || provider.envKeys.every((key) => Boolean(env[key]?.trim())),
  }))
}
