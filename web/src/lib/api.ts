// API client：对接后端 server，并把数据转换成前端组件需要的格式
// 后端地址通过环境变量配置，本地开发默认 localhost:4000

import type { Quote } from './mock-data'
import { CHAIN_ID, USDC_BY_CHAIN } from './chains'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

// ─── 原始后端类型 ───

interface RawPriceSource {
  issuer: string
  chain: string
  tokenSymbol: string
  contractAddress?: string | null
  dexPrice: number
  premiumPct: number | null
  liquidityUsd: number | null
  source: string
  capturedAt: string
}

interface RawStockSummary {
  ticker: string
  oraclePrice: number | null
  dexPrice: number
  premiumPct: number | null
  crossChainSpreadPct: number
  sourceCount: number
  capturedAt: string
  change24h: number | null
}

export interface RawArbitrage {
  id: number
  ticker: string
  type: string   // 'B' = same-issuer bridge, 'C' = cross-issuer DEX
  buyChain: string
  buyIssuer: string
  buyPrice: number
  buyLiquidityUsd: number | null
  buyContractAddress: string | null
  sellChain: string
  sellIssuer: string
  sellPrice: number
  sellLiquidityUsd: number | null
  sellContractAddress: string | null
  spreadPct: number
  estimatedProfit: number | null
  detectedAt: string
}

// ─── 转换函数 ───

function chainLabel(chain: string): string {
  const map: Record<string, string> = {
    ethereum: 'Ethereum',
    bnb: 'BNB Chain',
    solana: 'Solana',
    base: 'Base',
    arbitrum: 'Arbitrum',
    'robinhood-chain': 'Robinhood Chain',
  }
  return map[chain] ?? chain
}

function issuerToType(issuer: string): 'issuer' | 'dex' {
  const issuers = ['ondo', 'backed', 'dinari', 'kraken', 'robinhood']
  return issuers.includes(issuer) ? 'issuer' : 'dex'
}

function issuerFee(issuer: string): number {
  const fees: Record<string, number> = {
    ondo: 0.1,
    backed: 0.2,
    dinari: 0.05,
    kraken: 0.1,
    robinhood: 0.0,  // Robinhood 无交易手续费
  }
  return fees[issuer] ?? 0.3
}

function issuerRequiresKYC(issuer: string): boolean {
  return ['dinari', 'kraken'].includes(issuer)
}

function sourceToTradeUrl(issuer: string, chain?: string, contractAddress?: string | null): string {
  // Robinhood Chain → Uniswap v4 (Robinhood's native DEX)
  if (chain === 'robinhood-chain' && contractAddress) {
    return `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${contractAddress}`
  }
  // EVM chains with contract address → KyberSwap aggregator deep link
  if (chain && contractAddress) {
    const chainSlug: Record<string, string> = {
      ethereum: 'ethereum', bnb: 'bnb', base: 'base', arbitrum: 'arbitrum',
    }
    const slug = chainSlug[chain]
    if (slug) {
      const chainId = CHAIN_ID[chain]
      const usdc = chainId ? USDC_BY_CHAIN[chainId] : null
      if (usdc) {
        return `https://kyberswap.com/swap/${slug}?inputCurrency=${usdc}&outputCurrency=${contractAddress}`
      }
    }
  }
  // Fallback: issuer app pages (NOT marketing homepages)
  const urls: Record<string, string> = {
    ondo: 'https://app.ondo.finance',
    backed: 'https://app.backed.fi',
    dinari: 'https://app.dinari.com',
    kraken: 'https://trade.kraken.com',
    robinhood: 'https://robinhood.com',
  }
  return urls[issuer] ?? '#'
}

// 把后端 PriceSource 转成前端 Quote
function toQuote(src: RawPriceSource): Quote {
  return {
    provider: src.issuer.charAt(0).toUpperCase() + src.issuer.slice(1),
    type: issuerToType(src.issuer),
    tokenName: src.tokenSymbol,
    chain: chainLabel(src.chain),
    price: src.dexPrice,
    premiumPercent: src.premiumPct ?? 0,
    protocolFee: issuerFee(src.issuer),
    estimatedGas: src.chain === 'ethereum' ? 0.5 : src.chain === 'solana' ? 0.001 : 0.05,
    canTradeInPlatform: !issuerRequiresKYC(src.issuer),
    tradeUrl: sourceToTradeUrl(src.issuer, src.chain, src.contractAddress),
    requiresKYC: issuerRequiresKYC(src.issuer),
    hasDividends: true,
    tokenAddress: src.contractAddress ?? undefined,
    chainId: CHAIN_ID[src.chain] ?? undefined,
    liquidityUsd: src.liquidityUsd,
  }
}

// ─── 公开 API 函数 ───

export async function fetchStocks(): Promise<RawStockSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/stocks`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

export async function fetchStockPrices(ticker: string): Promise<{
  oraclePrice: number | null
  buyQuotes: Quote[]
  sellQuotes: Quote[]
  bestBuy: RawPriceSource | null
  bestSell: RawPriceSource | null
}> {
  try {
    const res = await fetch(`${API_BASE}/prices/${ticker}`, { cache: 'no-store' })
    const json = await res.json()

    if (!json.ok || !json.data) {
      return { oraclePrice: null, buyQuotes: [], sellQuotes: [], bestBuy: null, bestSell: null }
    }

    const { oraclePrice, sources, bestBuy, bestSell } = json.data

    // 买入报价：按价格从低到高排序（越低越好）
    const buyQuotes = [...sources]
      .sort((a, b) => a.dexPrice - b.dexPrice)
      .map(toQuote)

    // 卖出报价：按价格从高到低排序（越高越好）
    const sellQuotes = [...sources]
      .sort((a, b) => b.dexPrice - a.dexPrice)
      .map(toQuote)

    return { oraclePrice, buyQuotes, sellQuotes, bestBuy, bestSell }
  } catch {
    return { oraclePrice: null, buyQuotes: [], sellQuotes: [], bestBuy: null, bestSell: null }
  }
}

export async function fetchArbitrage(): Promise<RawArbitrage[]> {
  try {
    const res = await fetch(`${API_BASE}/arbitrage`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

export interface PricePoint {
  chain: string
  issuer: string
  tokenSymbol: string
  dexPrice: number
  oraclePrice: number | null
  premiumPct: number | null
  capturedAt: string
}

export async function fetchPricePoints(ticker: string, hours = 24): Promise<PricePoint[]> {
  try {
    const res = await fetch(`${API_BASE}/prices/${ticker}/history?hours=${hours}`, {
      next: { revalidate: 60 },
    })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

export async function fetchPriceHistory(ticker: string, hours = 24) {
  try {
    const res = await fetch(`${API_BASE}/prices/${ticker}/history?hours=${hours}`, {
      next: { revalidate: 60 },
    })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

// ─── 市场状态 ───

export interface MarketDeviation {
  ticker: string
  lastOraclePrice: number
  bestDexPrice: number
  dexChain: string
  dexIssuer: string
  contractAddress: string | null
  liquidityUsd: number | null
  // 当前偏离（vs oracle）
  deviationPct: number
  // 7天历史均值偏离（null = 数据不足）
  historicalAvgPct: number | null
  // 异常信号强度 = deviationPct - historicalAvgPct
  signalPct: number | null
  // 历史数据点数
  historySamples: number
  // 是否异常（偏离显著超出历史基准）
  isAbnormal: boolean
  opportunity: 'discount' | 'premium' | 'neutral'
}

export interface MarketStatusData {
  market: {
    status: 'open' | 'pre-market' | 'after-hours' | 'overnight' | 'weekend'
    isOpen: boolean
    label: string
    description: string
    nextOpenISO: string | null
    hoursUntilOpen: number | null
  }
  oracleFreezeHours: number | null
  deviations: MarketDeviation[]
}

export interface PriceSource {
  issuer: string
  chain: string
  tokenSymbol: string
  contractAddress?: string | null
  dexPrice: number
  premiumPct: number | null
  liquidityUsd: number | null
  source: string
  capturedAt: string
}

export async function fetchPriceSources(ticker: string): Promise<PriceSource[]> {
  try {
    const res = await fetch(`${API_BASE}/prices/${ticker}/sources`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data.sources ?? [] : []
  } catch {
    return []
  }
}

export async function fetchMarketStatus(): Promise<MarketStatusData | null> {
  try {
    const res = await fetch(`${API_BASE}/market-status`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}

// ─── Asset Graph ───

export interface InstrumentLiquidity {
  status: 'tradeable' | 'low_liquidity' | 'no_route' | 'unknown'
  routes: string[]
  maxTradeUsd: number | null
  slippage1k: number | null
  lastChecked: number
}

export interface InstrumentData {
  id: string
  issuer: string
  issuerName: string
  chain: string
  chainId: number
  tokenSymbol: string
  contractAddress: string
  decimals: number
  price: number | null
  premiumPct: number | null
  source: string | null
  liquidity: InstrumentLiquidity
  score: number | null
  issuerInfo: {
    name: string
    slug: string
    website: string
    redemption: boolean
    kyc: string
    backing: string
  } | null
}

export interface AssetDetail {
  ticker: string
  name: string
  sector: string
  type: 'stock' | 'etf'
  marketPrice: number | null
  change24h: number | null
  instruments: InstrumentData[]
  bestBuy: string | null
  bestScore: string | null
}

export interface AssetSummary {
  ticker: string
  name: string
  sector: string
  type: 'stock' | 'etf'
  marketPrice: number | null
  change24h: number | null
  instrumentCount: number
  tradeableCount: number
  bestBuy: { price: number | null; premiumPct: number | null; issuer: string; chain: string; score: number | null } | null
  bestScore: { price: number | null; premiumPct: number | null; issuer: string; chain: string; score: number | null } | null
}

export interface AssetSearchResult {
  ticker: string
  name: string
  sector: string
  type: 'stock' | 'etf'
  marketPrice: number | null
  tradeableCount: number
}

export async function fetchAsset(ticker: string): Promise<AssetDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/assets/${ticker.toUpperCase()}`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}

export async function fetchAllAssets(): Promise<AssetSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/assets`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

export async function searchAssetsApi(q: string): Promise<AssetSearchResult[]> {
  try {
    const res = await fetch(`${API_BASE}/assets/search?q=${encodeURIComponent(q)}`)
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

// Flat list of all instruments across all assets — used by portfolio page
export interface FlatInstrument extends InstrumentData {
  assetTicker: string
  assetName: string
  marketPrice: number | null
}

export async function fetchAllInstruments(): Promise<FlatInstrument[]> {
  try {
    const res = await fetch(`${API_BASE}/assets/instruments`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

// ─── Market Overview (per-ticker × per-issuer AUM / supply / premium) ───

export interface IssuerOverview {
  issuer: string
  issuerName: string
  totalSupplyTokens: number
  aumUsd: number
  tvlUsd: number
  volume24hUsd: number
  marketSharePct: number
  premiumPct: number | null
  premiumTrend7d: { direction: string | null; delta: number } | null
  chains: string[]
  status: string
}

export interface AssetOverview {
  ticker: string
  name: string
  sector: string
  type: string
  marketPrice: number | null
  change24h: number | null
  totalAumUsd: number
  issuers: IssuerOverview[]
}

// ─── Market Stats (homepage dashboard) ───

export interface MarketStats {
  summary: {
    totalAumUsd: number
    avgPremiumPct: number | null
    tradeableRoutes: number
    activeChains: string[]
    assetCount: number
  }
  heatmap: Array<{
    ticker: string
    name: string
    marketPrice: number | null
    change24h: number | null
    cells: Array<{
      issuer: string
      premiumPct: number | null
      chain: string | null
      note: string | null   // 'orderbook' = Dinari 订单簿，不是 DEX 价格
    }>
  }>
  signals: {
    discounts: Array<{ ticker: string; issuer: string; chain: string; premiumPct: number; marketPrice: number }>
    premiums:  Array<{ ticker: string; issuer: string; chain: string; premiumPct: number; marketPrice: number }>
  }
}

export async function fetchMarketStats(): Promise<MarketStats | null> {
  try {
    const res = await fetch(`${API_BASE}/market/stats`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}

export async function fetchMarketOverview(): Promise<AssetOverview[]> {
  try {
    const res = await fetch(`${API_BASE}/market/overview`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : []
  } catch {
    return []
  }
}

// ─── 价格发散监控 ───

export interface DivergencePlatform {
  issuer: string
  issuerName: string
  chain: string
  type: 'spot' | 'perp'
  price: number
  vsOraclePct: number
  liquidityStatus: string
}

export interface DivergenceStock {
  ticker: string
  name: string
  oraclePrice: number
  platforms: DivergencePlatform[]
  maxSpreadPct: number
  cheapest: { issuer: string; chain: string; price: number }
  mostExpensive: { issuer: string; chain: string; price: number }
}

export interface DivergenceData {
  market: { status: string; isOpen: boolean; nextEvent: string; nextEventTime: string }
  hyperliquidCount: number
  stocks: DivergenceStock[]
}

export async function fetchDivergence(): Promise<DivergenceData | null> {
  try {
    const res = await fetch(`${API_BASE}/market/divergence`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}

// ─── DeFi 收益聚合 ───

export interface DefiYield {
  protocol: string
  protocolName: string
  type: 'lending' | 'cdp' | 'lp' | 'leveraged'
  asset: string
  action: string
  actionLabel: string
  supplyApy: number | null
  borrowApy: number | null
  netApy: number
  ltv: number | null
  liquidationThreshold: number | null
  tvlUsd: number
  riskLevel: 'low' | 'medium' | 'high'
  details: string
}

export interface DefiYieldSummary {
  bestApy: number
  bestProtocol: string
  count: number
}

export interface EarnData {
  yields: DefiYield[]
  summary: Record<string, DefiYieldSummary>
}

export interface EarnAssetData {
  ticker: string
  yields: DefiYield[]
}

export async function fetchEarnOverview(): Promise<EarnData | null> {
  try {
    const res = await fetch(`${API_BASE}/earn`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}

export async function fetchEarnByTicker(ticker: string): Promise<EarnAssetData | null> {
  try {
    const res = await fetch(`${API_BASE}/earn/${ticker.toUpperCase()}`, { cache: 'no-store' })
    const json = await res.json()
    return json.ok ? json.data : null
  } catch {
    return null
  }
}
