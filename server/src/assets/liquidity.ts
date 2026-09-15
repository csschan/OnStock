import { Instrument, TradeStatus, LiquidityInfo } from './types'
import { getAssetGraph, updateInstrumentLiquidity } from './graph'

/**
 * Liquidity Prober — 探测每个 instrument 的路由可用性
 *
 * 在服务端定期运行（不是等用户点 Buy 才检查）
 * 用 100 USDC 作为测试金额，并行检查 KyberSwap / Paraswap
 */

const USDC_BY_CHAIN: Record<number, string> = {
  1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

const USDC_DECIMALS: Record<number, number> = {
  1: 6, 56: 18, 8453: 6, 42161: 6,
}

const KYBER_SLUG: Record<number, string> = {
  1: 'ethereum', 56: 'bsc', 8453: 'base', 42161: 'arbitrum',
}

// ─── 单个路由检查 ───

async function checkKyberSwap(
  chainId: number, usdc: string, tokenAddr: string, testAmount: string,
): Promise<{ ok: boolean; amountOut: string }> {
  const slug = KYBER_SLUG[chainId]
  if (!slug) return { ok: false, amountOut: '0' }
  try {
    const res = await fetch(
      `https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${usdc}&tokenOut=${tokenAddr}&amountIn=${testAmount}`,
      { headers: { 'x-client-id': 'onstock' }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return { ok: false, amountOut: '0' }
    const json = await res.json() as any
    const amountOut = json?.data?.routeSummary?.amountOut
    if (!amountOut || amountOut === '0') return { ok: false, amountOut: '0' }
    return { ok: true, amountOut }
  } catch {
    return { ok: false, amountOut: '0' }
  }
}

async function checkParaswap(
  chainId: number, usdc: string, tokenAddr: string, testAmount: string,
): Promise<{ ok: boolean; amountOut: string }> {
  const decimals = USDC_DECIMALS[chainId] ?? 6
  try {
    const res = await fetch(
      `https://apiv5.paraswap.io/prices?srcToken=${usdc}&destToken=${tokenAddr}&srcDecimals=${decimals}&destDecimals=18&amount=${testAmount}&network=${chainId}&side=SELL`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return { ok: false, amountOut: '0' }
    const json = await res.json() as any
    const destAmount = json?.priceRoute?.destAmount
    if (!destAmount) return { ok: false, amountOut: '0' }
    return { ok: true, amountOut: destAmount }
  } catch {
    return { ok: false, amountOut: '0' }
  }
}

// ─── 判断路由输出是否合理 ───

function isReasonableOutput(
  amountOutRaw: string,
  oraclePrice: number | null,
  testUsdAmount: number,
): boolean {
  if (!oraclePrice || oraclePrice <= 0) return true // 没有 oracle 无法验证
  const tokenAmount = Number(amountOutRaw) / 1e18
  const usdValue = tokenAmount * oraclePrice
  // 100 USDC 应该换出 $40-$500 的价值（允许较大波动）
  return usdValue > testUsdAmount * 0.4 && usdValue < testUsdAmount * 5
}

// ─── 探测单个 instrument ───

async function probeInstrument(
  instrument: Instrument,
  oraclePrice: number | null,
): Promise<Partial<LiquidityInfo>> {
  const usdc = USDC_BY_CHAIN[instrument.chainId]
  if (!usdc) {
    // 不支持的链（Solana, Robinhood Chain）
    if (instrument.chainId === 4663) {
      // Robinhood Chain: 有官方 API 价格 = 可交易
      return {
        status: 'tradeable' as TradeStatus,
        routes: ['robinhood'],
        maxTradeUsd: 100000,
        slippage1k: 0.1,
      }
    }
    if (instrument.chainId === 0) {
      // Solana: 通过 Jupiter
      return {
        status: 'tradeable' as TradeStatus,
        routes: ['jupiter'],
        maxTradeUsd: null,
        slippage1k: null,
      }
    }
    return { status: 'no_route' as TradeStatus, routes: [] }
  }

  const decimals = USDC_DECIMALS[instrument.chainId] ?? 6
  const testAmount = (100 * 10 ** decimals).toFixed(0)

  const [kyber, paraswap] = await Promise.all([
    checkKyberSwap(instrument.chainId, usdc, instrument.contractAddress, testAmount),
    checkParaswap(instrument.chainId, usdc, instrument.contractAddress, testAmount),
  ])

  const routes: string[] = []
  let bestAmountOut = '0'

  if (kyber.ok && isReasonableOutput(kyber.amountOut, oraclePrice, 100)) {
    routes.push('kyber')
    bestAmountOut = kyber.amountOut
  }
  if (paraswap.ok && isReasonableOutput(paraswap.amountOut, oraclePrice, 100)) {
    routes.push('paraswap')
    if (BigInt(paraswap.amountOut) > BigInt(bestAmountOut)) {
      bestAmountOut = paraswap.amountOut
    }
  }

  if (routes.length === 0) {
    return { status: 'no_route' as TradeStatus, routes: [] }
  }

  // 估算滑点：用 100 USDC 的输出 vs oracle 预期输出
  let slippage1k: number | null = null
  if (oraclePrice && oraclePrice > 0) {
    const tokenAmount = Number(bestAmountOut) / 1e18
    const actualUsd = tokenAmount * oraclePrice
    const expectedUsd = 100 // 输入了 100 USDC
    const slip = ((expectedUsd - actualUsd) / expectedUsd) * 100
    // $1000 订单的滑点大约是 $100 的 ~3-5x（AMM 二次方根关系）
    slippage1k = Math.max(0, slip * 3)
  }

  const status: TradeStatus = slippage1k != null && slippage1k > 10
    ? 'low_liquidity'
    : 'tradeable'

  return {
    status,
    routes,
    maxTradeUsd: null, // TODO: 后续通过多级测试估算
    slippage1k,
  }
}

// ─── 批量探测 ───

/**
 * 探测所有 instruments 的流动性
 * 批量执行，每 3 个一组，300ms 间隔
 */
export async function probeAllLiquidity(
  oraclePrices: Map<string, number>,
): Promise<void> {
  const graph = getAssetGraph()
  const allInstruments: Instrument[] = []

  for (const asset of graph.values()) {
    for (const inst of asset.instruments) {
      allInstruments.push(inst)
    }
  }

  console.log(`[liquidity] Probing ${allInstruments.length} instruments...`)
  const batchSize = 3
  let probed = 0

  for (let i = 0; i < allInstruments.length; i += batchSize) {
    const batch = allInstruments.slice(i, i + batchSize)
    await Promise.all(batch.map(async (inst) => {
      const oracle = oraclePrices.get(inst.ticker) ?? null
      const result = await probeInstrument(inst, oracle)
      updateInstrumentLiquidity(inst.id, result)
      probed++
    }))
    // 避免 API 限流
    if (i + batchSize < allInstruments.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // 统计
  const tradeable = allInstruments.filter(i => i.liquidity.status === 'tradeable').length
  const lowLiq = allInstruments.filter(i => i.liquidity.status === 'low_liquidity').length
  const noRoute = allInstruments.filter(i => i.liquidity.status === 'no_route').length
  console.log(`[liquidity] Done: ${tradeable} tradeable, ${lowLiq} low liquidity, ${noRoute} no route`)
}
