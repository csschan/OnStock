// 核心聚合器：把所有 fetcher 的数据汇总，计算溢价和套利机会，存入数据库

import { prisma } from './db/client.js'
import { fetchAllStockPrices } from './fetchers/stockprice.js'
import { fetchAllEvmQuotes } from './fetchers/kyberswap.js'
import { fetchAllSolanaQuotes } from './fetchers/jupiter.js'
import { fetchAllRobinhoodQuotes } from './fetchers/robinhood.js'
import { fetchAllUniswapV3Quotes } from './fetchers/uniswapV3.js'
import { fetchAllPancakeV3Quotes } from './fetchers/pancakeswapV3.js'
import { fetchAllSupplies } from './fetchers/supply.js'
import { fetchAllPoolInfo } from './fetchers/lpPools.js'
import { fetchHyperliquidPrices, type HyperliquidPrice } from './fetchers/hyperliquid.js'
import { fetchBinanceCexPrices } from './fetchers/binanceCex.js'
import type { DexQuote } from './fetchers/oneinch.js'
import {
  buildAssetGraph,
  getAssetGraph,
  updateMarketPrice,
  updateInstrumentPrice,
  updateInstrumentSupply,
  updateInstrumentPool,
  recalcBestOptions,
  scoreAllInstruments,
  probeAllLiquidity,
} from './assets/index.js'
import { ISSUERS, getTradeUrl } from './assets/issuers.js'

// 偏离 oracle 超过此比例的报价视为不可信
const MAX_DEVIATION_PCT = 10

// Hyperliquid 永续合约价格（内存缓存，每 30s 刷新）
let _latestHyperliquidPrices: HyperliquidPrice[] = []
export function getLatestHyperliquidPrices(): HyperliquidPrice[] {
  return _latestHyperliquidPrices
}

// 给慢速 fetcher 加保险：超时后返回空数组，不阻塞整个周期
function withFallback<T>(p: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  const timer = new Promise<T>(resolve => setTimeout(() => {
    console.warn(`[Aggregator] ${label} timed out after ${ms}ms, using fallback`)
    resolve(fallback)
  }, ms))
  return Promise.race([p, timer])
}

export async function runFetchCycle() {
  console.log(`\n[Aggregator] Starting fetch cycle at ${new Date().toISOString()}`)

  const [oraclePrices, evmQuotes, solanaQuotes, robinhoodQuotes, uniswapQuotes, pancakeQuotes, hlPrices, binanceCexQuotes] = await Promise.all([
    fetchAllStockPrices(),
    fetchAllEvmQuotes(),
    fetchAllSolanaQuotes(),
    fetchAllRobinhoodQuotes(),
    withFallback(fetchAllUniswapV3Quotes(), 20_000, [], 'UniV3'),
    withFallback(fetchAllPancakeV3Quotes(), 15_000, [], 'PCSv3'),
    fetchHyperliquidPrices(),
    fetchBinanceCexPrices(),
  ])

  // 存储 Hyperliquid 价格供 API 使用
  _latestHyperliquidPrices = hlPrices

  const allQuotes = [...evmQuotes, ...solanaQuotes, ...robinhoodQuotes, ...uniswapQuotes, ...pancakeQuotes, ...binanceCexQuotes]
  console.log(`[Aggregator] Got ${allQuotes.length} DEX quotes (KyberSwap: ${evmQuotes.length}, UniV3: ${uniswapQuotes.length}, PCSv3: ${pancakeQuotes.length}, Sol: ${solanaQuotes.length}, RH: ${robinhoodQuotes.length}, BinCEX: ${binanceCexQuotes.length}), ${oraclePrices.size} oracle, ${hlPrices.length} HL perps`)

  // 过滤垃圾报价
  const { valid, junk } = filterQuotes(allQuotes, oraclePrices)
  if (junk.length > 0) {
    console.log(`[Aggregator] Filtered out ${junk.length} junk quotes:`)
    junk.forEach(j => console.log(`  ⚠ ${j.tokenSymbol} on ${j.chain}: $${j.dexPrice.toFixed(2)} (${j.reason})`))
  }

  await saveOracleSnapshots(oraclePrices)

  if (valid.length > 0) {
    await saveSnapshots(valid, oraclePrices)
  }

  // 套利检测只用 valid 报价
  await detectArbitrageOpportunities(valid, oraclePrices)

  // 定期清理旧数据（只保留 7 天）
  await pruneOldData()

  // ─── 同步 Asset Graph ───
  syncAssetGraph(valid, oraclePrices)

  console.log(`[Aggregator] Cycle complete — ${valid.length} valid, ${junk.length} filtered`)
}

// 每 N 个周期探测一次流动性（不必每 30s 都查）
let cycleCount = 0
const LIQUIDITY_PROBE_INTERVAL = 10 // 每 10 个周期（~5 分钟）探测一次

function syncAssetGraph(validQuotes: DexQuote[], oraclePrices: Map<string, number>) {
  const graph = getAssetGraph()
  if (graph.size === 0) return // 还没初始化

  // 1. 更新市场参考价
  for (const [ticker, price] of oraclePrices) {
    updateMarketPrice(ticker, price, null)
  }

  // 2. 更新每个 instrument 的价格
  //    从 valid quotes 中找到每个 instrument 对应的最新报价
  for (const q of validQuotes) {
    const instrumentId = `${q.issuer}-${q.ticker.toLowerCase()}-${q.chain}`
    const oraclePrice = oraclePrices.get(q.ticker)
    const premiumPct = oraclePrice
      ? ((q.dexPrice - oraclePrice) / oraclePrice) * 100
      : null
    updateInstrumentPrice(instrumentId, q.dexPrice, premiumPct ?? 0, q.source)
  }

  // 3. Robinhood: dailyTradingVolume（存为 liquidityUsd）→ pool.volume24hUsd
  for (const q of validQuotes) {
    if (q.issuer === 'robinhood' && q.liquidityUsd && q.liquidityUsd > 0) {
      const instrumentId = `${q.issuer}-${q.ticker.toLowerCase()}-${q.chain}`
      updateInstrumentPool(instrumentId, {
        poolAddress: 'robinhood-platform',
        feeTier: 0,
        tvlUsd: 0,
        volume24hUsd: q.liquidityUsd,
        fees24hUsd: 0,
      })
    }
  }

  // 4. 计算评分
  for (const asset of graph.values()) {
    scoreAllInstruments(asset.instruments, asset.marketPrice)
    recalcBestOptions(asset.ticker)
  }

  // 4. 定期探测流动性 & 供应量（第1次立即跑，之后每 10 个周期 ≈ 5 分钟）
  cycleCount++
  if (cycleCount === 1 || cycleCount % LIQUIDITY_PROBE_INTERVAL === 0) {
    probeAllLiquidity(oraclePrices).catch(err =>
      console.error('[liquidity] Probe failed:', err.message)
    )
    // 同步更新供应量
    fetchAllSupplies().then(supplies => {
      for (const s of supplies) {
        const instrumentId = `${s.issuer}-${s.ticker.toLowerCase()}-${s.chain}`
        const marketPrice = oraclePrices.get(s.ticker) ?? null
        updateInstrumentSupply(instrumentId, s.totalSupply, marketPrice)
      }
    }).catch(err =>
      console.error('[supply] Fetch failed:', err.message)
    )

    // 同步更新 LP 池子数据
    fetchAllPoolInfo().then(pools => {
      for (const p of pools) {
        const instrumentId = `${p.issuer}-${p.ticker.toLowerCase()}-${p.chain}`
        updateInstrumentPool(instrumentId, {
          poolAddress: p.poolAddress,
          feeTier: p.feeTier,
          tvlUsd: p.tvlUsd,
          volume24hUsd: p.volume24hUsd,
          fees24hUsd: p.fees24hUsd,
        })
      }
    }).catch(err =>
      console.error('[lpPools] Fetch failed:', err.message)
    )
  }
}

// ─── 垃圾报价过滤 ───

interface JunkQuote extends DexQuote {
  reason: string
}

function filterQuotes(
  quotes: DexQuote[],
  oraclePrices: Map<string, number>
): { valid: DexQuote[]; junk: JunkQuote[] } {
  const valid: DexQuote[] = []
  const junk: JunkQuote[] = []

  for (const q of quotes) {
    const oracle = oraclePrices.get(q.ticker)

    // 1. 价格 <= 0 直接丢弃
    if (q.dexPrice <= 0) {
      junk.push({ ...q, reason: 'price <= 0' })
      continue
    }

    // 2. 有 oracle 价格时，检查偏离幅度
    if (oracle && oracle > 0) {
      const deviation = Math.abs((q.dexPrice - oracle) / oracle) * 100
      if (deviation > MAX_DEVIATION_PCT) {
        junk.push({ ...q, reason: `${deviation.toFixed(1)}% off oracle ($${oracle.toFixed(2)})` })
        continue
      }
    }

    // 3. 价格过低（低于 $1），对于股票来说不合理
    if (q.dexPrice < 1) {
      junk.push({ ...q, reason: `price $${q.dexPrice.toFixed(4)} too low for stock` })
      continue
    }

    valid.push(q)
  }

  // 4. 同 ticker 多条报价之间交叉验证
  //    如果没有 oracle 价格，用中位数做基准，偏离中位数超过 MAX_DEVIATION_PCT 的也丢弃
  const byTicker = new Map<string, DexQuote[]>()
  for (const q of valid) {
    const list = byTicker.get(q.ticker) ?? []
    list.push(q)
    byTicker.set(q.ticker, list)
  }

  const finalValid: DexQuote[] = []
  for (const [ticker, group] of byTicker) {
    if (group.length <= 1 || oraclePrices.has(ticker)) {
      finalValid.push(...group)
      continue
    }
    // 没有 oracle 时，用中位数做基准
    const sorted = [...group].sort((a, b) => a.dexPrice - b.dexPrice)
    const median = sorted[Math.floor(sorted.length / 2)].dexPrice
    for (const q of group) {
      const dev = Math.abs((q.dexPrice - median) / median) * 100
      if (dev > MAX_DEVIATION_PCT) {
        junk.push({ ...q, reason: `${dev.toFixed(1)}% off median ($${median.toFixed(2)})` })
      } else {
        finalValid.push(q)
      }
    }
  }

  return { valid: finalValid, junk }
}

// ─── 存储 ───

async function saveSnapshots(
  quotes: DexQuote[],
  oraclePrices: Map<string, number>
) {
  const snapshots = quotes.map(q => {
    const oraclePrice = oraclePrices.get(q.ticker) ?? null
    const premiumPct = oraclePrice
      ? ((q.dexPrice - oraclePrice) / oraclePrice) * 100
      : null

    return {
      ticker: q.ticker,
      issuer: q.issuer,
      chain: q.chain,
      tokenSymbol: q.tokenSymbol,
      contractAddress: q.contractAddress || null,
      dexPrice: q.dexPrice,
      oraclePrice,
      premiumPct,
      liquidityUsd: q.liquidityUsd ?? null,
      source: q.source,
    }
  })

  await prisma.priceSnapshot.createMany({ data: snapshots })
  console.log(`[Aggregator] Saved ${snapshots.length} snapshots`)
}

async function saveOracleSnapshots(oraclePrices: Map<string, number>) {
  if (oraclePrices.size === 0) return
  const snapshots = Array.from(oraclePrices.entries()).map(([ticker, price]) => ({
    ticker,
    issuer: 'yahoo',
    chain: 'nasdaq',
    tokenSymbol: ticker,
    contractAddress: null,
    dexPrice: price,
    oraclePrice: price,
    premiumPct: 0,
    liquidityUsd: null,
    source: 'yahoo-finance',
  }))
  await prisma.priceSnapshot.createMany({ data: snapshots })
  console.log(`[Aggregator] Saved ${snapshots.length} oracle snapshots`)
}

// ─── 套利检测 ───

// 有桥连接的 issuer 组合 — 只有这些才能跨链套利
// Ondo: ETH ↔ BNB（LayerZero V2）
// 各 issuer 支持的 OFT 跨链链对白名单
// 只有在白名单内的链对才能真正执行跨链套利
const OFT_SUPPORTED_CHAINS: Record<string, Set<string>> = {
  // Ondo: ETH ↔ BNB ↔ HyperEVM (LayerZero OFT V2)
  ondo:    new Set(['ethereum', 'bnb', 'hyperevm']),
  // Dinari: ETH ↔ ARB ↔ Base ↔ HyperEVM (LayerZero OFT V2)
  dinari:  new Set(['ethereum', 'arbitrum', 'base', 'hyperevm']),
  // Backed: 只在 ETH，无官方跨链
  backed:  new Set(),
  // Robinhood: 只在 Robinhood Chain，无跨链
  robinhood: new Set(),
}

// 同 issuer + 两条链都在白名单内 = 可套利
function canArbitrage(a: DexQuote, b: DexQuote): boolean {
  if (a.issuer !== b.issuer) return false
  const supported = OFT_SUPPORTED_CHAINS[a.issuer]
  if (!supported || supported.size === 0) return false
  return supported.has(a.chain) && supported.has(b.chain)
}

async function detectArbitrageOpportunities(
  quotes: DexQuote[],
  oraclePrices: Map<string, number>
) {
  const opportunities: {
    ticker: string
    type: string
    buyChain: string
    buyIssuer: string
    buyPrice: number
    sellChain: string
    sellIssuer: string
    sellPrice: number
    spreadPct: number
    estimatedProfit: number | null
    isActive: boolean
  }[] = []

  // ── Type B: 同 issuer 不同链 ──────────────────────────────────────────────
  const byTickerIssuer = new Map<string, DexQuote[]>()
  for (const q of quotes) {
    const key = `${q.ticker}:${q.issuer}`
    const list = byTickerIssuer.get(key) ?? []
    list.push(q)
    byTickerIssuer.set(key, list)
  }

  const emittedKeys = new Set<string>() // 防止 Type C 重复

  for (const [key, group] of byTickerIssuer) {
    if (group.length < 2) continue

    const [ticker] = key.split(':')
    const sorted = [...group].sort((a, b) => a.dexPrice - b.dexPrice)
    const cheapest = sorted[0]
    const mostExpensive = sorted[sorted.length - 1]

    if (!canArbitrage(cheapest, mostExpensive)) continue
    if (cheapest.chain === mostExpensive.chain) continue

    const spreadPct = ((mostExpensive.dexPrice - cheapest.dexPrice) / cheapest.dexPrice) * 100

    // 两侧都必须有足够流动性才能实际执行套利
    const minLiquidity = 200_000
    const buyLiqOk = cheapest.liquidityUsd != null && cheapest.liquidityUsd >= minLiquidity
    const sellLiqOk = mostExpensive.liquidityUsd != null && mostExpensive.liquidityUsd >= minLiquidity

    if (spreadPct > 0.3 && buyLiqOk && sellLiqOk) {
      const tradeSize = 1000
      const bridgeFee = tradeSize * 0.001
      const estimatedGas = 15
      const estimatedProfit = tradeSize * (spreadPct / 100) - bridgeFee - estimatedGas

      const dedupKey = `${ticker}:${cheapest.chain}:${cheapest.issuer}:${mostExpensive.chain}:${mostExpensive.issuer}`
      emittedKeys.add(dedupKey)

      opportunities.push({
        ticker,
        type: 'B',
        buyChain: cheapest.chain,
        buyIssuer: cheapest.issuer,
        buyPrice: cheapest.dexPrice,
        sellChain: mostExpensive.chain,
        sellIssuer: mostExpensive.issuer,
        sellPrice: mostExpensive.dexPrice,
        spreadPct,
        estimatedProfit: estimatedProfit > 0 ? estimatedProfit : null,
        isActive: true,
      })

      console.log(
        `[Arb-B] ${ticker}(${cheapest.issuer}): buy ${cheapest.chain} @ $${cheapest.dexPrice.toFixed(2)}` +
        ` → sell ${mostExpensive.chain} @ $${mostExpensive.dexPrice.toFixed(2)}` +
        ` | spread: ${spreadPct.toFixed(2)}%`
      )
    }
  }

  // ── Type C: 跨 issuer（两笔独立 DEX swap，不需要桥） ────────────────────
  const byTicker = new Map<string, DexQuote[]>()
  for (const q of quotes) {
    const list = byTicker.get(q.ticker) ?? []
    list.push(q)
    byTicker.set(q.ticker, list)
  }

  for (const [ticker, group] of byTicker) {
    const issuers = new Set(group.map(q => q.issuer))
    if (issuers.size < 2) continue // 没有跨 issuer

    const sorted = [...group].sort((a, b) => a.dexPrice - b.dexPrice)
    const cheapest = sorted[0]
    const mostExpensive = sorted[sorted.length - 1]

    if (cheapest.issuer === mostExpensive.issuer) continue // 必须是不同 issuer

    const spreadPct = ((mostExpensive.dexPrice - cheapest.dexPrice) / cheapest.dexPrice) * 100

    // Type C 门槛更高：2 笔 DEX swap 各 0.3%，合计 ~0.6%
    if (spreadPct > 0.6) {
      const dedupKey = `${ticker}:${cheapest.chain}:${cheapest.issuer}:${mostExpensive.chain}:${mostExpensive.issuer}`
      if (emittedKeys.has(dedupKey)) continue

      const tradeSize = 1000
      // 成本：买卖各 0.3% DEX fee + 0.1% 滑点 + gas
      const dexCost = tradeSize * 0.006
      const slippage = tradeSize * 0.002
      const estimatedGas = cheapest.chain === mostExpensive.chain ? 10 : 25
      const estimatedProfit = tradeSize * (spreadPct / 100) - dexCost - slippage - estimatedGas

      opportunities.push({
        ticker,
        type: 'C',
        buyChain: cheapest.chain,
        buyIssuer: cheapest.issuer,
        buyPrice: cheapest.dexPrice,
        sellChain: mostExpensive.chain,
        sellIssuer: mostExpensive.issuer,
        sellPrice: mostExpensive.dexPrice,
        spreadPct,
        estimatedProfit: estimatedProfit > 0 ? estimatedProfit : null,
        isActive: true,
      })

      console.log(
        `[Arb-C] ${ticker}: buy ${cheapest.issuer}/${cheapest.chain} @ $${cheapest.dexPrice.toFixed(2)}` +
        ` → sell ${mostExpensive.issuer}/${mostExpensive.chain} @ $${mostExpensive.dexPrice.toFixed(2)}` +
        ` | spread: ${spreadPct.toFixed(2)}%`
      )
    }
  }

  if (opportunities.length > 0) {
    await prisma.arbitrageOpportunity.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })
    await prisma.arbitrageOpportunity.createMany({ data: opportunities })
    console.log(`[Aggregator] Detected ${opportunities.length} arbitrage opportunities (${opportunities.filter(o => o.type === 'B').length} Type B, ${opportunities.filter(o => o.type === 'C').length} Type C)`)
  }
}

// ─── API 查询 ───

export async function getLatestPrices(ticker: string) {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      ticker,
      // 排除 yahoo 基准行，只返回链上报价
      NOT: { issuer: 'yahoo' },
    },
    orderBy: { capturedAt: 'desc' },
    distinct: ['chain', 'issuer'],
    take: 20,
  })

  // oracle 价格单独取
  const oracleRow = await prisma.priceSnapshot.findFirst({
    where: { ticker, issuer: 'yahoo' },
    orderBy: { capturedAt: 'desc' },
  })
  const oraclePrice = oracleRow?.oraclePrice ?? null

  // 过滤掉偏离 oracle 超过 MAX_DEVIATION_PCT 的快照（如 backed 流动性极差时 $99）
  const filtered = oraclePrice
    ? snapshots.filter(s => {
        const dev = Math.abs((s.dexPrice - oraclePrice) / oraclePrice)
        return dev <= MAX_DEVIATION_PCT / 100
      })
    : snapshots

  return {
    ticker,
    oraclePrice,
    sources: filtered.map(s => {
      const issuerMeta = ISSUERS[s.issuer]
      return {
        issuer: s.issuer,
        issuerName: issuerMeta?.name ?? s.issuer,
        chain: s.chain,
        tokenSymbol: s.tokenSymbol,
        contractAddress: s.contractAddress,
        dexPrice: s.dexPrice,
        premiumPct: s.premiumPct,
        liquidityUsd: s.liquidityUsd,
        source: s.source,
        capturedAt: s.capturedAt,
        tradingMethod: issuerMeta?.tradingMethod ?? null,
        tradeUrl: getTradeUrl(s.issuer, s.chain, ticker, s.tokenSymbol, s.contractAddress ?? ''),
      }
    }),
    bestBuy: filtered.length > 0
      ? filtered.reduce((best, s) => !best || s.dexPrice < best.dexPrice ? s : best, null as typeof filtered[0] | null)
      : null,
    bestSell: filtered.length > 0
      ? filtered.reduce((best, s) => !best || s.dexPrice > best.dexPrice ? s : best, null as typeof filtered[0] | null)
      : null,
  }
}

// 按 source 区分的最新价格（展示多 DEX 对比）
export async function getLatestPricesBySource(ticker: string) {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { ticker, NOT: { issuer: 'yahoo' } },
    orderBy: { capturedAt: 'desc' },
    distinct: ['chain', 'issuer', 'source'],
    take: 50,
  })

  const oracleRow = await prisma.priceSnapshot.findFirst({
    where: { ticker, issuer: 'yahoo' },
    orderBy: { capturedAt: 'desc' },
  })
  const oraclePrice = oracleRow?.oraclePrice ?? null

  // 过滤偏离 oracle 过大的
  const filtered = oraclePrice
    ? snapshots.filter(s => {
        const dev = Math.abs((s.dexPrice - oraclePrice) / oraclePrice)
        return dev <= MAX_DEVIATION_PCT / 100
      })
    : snapshots

  return {
    ticker,
    oraclePrice,
    sources: filtered.map(s => {
      const issuerMeta = ISSUERS[s.issuer]
      return {
        issuer: s.issuer,
        issuerName: issuerMeta?.name ?? s.issuer,
        chain: s.chain,
        tokenSymbol: s.tokenSymbol,
        contractAddress: s.contractAddress,
        dexPrice: s.dexPrice,
        premiumPct: s.premiumPct,
        liquidityUsd: s.liquidityUsd,
        source: s.source,
        capturedAt: s.capturedAt,
        tradingMethod: issuerMeta?.tradingMethod ?? null,
        tradeUrl: getTradeUrl(s.issuer, s.chain, ticker, s.tokenSymbol, s.contractAddress ?? ''),
      }
    }),
  }
}

export async function getPriceHistory(ticker: string, hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  return prisma.priceSnapshot.findMany({
    where: {
      ticker,
      capturedAt: { gte: since },
      NOT: { issuer: 'yahoo' },
    },
    orderBy: { capturedAt: 'asc' },
    select: {
      chain: true,
      issuer: true,
      tokenSymbol: true,
      dexPrice: true,
      oraclePrice: true,
      premiumPct: true,
      capturedAt: true,
    },
  })
}

export async function getActiveArbitrage() {
  const opps = await prisma.arbitrageOpportunity.findMany({
    where: { isActive: true },
    orderBy: { spreadPct: 'desc' },
    take: 20,
  })

  // Enrich with liquidity + contract addresses from latest snapshots
  const enriched = await Promise.all(opps.map(async opp => {
    const [buySnap, sellSnap] = await Promise.all([
      prisma.priceSnapshot.findFirst({
        where: { ticker: opp.ticker, chain: opp.buyChain, issuer: opp.buyIssuer },
        orderBy: { capturedAt: 'desc' },
        select: { liquidityUsd: true, contractAddress: true },
      }),
      prisma.priceSnapshot.findFirst({
        where: { ticker: opp.ticker, chain: opp.sellChain, issuer: opp.sellIssuer },
        orderBy: { capturedAt: 'desc' },
        select: { liquidityUsd: true, contractAddress: true },
      }),
    ])
    return {
      ...opp,
      type: opp.type ?? 'B',
      buyLiquidityUsd: buySnap?.liquidityUsd ?? null,
      buyContractAddress: buySnap?.contractAddress ?? null,
      sellLiquidityUsd: sellSnap?.liquidityUsd ?? null,
      sellContractAddress: sellSnap?.contractAddress ?? null,
    }
  }))

  return enriched
}

// ─── 数据清理：只保留 2 天（防止 SQLite 膨胀） ───

async function pruneOldData() {
  try {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const [snapshots, arbs] = await Promise.all([
      prisma.priceSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
      prisma.arbitrageOpportunity.deleteMany({ where: { detectedAt: { lt: cutoff } } }),
    ])
    if (snapshots.count > 0 || arbs.count > 0) {
      console.log(`[Aggregator] Pruned ${snapshots.count} snapshots + ${arbs.count} arb records older than 2d`)
    }
  } catch (err: any) {
    console.error('[Aggregator] Prune failed:', err.message)
  }
}
