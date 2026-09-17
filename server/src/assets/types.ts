/**
 * Asset Graph — 两层数据模型
 *
 * CanonicalAsset: 用户搜索的"股票"（AAPL, TSLA, QQQ）
 * Instrument:     链上可交易的具体 token（Ondo AAPLon on ETH, Backed AAPLx on SOL）
 *
 * 用户想买的是 Apple，不是 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c
 */

// ─── Instrument（链上可交易的具体 token）───

export type TradeStatus = 'tradeable' | 'low_liquidity' | 'no_route' | 'unknown'

export interface LiquidityInfo {
  status: TradeStatus
  routes: string[]                 // 可用的聚合器/路由 ['kyber', 'uniswap', 'odos']
  maxTradeUsd: number | null       // 估算最大可交易金额（$）
  slippage1k: number | null        // $1000 交易预估滑点 (%)
  lastChecked: number              // timestamp ms
}

export interface IssuerInfo {
  name: string                     // 'Ondo Finance'
  slug: string                     // 'ondo'
  redemption: boolean              // 是否支持赎回底层资产
  kyc: 'none' | 'required' | 'optional'
  backing: string                  // '1:1 US equity, custodied at Ankura Trust'
  website: string
  tradingModel?: 'dex' | 'orderbook'  // dex = DEX 自由交易; orderbook = 平台订单簿
  tradingMethod?: string           // '永续合约做多/做空' — 用户可见的交易方式
  tradingDesc?: string             // 更详细的说明
}

export interface Instrument {
  id: string                       // 唯一标识：'ondo-aapl-ethereum'
  ticker: string                   // 'AAPL'
  issuer: string                   // 'ondo'
  chain: string                    // 'ethereum'
  chainId: number                  // 1
  tokenSymbol: string              // 'AAPLon'
  contractAddress: string          // '0x14c3...'
  decimals: number                 // 18

  // 实时数据（由 aggregator 填充）
  price: number | null             // 当前 DEX 价格 (USD)
  premiumPct: number | null        // vs oracle (%)
  source: string | null            // 'kyberswap' / 'uniswap-v3' / ...

  // 流动性（由 liquidity prober 填充）
  liquidity: LiquidityInfo

  // 综合评分（由 scoring 计算）
  score: number | null             // 0-100

  // 供应量（由 supply fetcher 填充，每 5 分钟更新）
  totalSupply: number | null       // 链上流通量（token 单位）
  aumUsd: number | null            // = totalSupply × marketPrice

  // LP 池子（由 lpPools fetcher 填充，每 5 分钟更新）
  pool: {
    poolAddress: string
    feeTier: number
    tvlUsd: number
    volume24hUsd: number
    fees24hUsd: number
  } | null
}

// ─── Canonical Asset（用户搜索的"股票"）───

export interface CanonicalAsset {
  ticker: string                   // 'AAPL'
  name: string                     // 'Apple Inc.'
  sector: string                   // 'Technology'
  type: 'stock' | 'etf' | 'pre-ipo'

  // 传统市场参考价
  marketPrice: number | null       // Yahoo Finance / NASDAQ
  change24h: number | null         // 24h 变动 (%)

  // 链上所有版本
  instruments: Instrument[]

  // 最优选项（预计算）
  bestBuy: Instrument | null       // 最低有效价格且可交易
  bestScore: Instrument | null     // 综合评分最高
}
