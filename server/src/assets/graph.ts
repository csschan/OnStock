import { TOKENS, TokenConfig } from '../config/tokens'
import { CANONICAL_ASSETS } from './canonical'
import { CanonicalAsset, Instrument, LiquidityInfo, TradeStatus } from './types'

/**
 * Asset Graph — 核心数据结构
 *
 * 从 tokens.ts (flat list) → 两层结构：
 *   CanonicalAsset (AAPL) → Instrument[] (Ondo/ETH, Backed/SOL, ...)
 *
 * 被 aggregator 和 API 共同使用
 */

// ─── 全局单例 ───
let assetGraph: Map<string, CanonicalAsset> = new Map()

function defaultLiquidity(): LiquidityInfo {
  return {
    status: 'unknown',
    routes: [],
    maxTradeUsd: null,
    slippage1k: null,
    lastChecked: 0,
  }
}

function tokenToInstrument(token: TokenConfig): Instrument {
  return {
    id: `${token.issuer}-${token.ticker.toLowerCase()}-${token.chain}`,
    ticker: token.ticker,
    issuer: token.issuer,
    chain: token.chain,
    chainId: token.chainId,
    tokenSymbol: token.tokenSymbol,
    contractAddress: token.contractAddress,
    decimals: token.decimals,
    price: null,
    premiumPct: null,
    source: null,
    liquidity: defaultLiquidity(),
    score: null,
    totalSupply: null,
    aumUsd: null,
    pool: null,
  }
}

/**
 * 初始化 Asset Graph
 * 只需在启动时调用一次
 */
export function buildAssetGraph(): Map<string, CanonicalAsset> {
  const graph = new Map<string, CanonicalAsset>()

  // 1. 创建所有 canonical assets
  for (const def of CANONICAL_ASSETS) {
    graph.set(def.ticker, {
      ...def,
      marketPrice: null,
      change24h: null,
      instruments: [],
      bestBuy: null,
      bestScore: null,
    })
  }

  // 2. 把每个 token 挂到对应的 canonical asset 下
  for (const token of TOKENS) {
    let asset = graph.get(token.ticker)

    // tokens.ts 里有但 canonical.ts 里没定义的 ticker → 自动创建
    if (!asset) {
      asset = {
        ticker: token.ticker,
        name: token.ticker,
        sector: 'Unknown',
        type: 'stock',
        marketPrice: null,
        change24h: null,
        instruments: [],
        bestBuy: null,
        bestScore: null,
      }
      graph.set(token.ticker, asset)
    }

    asset.instruments.push(tokenToInstrument(token))
  }

  assetGraph = graph
  return graph
}

// ─── 查询接口 ───

export function getAssetGraph(): Map<string, CanonicalAsset> {
  if (assetGraph.size === 0) buildAssetGraph()
  return assetGraph
}

export function getAsset(ticker: string): CanonicalAsset | undefined {
  return getAssetGraph().get(ticker.toUpperCase())
}

export function getAllAssets(): CanonicalAsset[] {
  return Array.from(getAssetGraph().values())
}

export function searchAssets(query: string): CanonicalAsset[] {
  const q = query.toLowerCase()
  return getAllAssets().filter(a =>
    a.ticker.toLowerCase().includes(q) ||
    a.name.toLowerCase().includes(q)
  )
}

/**
 * 根据 instrument ID 查找
 */
export function getInstrument(id: string): Instrument | undefined {
  for (const asset of getAssetGraph().values()) {
    const inst = asset.instruments.find(i => i.id === id)
    if (inst) return inst
  }
  return undefined
}

/**
 * 查找指定 ticker 的所有可交易 instruments
 */
export function getTradeableInstruments(ticker: string): Instrument[] {
  const asset = getAsset(ticker)
  if (!asset) return []
  return asset.instruments.filter(i =>
    i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity'
  )
}

/**
 * 返回所有 canonical assets 下的所有 instruments（用于 portfolio 持仓查询）
 */
export function getAllInstruments(): Array<Instrument & { assetTicker: string; assetName: string; marketPrice: number | null }> {
  const result: Array<Instrument & { assetTicker: string; assetName: string; marketPrice: number | null }> = []
  for (const asset of assetGraph.values()) {
    for (const inst of asset.instruments) {
      result.push({ ...inst, assetTicker: asset.ticker, assetName: asset.name, marketPrice: asset.marketPrice })
    }
  }
  return result
}

// ─── 更新接口（由 aggregator / liquidity prober 调用）───

/**
 * 更新 instrument 的价格数据
 */
export function updateInstrumentPrice(
  instrumentId: string,
  price: number,
  premiumPct: number,
  source: string,
): void {
  const inst = getInstrument(instrumentId)
  if (!inst) return
  inst.price = price
  inst.premiumPct = premiumPct
  inst.source = source
}

/**
 * 更新 instrument 的流动性数据
 */
export function updateInstrumentLiquidity(
  instrumentId: string,
  liquidity: Partial<LiquidityInfo>,
): void {
  const inst = getInstrument(instrumentId)
  if (!inst) return
  Object.assign(inst.liquidity, liquidity, { lastChecked: Date.now() })
}

/**
 * 更新 canonical asset 的市场参考价
 */
export function updateMarketPrice(
  ticker: string,
  marketPrice: number,
  change24h: number | null,
): void {
  const asset = getAsset(ticker)
  if (!asset) return
  asset.marketPrice = marketPrice
  asset.change24h = change24h
}

/**
 * 更新 instrument 的供应量数据
 */
export function updateInstrumentSupply(
  instrumentId: string,
  totalSupply: number,
  marketPrice: number | null,
): void {
  const inst = getInstrument(instrumentId)
  if (!inst) return
  inst.totalSupply = totalSupply
  inst.aumUsd = marketPrice != null ? totalSupply * marketPrice : null
}

/**
 * 更新 instrument 的 LP 池子数据
 */
export function updateInstrumentPool(
  instrumentId: string,
  pool: { poolAddress: string; feeTier: number; tvlUsd: number; volume24hUsd: number; fees24hUsd: number }
): void {
  const inst = getInstrument(instrumentId)
  if (!inst) return
  // 同一 instrument 可能有多个池子，保留 TVL 最大的
  if (!inst.pool || pool.tvlUsd > inst.pool.tvlUsd) {
    inst.pool = pool
  }
}

/**
 * 重新计算 bestBuy 和 bestScore
 * 在价格/流动性更新后调用
 */
export function recalcBestOptions(ticker: string): void {
  const asset = getAsset(ticker)
  if (!asset) return

  const tradeable = asset.instruments.filter(i =>
    i.price != null && i.price > 0 &&
    (i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity')
  )

  // bestBuy: 最低价格
  asset.bestBuy = tradeable.length > 0
    ? tradeable.reduce((a, b) => (a.price! < b.price! ? a : b))
    : null

  // bestScore: 最高综合评分
  const scored = tradeable.filter(i => i.score != null)
  asset.bestScore = scored.length > 0
    ? scored.reduce((a, b) => (a.score! > b.score! ? a : b))
    : null
}
