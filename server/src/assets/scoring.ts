import { Instrument } from './types'
import { ISSUERS } from './issuers'

/**
 * Execution Score — 综合评分 (0-100)
 *
 * 不只是"最低价格"，而是衡量用户买入这个 instrument 的综合体验：
 *
 *   Token price (premium/discount)    — 30%
 *   Liquidity depth                   — 25%
 *   Route availability                — 15%
 *   Issuer trust (redemption, KYC)    — 20%
 *   Chain accessibility               — 10%
 */

export function calculateScore(instrument: Instrument, oraclePrice: number | null): number {
  let score = 0

  // ─── 1. Price Score (30 pts) ───
  // 越低 premium（或越高 discount）越好
  if (instrument.premiumPct != null) {
    const prem = instrument.premiumPct
    if (prem <= -5)      score += 30   // 大折扣
    else if (prem <= -2) score += 27
    else if (prem <= 0)  score += 24   // 小折扣
    else if (prem <= 1)  score += 20   // 微溢价
    else if (prem <= 3)  score += 15
    else if (prem <= 5)  score += 10
    else                 score += 5    // 高溢价
  }

  // ─── 2. Liquidity Score (25 pts) ───
  const liq = instrument.liquidity
  if (liq.status === 'tradeable') {
    score += 20
    // 路由数量加分
    if (liq.routes.length >= 3)      score += 5
    else if (liq.routes.length >= 2) score += 3
    else                             score += 1
  } else if (liq.status === 'low_liquidity') {
    score += 10
  } else if (liq.status === 'no_route') {
    score += 0
  }
  // 'unknown' 给一个中等值，避免新 instrument 被完全忽略
  else { score += 8 }

  // ─── 3. Route Availability (15 pts) ───
  if (liq.slippage1k != null) {
    if (liq.slippage1k < 0.5)       score += 15
    else if (liq.slippage1k < 1)    score += 12
    else if (liq.slippage1k < 3)    score += 8
    else if (liq.slippage1k < 5)    score += 4
    else                            score += 1
  } else if (liq.status === 'tradeable') {
    score += 10  // 路由可用但没有滑点数据
  }

  // ─── 4. Issuer Trust (20 pts) ───
  const issuer = ISSUERS[instrument.issuer]
  if (issuer) {
    if (issuer.redemption) score += 10  // 可赎回 = 有锚定机制
    if (issuer.kyc === 'required') score += 5  // 合规 = 更安全
    // 已知 issuer 基础分
    score += 5
  }

  // ─── 5. Chain Accessibility (10 pts) ───
  // 主流链更容易操作
  const chainScores: Record<number, number> = {
    1: 10,       // Ethereum — 最高流动性
    8453: 9,     // Base — 低 gas，活跃
    42161: 9,    // Arbitrum — 低 gas
    56: 8,       // BNB — 大量用户
    0: 6,        // Solana — 不同生态
    4663: 5,     // Robinhood Chain — 封闭生态
  }
  score += chainScores[instrument.chainId] ?? 5

  return Math.min(100, Math.max(0, score))
}

/**
 * 批量计算所有 instruments 的评分
 */
export function scoreAllInstruments(
  instruments: Instrument[],
  oraclePrice: number | null,
): void {
  for (const inst of instruments) {
    inst.score = calculateScore(inst, oraclePrice)
  }
}
