import { Router } from 'express'
import {
  getLatestPrices,
  getLatestPricesBySource,
  getPriceHistory,
  getActiveArbitrage,
  getLatestHyperliquidPrices,
} from '../aggregator.js'
import { prisma } from '../db/client.js'
import { getMarketStatus } from '../utils/marketStatus.js'
import {
  getAllAssets,
  getAsset,
  searchAssets,
  getTradeableInstruments,
  getAllInstruments,
} from '../assets/index.js'
import { ISSUERS, getTradeUrl } from '../assets/issuers.js'
import { fetchAllDefiYields, getDefiYieldsByAsset, getDefiYieldsSummary } from '../fetchers/defiYields.js'
import { routeIntent } from '../intent/intentRouter.js'

export const router = Router()

// GET /api/prices/:ticker
// 返回某个股票在所有链上的最新价格
router.get('/prices/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase()
    const data = await getLatestPrices(ticker)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/prices/:ticker/sources
// 返回按 DEX 来源区分的最新价格（多 DEX 对比）
router.get('/prices/:ticker/sources', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase()
    const data = await getLatestPricesBySource(ticker)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/prices/:ticker/history?hours=24
// 返回历史价格（用于图表）
router.get('/prices/:ticker/history', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase()
    const hours = Number(req.query.hours) || 24
    const data = await getPriceHistory(ticker, hours)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/arbitrage
// 返回当前活跃套利机会
router.get('/arbitrage', async (_req, res) => {
  try {
    const data = await getActiveArbitrage()
    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/stocks
// 返回所有支持的股票列表 + 每个的简要溢价状态
router.get('/stocks', async (_req, res) => {
  try {
    // 每个 ticker 取最新一条数据
    const latest = await prisma.priceSnapshot.findMany({
      distinct: ['ticker'],
      orderBy: { capturedAt: 'desc' },
      select: {
        ticker: true,
        oraclePrice: true,
        dexPrice: true,
        premiumPct: true,
        capturedAt: true,
      },
    })

    // 每个 ticker 的最低价和最高价（跨链）+ 24h 涨跌幅
    const tickers = [...new Set(latest.map(l => l.ticker))]
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // 批量查询每个 ticker 24h 前的 oracle 价格
    const oracle24hRows = await prisma.priceSnapshot.findMany({
      where: {
        issuer: 'yahoo',
        ticker: { in: tickers },
        capturedAt: { lte: twentyFourHoursAgo },
      },
      distinct: ['ticker'],
      orderBy: { capturedAt: 'desc' },
      select: { ticker: true, dexPrice: true },
    })
    const oracle24hMap = new Map(oracle24hRows.map(r => [r.ticker, r.dexPrice]))

    const spreads = await Promise.all(
      tickers.map(async ticker => {
        const rows = await prisma.priceSnapshot.findMany({
          where: { ticker, NOT: { issuer: 'yahoo' } },
          distinct: ['chain', 'issuer'],
          orderBy: { capturedAt: 'desc' },
          select: { dexPrice: true, chain: true, issuer: true },
          take: 10,
        })
        const prices = rows.map(r => r.dexPrice)
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
        const crossChainSpreadPct = prices.length > 1
          ? ((maxPrice - minPrice) / minPrice) * 100
          : 0

        // 24h 涨跌幅（基于 oracle 价格）
        const currentOracle = latest.find(l => l.ticker === ticker)?.oraclePrice ?? null
        const oracle24h = oracle24hMap.get(ticker) ?? null
        const change24h = currentOracle && oracle24h && oracle24h > 0
          ? ((currentOracle - oracle24h) / oracle24h) * 100
          : null

        return { ticker, crossChainSpreadPct, sourceCount: rows.length, change24h }
      })
    )

    const spreadMap = new Map(spreads.map(s => [s.ticker, s]))

    const data = latest.map(l => ({
      ...l,
      crossChainSpreadPct: spreadMap.get(l.ticker)?.crossChainSpreadPct ?? 0,
      sourceCount: spreadMap.get(l.ticker)?.sourceCount ?? 1,
      change24h: spreadMap.get(l.ticker)?.change24h ?? null,
    }))

    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/market-status
// 返回美股市场状态 + 各代币偏离分析（基于历史基准，非简单价格比较）
router.get('/market-status', async (_req, res) => {
  try {
    const market = getMarketStatus()

    // 1. 取每个 ticker 最新的 oracle 价格
    const oracleRows = await prisma.priceSnapshot.findMany({
      where: { issuer: 'yahoo' },
      distinct: ['ticker'],
      orderBy: { capturedAt: 'desc' },
      select: { ticker: true, dexPrice: true, capturedAt: true },
    })
    const oracleMap = new Map(oracleRows.map(r => [r.ticker, r]))

    const oracleFreezeHours = oracleRows.length > 0
      ? Math.round((Date.now() - new Date(oracleRows[0].capturedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
      : null

    // 2. 取每个 ticker+chain+issuer 组合的最新快照
    const recentRows = await prisma.priceSnapshot.findMany({
      where: { NOT: { issuer: 'yahoo' } },
      distinct: ['ticker', 'chain', 'issuer'],
      orderBy: { capturedAt: 'desc' },
      select: {
        ticker: true,
        chain: true,
        issuer: true,
        dexPrice: true,
        premiumPct: true,
        liquidityUsd: true,
        contractAddress: true,
        capturedAt: true,
      },
    })

    // 3. 数据质量过滤（按 issuer 不同策略）：
    //    - ondo:      KyberSwap 路由存在 = 可交易，用 premiumPct 排除历史垃圾
    //    - robinhood: REST API 官方价格，完全可信
    //    - backed:    KyberSwap 价格不稳定，要求有流动性数据且 > $10k
    //    - 其他:      要求有流动性且合理
    const liquidRows = recentRows.filter(r => {
      // 已存储的 premiumPct 极端偏离 → 垃圾价，排除
      if (r.premiumPct !== null && Math.abs(r.premiumPct) > 10) return false

      if (r.issuer === 'robinhood') return true
      if (r.issuer === 'binance-cex') return true
      // ondo/backed on BNB: 流动性极差，经常报垃圾价，需要有流动性数据
      if ((r.issuer === 'ondo' || r.issuer === 'backed') && r.chain === 'bnb') {
        return r.liquidityUsd !== null && r.liquidityUsd >= 10_000
      }
      if (r.issuer === 'ondo') return true  // ETH 上 KyberSwap 路由可信
      // backed / dinari / 其他：需要确认流动性
      if (r.liquidityUsd === null || r.liquidityUsd < 10_000) return false
      return true
    })

    // 4. 为每个组合查询7天历史平均偏离，计算 signal
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const deviations = await Promise.all(
      liquidRows.map(async row => {
        const oracle = oracleMap.get(row.ticker)
        if (!oracle || oracle.dexPrice <= 0) return null

        // 当前偏离
        const currentDeviation = ((row.dexPrice - oracle.dexPrice) / oracle.dexPrice) * 100

        // 7天历史平均偏离（同 ticker+chain+issuer）
        const history = await prisma.priceSnapshot.findMany({
          where: {
            ticker: row.ticker,
            chain: row.chain,
            issuer: row.issuer,
            capturedAt: { gte: sevenDaysAgo },
          },
          select: { premiumPct: true },
        })

        const validHistory = history
          .map(h => h.premiumPct)
          .filter((p): p is number => p !== null)

        const historicalAvg = validHistory.length >= 3
          ? validHistory.reduce((a, b) => a + b, 0) / validHistory.length
          : null

        // signal = 当前偏离 vs 历史均值
        // 正 signal = 比平时更贵（异常溢价）
        // 负 signal = 比平时更便宜（异常折扣）
        const signalPct = historicalAvg !== null
          ? currentDeviation - historicalAvg
          : null

        // 展示门槛：偏离 > 2% 且 < 20%（过滤噪音和垃圾价）
        const isVisible = Math.abs(currentDeviation) > 2 && Math.abs(currentDeviation) < 20

        // 是否异常信号：当前偏离显著偏离历史均值（> 2%）
        const isAbnormal = signalPct !== null && Math.abs(signalPct) > 2

        const opportunity = !isVisible
          ? 'neutral'
          : currentDeviation < 0 ? 'discount' : 'premium'

        return {
          ticker: row.ticker,
          dexChain: row.chain,
          dexIssuer: row.issuer,
          contractAddress: row.contractAddress,
          lastOraclePrice: oracle.dexPrice,
          bestDexPrice: row.dexPrice,
          liquidityUsd: row.liquidityUsd,
          // 当前偏离（vs oracle）
          deviationPct: Math.round(currentDeviation * 100) / 100,
          // 7天历史均值偏离
          historicalAvgPct: historicalAvg !== null
            ? Math.round(historicalAvg * 100) / 100
            : null,
          // 异常信号强度（当前 - 历史均值）
          signalPct: signalPct !== null
            ? Math.round(signalPct * 100) / 100
            : null,
          // 历史数据点数量（用于判断可信度）
          historySamples: validHistory.length,
          // 是否异常（超出历史基准）
          isAbnormal,
          opportunity,
        }
      })
    )

    const result = deviations
      .filter(Boolean)
      .filter(d => d!.opportunity !== 'neutral')
      // 按 signal 强度排序，无历史数据的按偏离排序
      .sort((a, b) => {
        const sa = Math.abs(a!.signalPct ?? a!.deviationPct)
        const sb = Math.abs(b!.signalPct ?? b!.deviationPct)
        return sb - sa
      })

    res.json({
      ok: true,
      data: {
        market,
        oracleFreezeHours,
        deviations: result,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// ─── Asset Graph API（新） ───

// GET /api/assets/instruments
// 返回所有 instruments 的扁平列表，用于 Portfolio 余额查询（避免 N+1）
router.get('/assets/instruments', (_req, res) => {
  try {
    const instruments = getAllInstruments()
      .filter(i => i.contractAddress && i.chainId !== 0)
      .map(i => ({
        id: i.id,
        issuer: i.issuer,
        issuerName: ISSUERS[i.issuer]?.name ?? i.issuer,
        chain: i.chain,
        chainId: i.chainId,
        tokenSymbol: i.tokenSymbol,
        contractAddress: i.contractAddress,
        decimals: i.decimals,
        price: i.price,
        premiumPct: i.premiumPct,
        liquidity: i.liquidity,
        score: i.score,
        assetTicker: i.assetTicker,
        assetName: i.assetName,
        marketPrice: i.marketPrice,
      }))
    res.json({ ok: true, data: instruments })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/assets/search?q=apple
// 搜索 canonical assets（ticker 或名称）— 必须在 /assets/:ticker 之前
router.get('/assets/search', (req, res) => {
  try {
    const q = String(req.query.q || '')
    if (!q) {
      res.json({ ok: true, data: [] })
      return
    }
    const results = searchAssets(q).map(a => ({
      ticker: a.ticker,
      name: a.name,
      sector: a.sector,
      type: a.type,
      marketPrice: a.marketPrice,
      tradeableCount: a.instruments.filter(i =>
        i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity'
      ).length,
    }))
    res.json({ ok: true, data: results })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/assets
// 返回所有 canonical assets + instruments（包含 score, liquidity status）
router.get('/assets', (_req, res) => {
  try {
    const assets = getAllAssets().map(a => ({
      ticker: a.ticker,
      name: a.name,
      sector: a.sector,
      type: a.type,
      marketPrice: a.marketPrice,
      change24h: a.change24h,
      instrumentCount: a.instruments.length,
      tradeableCount: a.instruments.filter(i =>
        i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity'
      ).length,
      bestBuy: a.bestBuy ? {
        price: a.bestBuy.price,
        premiumPct: a.bestBuy.premiumPct,
        issuer: a.bestBuy.issuer,
        chain: a.bestBuy.chain,
        score: a.bestBuy.score,
      } : null,
      bestScore: a.bestScore ? {
        price: a.bestScore.price,
        premiumPct: a.bestScore.premiumPct,
        issuer: a.bestScore.issuer,
        chain: a.bestScore.chain,
        score: a.bestScore.score,
      } : null,
    }))
    res.json({ ok: true, data: assets })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/assets/:ticker
// 返回单个 canonical asset 的完整数据（所有 instruments + 评分 + 流动性）
router.get('/assets/:ticker', (req, res) => {
  try {
    const asset = getAsset(req.params.ticker)
    if (!asset) {
      res.status(404).json({ ok: false, error: 'Asset not found' })
      return
    }
    res.json({
      ok: true,
      data: {
        ticker: asset.ticker,
        name: asset.name,
        sector: asset.sector,
        type: asset.type,
        marketPrice: asset.marketPrice,
        change24h: asset.change24h,
        instruments: asset.instruments.map(i => {
          const issuerMeta = ISSUERS[i.issuer]
          return {
            id: i.id,
            issuer: i.issuer,
            issuerName: issuerMeta?.name ?? i.issuer,
            chain: i.chain,
            chainId: i.chainId,
            tokenSymbol: i.tokenSymbol,
            contractAddress: i.contractAddress,
            decimals: i.decimals,
            price: i.price,
            premiumPct: i.premiumPct,
            source: i.source,
            liquidity: i.liquidity,
            score: i.score,
            totalSupply: i.totalSupply,
            aumUsd: i.aumUsd,
            pool: i.pool,
            issuerInfo: issuerMeta ?? null,
            tradingMethod: issuerMeta?.tradingMethod ?? null,
            tradingDesc: issuerMeta?.tradingDesc ?? null,
            tradeUrl: getTradeUrl(i.issuer, i.chain, asset.ticker, i.tokenSymbol, i.contractAddress),
          }
        }),
        bestBuy: asset.bestBuy?.id ?? null,
        bestScore: asset.bestScore?.id ?? null,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/market/stats
// 首页数据大屏专用：全市场聚合指标 + 溢价热力图 + 信号
router.get('/market/stats', (_req, res) => {
  try {
    const assets = getAllAssets()

    // ── 1. 溢价热力图：每只股票 × 每个 issuer ──
    // backed 拆分为 backed-eth 和 backed-sol 两列
    type CellDef = { issuer: string; filter: (i: { issuer: string; chain: string }) => boolean; tradingModel?: string }
    const ISSUERS_ORDER: CellDef[] = [
      { issuer: 'ondo',        filter: i => i.issuer === 'ondo' },
      { issuer: 'backed-eth',  filter: i => i.issuer === 'backed' && i.chain !== 'solana' },
      { issuer: 'backed-sol',  filter: i => i.issuer === 'backed' && i.chain === 'solana' },
      { issuer: 'binance',     filter: i => i.issuer === 'binance' },
      { issuer: 'dinari',      filter: i => i.issuer === 'dinari', tradingModel: 'orderbook' },
      { issuer: 'robinhood',   filter: i => i.issuer === 'robinhood' },
    ]
    const heatmap = assets
      .filter(a => a.marketPrice != null)
      .map(a => {
        const cells = ISSUERS_ORDER.map(def => {
          const insts = a.instruments.filter(def.filter)

          if (insts.length === 0) return { issuer: def.issuer, premiumPct: null, chain: null, note: null }

          // Order book issuers (Dinari): no DEX price, show oracle-peg (0%)
          if (def.tradingModel === 'orderbook') {
            const chains = insts.map(i => i.chain).join('/')
            const hasSupply = insts.some(i => i.totalSupply && i.totalSupply > 0)
            if (!hasSupply) return { issuer: def.issuer, premiumPct: null, chain: chains, note: 'orderbook' }
            return { issuer: def.issuer, premiumPct: 0, chain: chains, note: 'orderbook' }
          }

          // DEX issuers: find best (lowest abs premium) priced instrument
          const priced = insts.filter(i => i.premiumPct != null && i.price != null)
          if (priced.length === 0) return { issuer: def.issuer, premiumPct: null, chain: null, note: null }
          const best = priced.reduce((a, b) =>
            Math.abs(a.premiumPct!) < Math.abs(b.premiumPct!) ? a : b
          )
          return { issuer: def.issuer, premiumPct: best.premiumPct, chain: best.chain, note: null }
        })
        return {
          ticker: a.ticker,
          name: a.name,
          marketPrice: a.marketPrice,
          change24h: a.change24h ?? null,
          cells,
        }
      })

    // ── 2. 市场信号：折价 Top5 / 溢价 Top5 ──
    const allCells: { ticker: string; issuer: string; chain: string; premiumPct: number; marketPrice: number }[] = []
    for (const a of assets) {
      if (!a.marketPrice) continue
      for (const inst of a.instruments) {
        if (inst.premiumPct == null || inst.price == null) continue
        if (inst.liquidity.status !== 'tradeable' && inst.liquidity.status !== 'low_liquidity') continue
        allCells.push({
          ticker: a.ticker,
          issuer: inst.issuer,
          chain: inst.chain,
          premiumPct: inst.premiumPct,
          marketPrice: a.marketPrice,
        })
      }
    }

    const discounts = allCells
      .filter(c => c.premiumPct < -0.1)
      .sort((a, b) => a.premiumPct - b.premiumPct)
      .slice(0, 5)

    const premiums = allCells
      .filter(c => c.premiumPct > 0.1)
      .sort((a, b) => b.premiumPct - a.premiumPct)
      .slice(0, 5)

    // ── 3. 全市场聚合指标 ──
    let totalAumUsd = 0
    let premiumSum = 0; let premiumCount = 0
    const activeChains = new Set<string>()
    let tradeableCount = 0

    for (const a of assets) {
      for (const inst of a.instruments) {
        if (inst.aumUsd) totalAumUsd += inst.aumUsd
        if (inst.premiumPct != null) { premiumSum += inst.premiumPct; premiumCount++ }
        if (inst.liquidity.status === 'tradeable') {
          tradeableCount++
          activeChains.add(inst.chain)
        }
        // orderbook issuers: count chain if has supply
        if (ISSUERS[inst.issuer]?.tradingModel === 'orderbook' && inst.totalSupply && inst.totalSupply > 0) {
          activeChains.add(inst.chain)
        }
      }
    }

    const avgPremiumPct = premiumCount > 0 ? premiumSum / premiumCount : null

    res.json({
      ok: true,
      data: {
        summary: {
          totalAumUsd,
          avgPremiumPct,
          tradeableRoutes: tradeableCount,
          activeChains: Array.from(activeChains),
          assetCount: assets.length,
        },
        heatmap,
        signals: { discounts, premiums },
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/market/overview
// 每个股票 × 每个 issuer 的 AUM、供应量、溢价、市占率
// 这是首页"核心数据面板"的数据源
router.get('/market/overview', async (_req, res) => {
  try {
    const assets = getAllAssets()

    // 7天前窗口：用于计算溢价趋势
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const sixDaysAgo   = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)

    // 每个 issuer 7天前的平均溢价（用于计算趋势方向）
    const oldPremiums = await prisma.priceSnapshot.groupBy({
      by: ['issuer'],
      where: {
        capturedAt: { gte: sevenDaysAgo, lte: sixDaysAgo },
        premiumPct: { not: null },
        NOT: { issuer: 'yahoo' },
      },
      _avg: { premiumPct: true },
    })
    const oldPremiumMap = new Map(oldPremiums.map(r => [r.issuer, r._avg.premiumPct]))

    const data = assets
      .map(a => {
        // 只取有供应量数据的 instruments（EVM 链）
        const withSupply = a.instruments.filter(i => i.totalSupply != null && i.totalSupply > 0)

        // 按 issuer 聚合：同一 issuer 可能有多条链，AUM 相加
        const issuerMap = new Map<string, {
          issuer: string
          issuerName: string
          totalSupplyTokens: number
          aumUsd: number
          tvlUsd: number
          volume24hUsd: number
          premiumPct: number | null
          chains: string[]
          status: string
        }>()

        for (const inst of a.instruments) {
          const key = inst.issuer
          if (!issuerMap.has(key)) {
            issuerMap.set(key, {
              issuer: inst.issuer,
              issuerName: ISSUERS[inst.issuer]?.name ?? inst.issuer,
              totalSupplyTokens: 0,
              aumUsd: 0,
              tvlUsd: 0,
              volume24hUsd: 0,
              premiumPct: inst.premiumPct,
              chains: [],
              status: inst.liquidity.status,
            })
          }
          const entry = issuerMap.get(key)!
          if (inst.totalSupply != null) {
            entry.totalSupplyTokens += inst.totalSupply
            entry.aumUsd += inst.aumUsd ?? 0
          }
          if (inst.pool) {
            entry.tvlUsd += inst.pool.tvlUsd
            entry.volume24hUsd += inst.pool.volume24hUsd
          }
          if (!entry.chains.includes(inst.chain)) entry.chains.push(inst.chain)
          // 取最好状态
          if (inst.liquidity.status === 'tradeable') entry.status = 'tradeable'
          // 取溢价：优先用有价格的
          if (inst.premiumPct != null && entry.premiumPct == null) {
            entry.premiumPct = inst.premiumPct
          }
        }

        const issuers = Array.from(issuerMap.values())
        const totalAum = issuers.reduce((sum, e) => sum + e.aumUsd, 0)

        // 计算市占率 + 7天溢价趋势
        const issuersWithShare = issuers
          .map(e => {
            const oldPrem = oldPremiumMap.get(e.issuer) ?? null
            const trendDelta = (e.premiumPct != null && oldPrem != null)
              ? e.premiumPct - oldPrem
              : null
            const trendDirection = trendDelta == null ? null
              : trendDelta > 0.1 ? 'up'
              : trendDelta < -0.1 ? 'down'
              : 'flat'
            return {
              ...e,
              marketSharePct: totalAum > 0 ? (e.aumUsd / totalAum) * 100 : 0,
              premiumTrend7d: trendDelta != null ? {
                direction: trendDirection,
                delta: Math.round(trendDelta * 100) / 100,
              } : null,
            }
          })
          .sort((a, b) => b.aumUsd - a.aumUsd)

        return {
          ticker: a.ticker,
          name: a.name,
          sector: a.sector,
          type: a.type,
          marketPrice: a.marketPrice,
          change24h: a.change24h,
          totalAumUsd: totalAum,
          issuers: issuersWithShare,
        }
      })
      // 按总 AUM 排序，AUM=0 的排最后
      .sort((a, b) => b.totalAumUsd - a.totalAumUsd)

    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/market/divergence
// 价格发散监控：oracle 冻结价 vs 各平台实时价 vs Hyperliquid 永续合约价
router.get('/market/divergence', (_req, res) => {
  try {
    const market = getMarketStatus()
    const assets = getAllAssets()
    const hlPrices = getLatestHyperliquidPrices()
    const hlMap = new Map(hlPrices.map(p => [p.ticker, p.perpPrice]))

    const stocks = assets
      .filter(a => a.marketPrice != null)
      .map(a => {
        const oraclePrice = a.marketPrice!

        // 各平台实时价（来自 asset graph instruments）
        const platforms: Array<{
          issuer: string
          issuerName: string
          chain: string
          type: 'spot'
          price: number
          vsOraclePct: number
          liquidityStatus: string
          tradingMethod: string | null
          tradeUrl: string | null
        }> = []

        for (const inst of a.instruments) {
          if (inst.price == null || inst.price <= 0) continue
          const issuerMeta = ISSUERS[inst.issuer]
          platforms.push({
            issuer: inst.issuer,
            issuerName: issuerMeta?.name ?? inst.issuer,
            chain: inst.chain,
            type: 'spot',
            price: inst.price,
            vsOraclePct: ((inst.price - oraclePrice) / oraclePrice) * 100,
            liquidityStatus: inst.liquidity.status,
            tradingMethod: issuerMeta?.tradingMethod ?? null,
            tradeUrl: getTradeUrl(inst.issuer, inst.chain, a.ticker, inst.tokenSymbol, inst.contractAddress),
          })
        }

        // Hyperliquid 永续合约
        const hlPrice = hlMap.get(a.ticker)
        const hlEntry = hlPrice ? {
          issuer: 'hyperliquid',
          issuerName: 'Hyperliquid Perp',
          chain: 'hyperliquid',
          type: 'perp' as const,
          price: hlPrice,
          vsOraclePct: ((hlPrice - oraclePrice) / oraclePrice) * 100,
          liquidityStatus: 'tradeable',
          tradingMethod: ISSUERS['hyperliquid']?.tradingMethod ?? '永续合约做多/做空',
          tradeUrl: `https://app.hyperliquid.xyz/trade/${a.ticker}`,
        } : null

        const allPrices = [...platforms, ...(hlEntry ? [hlEntry] : [])]
        if (allPrices.length === 0) return null

        const prices = allPrices.map(p => p.price)
        const minPrice = Math.min(...prices)
        const maxPrice = Math.max(...prices)
        const maxSpreadPct = minPrice > 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0

        const cheapest = allPrices.reduce((a, b) => a.price < b.price ? a : b)
        const mostExpensive = allPrices.reduce((a, b) => a.price > b.price ? a : b)

        return {
          ticker: a.ticker,
          name: a.name,
          oraclePrice,
          platforms: allPrices.sort((a, b) => a.price - b.price),
          maxSpreadPct: Math.round(maxSpreadPct * 100) / 100,
          cheapest: { issuer: cheapest.issuer, chain: cheapest.chain, price: cheapest.price },
          mostExpensive: { issuer: mostExpensive.issuer, chain: mostExpensive.chain, price: mostExpensive.price },
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.maxSpreadPct - a!.maxSpreadPct)

    res.json({
      ok: true,
      data: {
        market,
        hyperliquidCount: hlPrices.length,
        stocks,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// ─── DeFi 收益聚合 ───────────────────────────────────────────

// GET /api/earn
// 所有 xStocks 在所有 DeFi 协议的收益率
router.get('/earn', async (_req, res) => {
  try {
    const yields = await fetchAllDefiYields()
    const summary = getDefiYieldsSummary()
    res.json({ ok: true, data: { yields, summary } })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/earn/:ticker
// 某个股票在所有 DeFi 协议的收益率对比
router.get('/earn/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase()
    // 确保缓存有数据
    await fetchAllDefiYields()
    const yields = getDefiYieldsByAsset(ticker)
    // 按收益率排序
    yields.sort((a, b) => b.netApy - a.netApy)
    res.json({ ok: true, data: { ticker, yields } })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/earn/kamino/build-supply
// 服务端构建 Kamino 存款交易（序列化后返回前端签名）
// body: { asset: 'TSLAx', amount: 1.5, walletAddress: 'xxx' }
router.post('/earn/kamino/build-supply', async (req, res) => {
  try {
    const { asset, amount, walletAddress } = req.body as {
      asset: string; amount: number; walletAddress: string
    }
    if (!asset || !amount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amount, or walletAddress' })
    }

    const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } = await import('@kamino-finance/klend-sdk')
    const { createSolanaRpc, address, createNoopSigner } = await import('@solana/kit')
    const { Connection, PublicKey, Transaction } = await import('@solana/web3.js')

    const KAMINO_XSTOCKS_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'
    const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
    const XSTOCK_MINTS: Record<string, string> = {
      TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
      NVDAx:  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      SPYx:   'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      QQQx:   'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
      AAPLx:  'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
      GOOGLx: 'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
      METAx:  'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
      COINx:  'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
      MSTRx:  'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
      CRCLx:  'XsCUZ6KU4QMcp6aHMNwHWcJu2rcaJNm6Hp8ZW5Xn6TM',
    }

    const mint = XSTOCK_MINTS[asset]
    if (!mint) return res.status(400).json({ ok: false, error: `Unknown asset: ${asset}` })

    // Use @solana/kit Rpc (required by Kamino v9+)
    const rpc = createSolanaRpc(SOLANA_RPC)
    const marketAddr = address(KAMINO_XSTOCKS_MARKET)
    const walletAddr = address(walletAddress)
    const ownerSigner = createNoopSigner(walletAddr)

    const market = await KaminoMarket.load(rpc, marketAddr, 0, PROGRAM_ID, true)
    if (!market) return res.status(404).json({ ok: false, error: 'Kamino market not found' })

    // Find the reserve for this asset
    let reserve = null
    let reserveAddr = null
    for (const [addr, r] of market.reserves) {
      if (String(r.getLiquidityMint()) === mint) {
        reserve = r
        reserveAddr = addr
        break
      }
    }
    if (!reserve || !reserveAddr) return res.status(404).json({ ok: false, error: `No Kamino reserve for ${asset}` })

    const decimals = Number(reserve.state.liquidity.mintDecimals)
    const amountStr = String(Math.floor(amount * Math.pow(10, decimals)))

    // Get current slot for the action
    const currentSlotResp = await rpc.getSlot().send()
    const currentSlot = currentSlotResp

    const kaminoAction = await KaminoAction.buildDepositTxns({
      kaminoMarket: market,
      amount: amountStr,
      reserveAddress: address(reserveAddr),
      owner: ownerSigner,
      obligation: new VanillaObligation(PROGRAM_ID),
      useV2Ixs: false,
      scopeRefreshConfig: undefined,
      currentSlot,
    })

    // Use legacy @solana/web3.js Transaction for serialization (wallet adapter needs it)
    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    const walletPk = new PublicKey(walletAddress)

    const tx = new Transaction()
    // Convert kit instructions to web3.js TransactionInstruction
    const toWeb3Ix = (ix: any) => {
      const { TransactionInstruction, PublicKey: PK } = require('@solana/web3.js')
      return new TransactionInstruction({
        programId: new PK(ix.programAddress),
        keys: ix.accounts.map((a: any) => ({
          pubkey: new PK(a.address),
          isSigner: a.role >= 2,
          isWritable: a.role === 1 || a.role === 3,
        })),
        data: Buffer.from(ix.data ?? []),
      })
    }

    const allIxs = [...(kaminoAction.setupIxs ?? []), ...(kaminoAction.lendingIxs ?? []), ...(kaminoAction.cleanupIxs ?? [])]
    for (const ix of allIxs) {
      tx.add(toWeb3Ix(ix))
    }
    tx.recentBlockhash = blockhash
    tx.feePayer = walletPk

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64')

    res.json({
      ok: true,
      data: {
        transaction: serialized,
        blockhash,
        lastValidBlockHeight,
        asset,
        amount,
      }
    })
  } catch (err: any) {
    console.error('[Kamino build-supply]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Devnet Mock Swap ────────────────────────────────────────────────────────
// POST /api/devnet/mint-xstock-batch
// Devnet simulation: server mints xStock directly to user for each position.
// Replaces the USDC→xStock swap (which requires Jupiter, not available on devnet).
// body: { positions: [{asset, amountUsd}], walletAddress }
router.post('/devnet/mint-xstock-batch', async (req, res) => {
  const SOLANA_RPC = process.env.SOLANA_RPC || ''
  const isDevnet = SOLANA_RPC.includes('devnet') || SOLANA_RPC.includes('localhost') || SOLANA_RPC.includes('127.0.0.1')
  if (!isDevnet) {
    return res.status(403).json({ ok: false, error: 'Only available on devnet' })
  }

  try {
    const { positions, walletAddress } = req.body as {
      positions: { asset: string; amountUsd: number }[]
      walletAddress: string
    }
    if (!positions?.length || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing positions or walletAddress' })
    }

    const { Connection, PublicKey, Transaction, Keypair } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
      createMintToInstruction, getAccount,
    } = require('@solana/spl-token')
    const fs = require('fs')

    const XSTOCK_MINTS: Record<string, string> = {
      TSLA: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDA: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPY:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPL: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGL:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      META: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COIN: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTR: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const userPk = new PublicKey(walletAddress)
    const keypairPath = process.env.MINT_AUTHORITY_KEYPAIR
      || `${process.env.HOME}/.config/solana/deploy-keypair.json`
    const mintAuthority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
    )

    const { prisma } = await import('../db/client.js')
    const results: { asset: string; amountUsd: number; xstockAmount: number; mintSig: string }[] = []

    for (const pos of positions) {
      const ticker = pos.asset.toUpperCase()
      const mintStr = XSTOCK_MINTS[ticker]
      if (!mintStr) continue

      const oracleRow = await prisma.priceSnapshot.findFirst({
        where: { ticker, issuer: 'yahoo' }, orderBy: { capturedAt: 'desc' },
      })
      const oraclePrice = oracleRow?.oraclePrice ?? 300
      const xstockAmountRaw = Math.floor((pos.amountUsd / oraclePrice) * 10 ** 6)

      const mintPk = new PublicKey(mintStr)
      const userAta = getAssociatedTokenAddressSync(mintPk, userPk)

      const tx = new Transaction()
      tx.feePayer = mintAuthority.publicKey
      try { await getAccount(connection, userAta, 'confirmed', TOKEN_PROGRAM_ID) }
      catch {
        tx.add(createAssociatedTokenAccountInstruction(
          mintAuthority.publicKey, userAta, userPk, mintPk,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        ))
      }
      tx.add(createMintToInstruction(mintPk, userAta, mintAuthority.publicKey, xstockAmountRaw, [], TOKEN_PROGRAM_ID))
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.sign(mintAuthority)

      const mintSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 })
      // Poll for confirmation
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const st = await connection.getSignatureStatus(mintSig)
        const c = st?.value?.confirmationStatus
        if (c === 'confirmed' || c === 'finalized') break
        if (st?.value?.err) throw new Error(`Mint failed for ${ticker}: ${JSON.stringify(st.value.err)}`)
      }
      results.push({ asset: ticker, amountUsd: pos.amountUsd, xstockAmount: xstockAmountRaw / 10 ** 6, mintSig })
    }

    res.json({ ok: true, data: { results } })
  } catch (err: any) {
    console.error('[DevnetMintXstockBatch]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// POST /api/devnet/relay-swap
// After user broadcasts the USDC transfer tx and it confirms,
// server mints the corresponding xStock to the user.
// body: { asset, amountUsd, walletAddress, usdcTxSig }
router.post('/devnet/relay-swap', async (req, res) => {
  const SOLANA_RPC = process.env.SOLANA_RPC || ''
  const isDevnet = SOLANA_RPC.includes('devnet') || SOLANA_RPC.includes('localhost') || SOLANA_RPC.includes('127.0.0.1')
  if (!isDevnet) {
    return res.status(403).json({ ok: false, error: 'Only available on devnet' })
  }

  try {
    const { asset, amountUsd, walletAddress, usdcTxSig } = req.body as {
      asset: string; amountUsd: number; walletAddress: string; usdcTxSig: string
    }
    if (!asset || !amountUsd || !walletAddress || !usdcTxSig) {
      return res.status(400).json({ ok: false, error: 'Missing fields' })
    }

    const { Connection, PublicKey, Transaction, Keypair } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount,
      createMintToInstruction,
    } = require('@solana/spl-token')
    const fs = require('fs')

    const TICKER_MAP: Record<string, string> = {
      TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
      GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
    }
    const DEVNET_MINTS: Record<string, string> = {
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }
    const XSTOCK_DECIMALS = 6

    const ticker = asset.toUpperCase()
    const xstockSymbol = TICKER_MAP[ticker]
    if (!xstockSymbol) return res.status(400).json({ ok: false, error: `Unknown asset: ${asset}` })
    const mintStr = DEVNET_MINTS[xstockSymbol]
    if (!mintStr) return res.status(400).json({ ok: false, error: `No devnet mint for ${xstockSymbol}` })

    // Use multiple RPCs for polling — tx may have been sent via a different node
    const POLL_RPCS = [
      SOLANA_RPC,
      process.env.SOLANA_RPC2,
      'https://api.devnet.solana.com',
    ].filter(Boolean) as string[]

    // Verify USDC transfer tx is confirmed (poll all RPCs until any returns confirmed)
    let usdcConfirmed = false
    let usdcErr: any = null
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1500))
      for (const rpc of POLL_RPCS) {
        try {
          const c = new Connection(rpc, 'confirmed')
          const st = await c.getSignatureStatus(usdcTxSig)
          const conf = st?.value?.confirmationStatus
          if (conf === 'confirmed' || conf === 'finalized') { usdcConfirmed = true; break }
          if (st?.value?.err) { usdcErr = st.value.err; break }
        } catch { /* try next RPC */ }
      }
      if (usdcConfirmed || usdcErr) break
      if (i === 39) return res.status(408).json({ ok: false, error: 'USDC transfer confirmation timeout — does wallet have enough SOL for fees?' })
    }
    if (usdcErr) return res.status(400).json({ ok: false, error: `USDC transfer failed on-chain: ${JSON.stringify(usdcErr)}` })
    if (!usdcConfirmed) return res.status(408).json({ ok: false, error: 'USDC transfer confirmation timeout' })

    const connection = new Connection(SOLANA_RPC, 'confirmed')

    // Compute xStock amount from oracle
    const { prisma } = await import('../db/client.js')
    const oracleRow = await prisma.priceSnapshot.findFirst({
      where: { ticker, issuer: 'yahoo' },
      orderBy: { capturedAt: 'desc' },
    })
    const oraclePrice = oracleRow?.oraclePrice ?? 300
    const xstockAmountRaw = Math.floor((amountUsd / oraclePrice) * 10 ** XSTOCK_DECIMALS)

    const keypairPath = process.env.MINT_AUTHORITY_KEYPAIR
      || `${process.env.HOME}/.config/solana/deploy-keypair.json`
    const mintAuthority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
    )

    const userPk = new PublicKey(walletAddress)
    const xstockMintPk = new PublicKey(mintStr)
    const userXstockAta = getAssociatedTokenAddressSync(xstockMintPk, userPk)

    const mintTx = new Transaction()
    mintTx.feePayer = mintAuthority.publicKey

    // Create user xStock ATA if needed
    try { await getAccount(connection, userXstockAta, 'confirmed', TOKEN_PROGRAM_ID) }
    catch {
      mintTx.add(createAssociatedTokenAccountInstruction(
        mintAuthority.publicKey, userXstockAta, userPk, xstockMintPk,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ))
    }

    mintTx.add(createMintToInstruction(
      xstockMintPk, userXstockAta, mintAuthority.publicKey, xstockAmountRaw, [], TOKEN_PROGRAM_ID,
    ))

    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    mintTx.recentBlockhash = blockhash
    mintTx.sign(mintAuthority)

    const mintSig = await connection.sendRawTransaction(mintTx.serialize(), { skipPreflight: true, maxRetries: 5 })

    // Poll mint confirmation
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const st = await connection.getSignatureStatus(mintSig)
      const conf = st?.value?.confirmationStatus
      if (conf === 'confirmed' || conf === 'finalized') break
      if (st?.value?.err) return res.status(500).json({ ok: false, error: `xStock mint failed: ${JSON.stringify(st.value.err)}` })
    }

    res.json({
      ok: true,
      data: {
        xstockSymbol,
        xstockAmount: xstockAmountRaw / 10 ** XSTOCK_DECIMALS,
        mintTxHash: mintSig,
        usdcTxSig,
      },
    })
  } catch (err: any) {
    console.error('[DevnetRelaySwap]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Devnet Faucet ──────────────────────────────────────────────────────────
// POST /api/devnet/faucet
// Mint test tokens to user wallet (devnet only)
// body: { walletAddress: '...', symbol?: 'USDC' | 'TSLAx' | ... }
// Without symbol: mints USDC + all xStock tokens
// With symbol='USDC': mints only mock USDC (for intent flow)
router.post('/devnet/faucet', async (req, res) => {
  const SOLANA_RPC = process.env.SOLANA_RPC || ''
  const isTestnet = SOLANA_RPC.includes('devnet') || SOLANA_RPC.includes('localhost') || SOLANA_RPC.includes('127.0.0.1')
  if (!isTestnet) {
    return res.status(403).json({ ok: false, error: 'Faucet only available on devnet/localnet' })
  }

  try {
    const { walletAddress, symbol } = req.body as { walletAddress: string; symbol?: string }
    if (!walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing walletAddress' })
    }

    const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
      createMintToInstruction, getAccount,
    } = require('@solana/spl-token')
    const fs = require('fs')

    // Mock USDC mint (devnet only, created by create-mock-usdc.js)
    const MOCK_USDC_MINT = 'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k'

    const XSTOCK_MINTS: Record<string, string> = {
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }

    // Determine which mints to send
    // symbol='USDC' → only mock USDC (for intent/swap flow)
    // symbol='TSLAx' etc → only that xStock (portfolio builder)
    // no symbol → USDC + all xStock (full kit)
    let mintsToSend: Record<string, { mint: string; amount: number }>
    if (symbol === 'USDC') {
      mintsToSend = { USDC: { mint: MOCK_USDC_MINT, amount: 10000 * 10 ** 6 } } // $10,000 USDC
    } else if (symbol && XSTOCK_MINTS[symbol]) {
      mintsToSend = { [symbol]: { mint: XSTOCK_MINTS[symbol], amount: 10 * 10 ** 6 } }
    } else {
      // Full kit: USDC + all xStock
      mintsToSend = {
        USDC: { mint: MOCK_USDC_MINT, amount: 10000 * 10 ** 6 },
        ...Object.fromEntries(Object.entries(XSTOCK_MINTS).map(([s, m]) => [s, { mint: m, amount: 10 * 10 ** 6 }]))
      }
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const recipientPk = new PublicKey(walletAddress)

    const keypairPath = process.env.MINT_AUTHORITY_KEYPAIR
      || `${process.env.HOME}/.config/solana/deploy-keypair.json`
    const mintAuthority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
    )

    const results = []

    for (const [sym, { mint: mintStr, amount }] of Object.entries(mintsToSend)) {
      try {
        const mintPk = new PublicKey(mintStr)
        const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk)

        const tx = new Transaction()
        tx.feePayer = mintAuthority.publicKey

        try {
          await getAccount(connection, recipientAta, 'confirmed', TOKEN_PROGRAM_ID)
        } catch {
          tx.add(createAssociatedTokenAccountInstruction(
            mintAuthority.publicKey, recipientAta, recipientPk, mintPk,
            TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          ))
        }

        tx.add(createMintToInstruction(
          mintPk, recipientAta, mintAuthority.publicKey, amount, [], TOKEN_PROGRAM_ID
        ))

        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = blockhash
        tx.sign(mintAuthority)

        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 })

        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const status = await connection.getSignatureStatus(sig)
          const conf = status?.value?.confirmationStatus
          if (conf === 'confirmed' || conf === 'finalized') break
          if (status?.value?.err) throw new Error(`Tx failed: ${JSON.stringify(status.value.err)}`)
        }
        results.push({ symbol: sym, mint: mintStr, txHash: sig, amount: amount / 10 ** 6 })
      } catch (e: any) {
        console.warn(`[Faucet] ${sym} mint failed:`, e.message)
        results.push({ symbol: sym, mint: mintStr, error: e.message })
      }
    }

    // Ensure user has enough SOL for tx fees.
    // MUST use official devnet RPC — private RPCs (Alchemy etc) don't support requestAirdrop.
    let solAirdropSig: string | null = null
    try {
      const { LAMPORTS_PER_SOL } = require('@solana/web3.js')
      const DEVNET_PUBLIC_RPC = 'https://api.devnet.solana.com'
      const airdropConn = new Connection(DEVNET_PUBLIC_RPC, 'confirmed')
      const bal = await airdropConn.getBalance(recipientPk)
      if (bal < 0.1 * LAMPORTS_PER_SOL) {
        solAirdropSig = await airdropConn.requestAirdrop(recipientPk, 1 * LAMPORTS_PER_SOL) // 1 SOL max on devnet
        console.log('[Faucet] SOL airdrop sent:', solAirdropSig)
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const st = await airdropConn.getSignatureStatus(solAirdropSig)
          const conf = st?.value?.confirmationStatus
          if (conf === 'confirmed' || conf === 'finalized') {
            console.log('[Faucet] SOL airdrop confirmed'); break
          }
        }
      }
    } catch (e: any) {
      console.warn('[Faucet] SOL airdrop failed (non-fatal):', e.message)
    }

    res.json({
      ok: true,
      data: { recipient: walletAddress, tokens: results, solAirdrop: solAirdropSig },
    })
  } catch (err: any) {
    console.error('[Faucet]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Portfolio Builder ──────────────────────────────────────────────────────
// POST /api/portfolio/build-batch
// 批量构建多资产组合交易
// body: { positions: [{asset:'TSLA', pct:30}, ...], totalUsd: 5000, walletAddress: '...' }
router.post('/portfolio/build-batch', async (req, res) => {
  const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
  const isDevnet = SOLANA_RPC.includes('devnet')

  try {
    const { positions, totalUsd, walletAddress } = req.body as {
      positions: { asset: string; pct: number }[]
      totalUsd: number
      walletAddress: string
    }
    if (!positions?.length || !totalUsd || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing positions, totalUsd, or walletAddress' })
    }
    const totalPct = positions.reduce((s, p) => s + p.pct, 0)
    if (Math.abs(totalPct - 100) > 0.1) {
      return res.status(400).json({ ok: false, error: `Positions must sum to 100% (got ${totalPct}%)` })
    }

    const TICKER_MAP: Record<string, string> = {
      TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
      GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
    }
    const DEVNET_MINTS: Record<string, string> = {
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }
    const MAINNET_MINTS: Record<string, string> = {
      TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
      NVDAx: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      SPYx:  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      AAPLx: 'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
      GOOGLx:'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
      METAx: 'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
      COINx: 'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
      MSTRx: 'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
    }
    const mintMap = isDevnet ? DEVNET_MINTS : MAINNET_MINTS
    const XSTOCK_DECIMALS = 6
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    const {
      Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram,
    } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount,
      createTransferCheckedInstruction, createMintToInstruction,
    } = require('@solana/spl-token')
    const fs = require('fs')

    const MOCK_USDC_MINT = 'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k'

    // Try multiple RPCs in order until one works
    const DEVNET_RPCS = [
      process.env.SOLANA_RPC,
      process.env.SOLANA_RPC2,
      'https://api.devnet.solana.com',
    ].filter(Boolean) as string[]

    let connection: any
    for (const rpc of DEVNET_RPCS) {
      try {
        const c = new Connection(rpc, 'confirmed')
        await c.getLatestBlockhash('confirmed')
        connection = c
        break
      } catch { /* try next */ }
    }
    if (!connection) throw new Error('All devnet RPCs rate limited, please try again in a minute')

    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const userPk     = new PublicKey(walletAddress)
    const { prisma }  = await import('../db/client.js')

    const batchResults = []

    for (const pos of positions) {
      const ticker = pos.asset.toUpperCase()
      const xstockSymbol = TICKER_MAP[ticker]
      if (!xstockSymbol) continue

      const mintStr = mintMap[xstockSymbol]
      const posAmountUsd = (totalUsd * pos.pct) / 100

      let swapTransaction: string | null = null
      let swapLastValidBlockHeight: number | null = null
      let xstockAmountRaw: number
      let priceImpactPct = 0

      if (isDevnet || !mintStr) {
        // devnet: just calculate amounts from oracle price.
        // Swap txs are built fresh at execute-time via /api/devnet/build-swap-txs.
        const oracleRow = await prisma.priceSnapshot.findFirst({
          where: { ticker, issuer: 'yahoo' },
          orderBy: { capturedAt: 'desc' },
        })
        const oraclePrice = oracleRow?.oraclePrice ?? 300
        xstockAmountRaw = Math.floor((posAmountUsd / oraclePrice) * 10 ** XSTOCK_DECIMALS)
        // swapTransaction stays null — frontend fetches it fresh at execute-time
      } else {
        // mainnet: Jupiter quote
        const inputAmount = Math.floor(posAmountUsd * 10 ** 6)
        try {
          const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_MINT}&outputMint=${mintStr}&amount=${inputAmount}&slippageBps=50`
          const quoteResp = await fetch(quoteUrl, { signal: AbortSignal.timeout(10000) })
          if (!quoteResp.ok) throw new Error(`Jupiter quote ${quoteResp.status}`)
          const quoteData = await quoteResp.json() as { outAmount: string; priceImpactPct: string }
          xstockAmountRaw = parseInt(quoteData.outAmount)
          priceImpactPct = parseFloat(quoteData.priceImpactPct)

          const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteResponse: quoteData, userPublicKey: walletAddress,
              wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: 'auto',
            }),
            signal: AbortSignal.timeout(15000),
          })
          if (!swapResp.ok) throw new Error(`Jupiter swap ${swapResp.status}`)
          const swapData = await swapResp.json() as { swapTransaction: string; lastValidBlockHeight: number }
          swapTransaction = swapData.swapTransaction
          swapLastValidBlockHeight = swapData.lastValidBlockHeight
        } catch (err: any) {
          console.warn(`[Portfolio] Jupiter failed for ${xstockSymbol}:`, err.message)
          // 降级：按价格折算
          xstockAmountRaw = Math.floor((posAmountUsd / 300) * 10 ** XSTOCK_DECIMALS)
        }
      }

      // Vault deposit tx
      const effectiveMintStr = mintStr || (isDevnet ? DEVNET_MINTS['TSLAx'] : null)
      if (!effectiveMintStr) continue

      const xstockMint = new PublicKey(effectiveMintStr)
      const { vaultPda, receiptMint } = deriveVaultPdas(xstockMint, programId)
      const userXstockAta  = getAssociatedTokenAddressSync(xstockMint, userPk)
      const vaultXstockAta = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)
      const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, userPk, false, TOKEN_PROGRAM_ID)
      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()], programId
      )

      const amountBuf = Buffer.alloc(8)
      amountBuf.writeBigUInt64LE(BigInt(xstockAmountRaw))
      const depositIxData = Buffer.concat([DEPOSIT_DISC, amountBuf])

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      const depositTx = new Transaction()
      depositTx.recentBlockhash = blockhash
      depositTx.feePayer = userPk
      // Pre-add compute budget so Phantom does not inject its own (which can cause RPC forwarding issues)
      depositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }))
      depositTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }))

      try {
        await getAccount(connection, userReceiptAta, 'confirmed', TOKEN_PROGRAM_ID)
      } catch {
        depositTx.add(createAssociatedTokenAccountInstruction(
          userPk, userReceiptAta, userPk, receiptMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        ))
      }
      depositTx.add(new TransactionInstruction({
        programId,
        keys: [
          { pubkey: userPk,          isSigner: true,  isWritable: true  },
          { pubkey: vaultPda,        isSigner: false, isWritable: true  },
          { pubkey: receiptMint,     isSigner: false, isWritable: true  },
          { pubkey: userXstockAta,   isSigner: false, isWritable: true  },
          { pubkey: vaultXstockAta,  isSigner: false, isWritable: true  },
          { pubkey: userReceiptAta,  isSigner: false, isWritable: true  },
          { pubkey: userPositionPda, isSigner: false, isWritable: true  },
          { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
        ],
        data: depositIxData,
      }))

      batchResults.push({
        asset: ticker,
        xstockSymbol,
        pct: pos.pct,
        amountUsd: posAmountUsd,
        xstockAmount: xstockAmountRaw / 10 ** XSTOCK_DECIMALS,
        swapTransaction,
        swapLastValidBlockHeight,
        depositTransaction: depositTx.serialize({ requireAllSignatures: false }).toString('base64'),
        depositBlockhash: blockhash,
        depositLastValidBlockHeight: lastValidBlockHeight,
        priceImpactPct,
        vaultPda: vaultPda.toBase58(),
        receiptMint: receiptMint.toBase58(),
      })

      // 避免 Jupiter rate limit
      if (!isDevnet) await new Promise(r => setTimeout(r, 300))
    }

    // Weighted APY based on portfolio allocation
    const APY_BY_ASSET: Record<string, number> = {
      TSLAx: 4.20, NVDAx: 4.20, SPYx: 3.80, AAPLx: 4.20,
      GOOGLx: 4.20, METAx: 4.20, COINx: 5.50, MSTRx: 5.50,
    }
    const projectedApy = batchResults.reduce((sum, pos) => {
      const apy = APY_BY_ASSET[pos.xstockSymbol] ?? 4.20
      return sum + apy * (pos.pct / 100)
    }, 0)

    res.json({
      ok: true,
      data: {
        mode: isDevnet ? 'devnet-swap' : 'mainnet',
        mockUsdcMint: isDevnet ? MOCK_USDC_MINT : null,
        totalUsd,
        positions: batchResults,
        projectedApy: Math.round(projectedApy * 100) / 100,
      },
    })
  } catch (err: any) {
    console.error('[Portfolio build-batch]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Devnet Faucet ──────────────────────────────────────────────────────────
// POST /api/devnet/airdrop-tokens
// 给用户钱包铸造测试用 xStock 代币（仅 devnet）
router.post('/devnet/airdrop-tokens', async (req, res) => {
  const SOLANA_RPC = process.env.SOLANA_RPC || ''
  if (!SOLANA_RPC.includes('devnet')) {
    return res.status(400).json({ ok: false, error: 'Only available on devnet' })
  }
  try {
    const { walletAddress, tickers } = req.body as { walletAddress: string; tickers: string[] }
    if (!walletAddress || !tickers?.length) {
      return res.status(400).json({ ok: false, error: 'Missing walletAddress or tickers' })
    }

    const { execSync } = require('child_process')
    const path = require('path'), os = require('os')

    const DEVNET_MINTS: Record<string, string> = {
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }
    const TICKER_TO_XSTOCK: Record<string, string> = {
      TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
      GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
    }

    const keypairPath = path.join(os.homedir(), '.config/solana/deploy-keypair.json')
    const SPL_TOKEN = path.join(os.homedir(), '.local/share/solana/install/active_release/bin/spl-token')

    const results: Record<string, string> = {}

    for (const ticker of tickers) {
      const xstockSym = TICKER_TO_XSTOCK[ticker.toUpperCase()]
      if (!xstockSym) continue
      const mintStr = DEVNET_MINTS[xstockSym]
      if (!mintStr) continue

      // Use spl-token CLI — has built-in retry and doesn't consume RPC quota
      const cmd = `${SPL_TOKEN} mint ${mintStr} 10000 ${walletAddress} \
        --owner ${keypairPath} \
        --fee-payer ${keypairPath} \
        --url devnet \
        --output json`

      const out = execSync(cmd, { encoding: 'utf8', timeout: 60000 })
      const json = JSON.parse(out)
      results[ticker] = json.signature ?? out.trim()
      console.log(`[Airdrop] Minted 10,000 ${xstockSym} to ${walletAddress}: ${results[ticker]}`)
    }

    res.json({ ok: true, data: results })
  } catch (err: any) {
    console.error('[Devnet airdrop]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Transaction Relay ──────────────────────────────────────────────────────
// GET /api/tx/blockhash
// Returns a fresh blockhash for the frontend to use when building transactions
router.get('/tx/blockhash', async (_req, res) => {
  const TX_RPCS = [
    process.env.SOLANA_RPC,
    process.env.SOLANA_RPC2,
    'https://api.devnet.solana.com',
  ].filter(Boolean) as string[]

  try {
    const { Connection } = require('@solana/web3.js')
    let lastErr: any
    for (const rpc of TX_RPCS) {
      try {
        const c = new Connection(rpc, 'confirmed')
        const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed')
        return res.json({ ok: true, blockhash, lastValidBlockHeight })
      } catch (e: any) {
        lastErr = e
        const msg = String(e?.message ?? e)
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many')) continue
        throw e
      }
    }
    res.status(429).json({ ok: false, error: lastErr?.message ?? 'All RPCs rate limited' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// POST /api/tx/send
// body: { transaction: base64 }  — signed tx bytes from frontend
// Sends via server-side RPC rotation (frontend has no working devnet RPC)
router.post('/tx/send', async (req, res) => {
  const TX_RPCS = [
    process.env.SOLANA_RPC,
    process.env.SOLANA_RPC2,
    'https://api.devnet.solana.com',
  ].filter(Boolean) as string[]

  try {
    const { Connection } = require('@solana/web3.js')
    const { transaction } = req.body as { transaction: string }
    if (!transaction) return res.status(400).json({ ok: false, error: 'Missing transaction' })

    const txBytes = Buffer.from(transaction, 'base64')
    let lastErr: any
    for (const rpc of TX_RPCS) {
      try {
        const c = new Connection(rpc, 'confirmed')
        const sig = await c.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 5 })
        return res.json({ ok: true, signature: sig })
      } catch (e: any) {
        lastErr = e
        const msg = String(e?.message ?? e)
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many')) continue
        // Extract program logs for Anchor errors
        const logs: string[] = (e as any)?.logs ?? []
        const detail = logs.length ? `${msg} | logs: ${logs.join(' | ')}` : msg
        console.error('[tx/send] simulation error:', detail)
        return res.status(400).json({ ok: false, error: detail })
      }
    }
    res.status(429).json({ ok: false, error: lastErr?.message ?? 'All RPCs rate limited' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// POST /api/tx/send-confirm
// Sends a signed tx and retries every 4s until confirmed (~90s timeout).
// Uses official devnet RPC which has no rate limits for devnet traffic.
router.post('/tx/send-confirm', async (req, res) => {
  try {
    const { Connection } = require('@solana/web3.js')
    const { transaction } = req.body as { transaction: string }
    if (!transaction) return res.status(400).json({ ok: false, error: 'Missing transaction' })
    const txBytes = Buffer.from(transaction, 'base64')
    const ALCHEMY_RPC1 = process.env.SOLANA_RPC || 'https://api.devnet.solana.com'
    const ALCHEMY_RPC2 = process.env.SOLANA_RPC2 || ALCHEMY_RPC1
    // Ankr free public devnet — different provider from Alchemy, used for broadcast diversity
    const ANKR_RPC = 'https://rpc.ankr.com/solana_devnet'
    const conn1 = new Connection(ALCHEMY_RPC1, 'confirmed')
    const conn2 = new Connection(ALCHEMY_RPC2, 'confirmed')
    const conn3 = new Connection(ANKR_RPC, 'confirmed')

    // Simulate to catch real on-chain errors before broadcasting
    let simDone = false
    try {
      const { Transaction: SolTx } = require('@solana/web3.js')
      const simTx = SolTx.from(txBytes)

      // Log tx details and verify Ed25519 signature
      const sig0 = simTx.signatures[0]
      const sigBytes = sig0?.signature
      const sigIsZero = !sigBytes || sigBytes.every((b: number) => b === 0)
      let sigValid = false
      if (!sigIsZero && sig0?.publicKey) {
        const { ed25519 } = require('@noble/curves/ed25519')
        const msgBytes = simTx.serializeMessage()
        try {
          sigValid = ed25519.verify(sigBytes, msgBytes, sig0.publicKey.toBytes())
        } catch { sigValid = false }
      }
      const ixDetails = simTx.instructions.map((ix: any) => ix.programId?.toBase58()?.slice(0, 8)).join(', ')
      console.log('[send-confirm] feePayer:', sig0?.publicKey?.toBase58(), '| sigIsZero:', sigIsZero, '| sigValid:', sigValid, '| numInstructions:', simTx.instructions.length, '| programs:', ixDetails)
      if (!sigIsZero && !sigValid) {
        console.error('[send-confirm] INVALID SIGNATURE — validators will silently drop this tx')
        return res.status(400).json({ ok: false, error: 'Invalid signature: transaction message does not match signature' })
      }

      // sigVerify:true catches invalid signatures — simulation normally skips sig check
      const simResult = await conn1.simulateTransaction(simTx, [], true)
      simDone = true
      if (simResult.value.err) {
        console.error('[send-confirm] Simulation error:', JSON.stringify(simResult.value.err))
        console.error('[send-confirm] Logs:', simResult.value.logs?.join('\n'))
        return res.status(400).json({
          ok: false,
          error: `Simulation failed: ${JSON.stringify(simResult.value.err)}`,
          logs: simResult.value.logs,
        })
      }
      console.log('[send-confirm] Simulation OK (sigVerify passed)')
    } catch (simErr: any) {
      console.warn('[send-confirm] Simulation threw:', simErr?.message)
      // Simulation failed due to RPC issue — proceed but log it
    }

    // Broadcast to ALL 3 RPCs simultaneously — different providers increase forwarding chances
    let sig: string | null = null
    const broadcastAll = () => Promise.allSettled([
      conn1.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 0 }),
      conn2.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 0 }),
      conn3.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 0 }),
    ])
    const initResults = await broadcastAll()
    for (const r of initResults) {
      if (r.status === 'fulfilled') { sig = r.value; break }
    }
    if (!sig) {
      const err = (initResults.find(r => r.status === 'rejected') as PromiseRejectedResult)?.reason
      return res.status(400).json({ ok: false, error: `Broadcast failed: ${err?.message}` })
    }
    console.log('[send-confirm] Initial broadcast sig:', sig.slice(0, 20), '... | simOK:', simDone)

    // Re-broadcast every 2s to ALL RPCs. Solana-recommended pattern for devnet.
    const deadline = Date.now() + 55_000
    let iteration = 0
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      iteration++

      // Re-send to all RPCs every iteration
      broadcastAll().catch(() => {})

      // Poll status — rotate through all 3 RPCs
      const conns = [conn1, conn2, conn3]
      const pollConn = conns[iteration % 3]
      const status = await pollConn.getSignatureStatus(sig!, { searchTransactionHistory: true }).catch(() => null)
      const conf = status?.value?.confirmationStatus
      console.log(`[send-confirm] iter=${iteration} conf=${conf ?? 'none'} sig=${sig!.slice(0, 8)}`)
      if (conf === 'confirmed' || conf === 'finalized') {
        console.log('[send-confirm] Confirmed:', sig)
        return res.json({ ok: true, signature: sig })
      }
      if (status?.value?.err) {
        console.error('[send-confirm] On-chain error:', sig, status.value.err)
        return res.status(400).json({ ok: false, error: `Tx failed on-chain: ${JSON.stringify(status.value.err)}` })
      }
    }
    console.error('[send-confirm] Timeout for sig:', sig)
    return res.status(408).json({ ok: false, error: 'Confirmation timeout after 55s' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// GET /api/tx/status/:sig
// Returns confirmation status for a transaction signature
router.get('/tx/status/:sig', async (req, res) => {
  const TX_RPCS = [
    process.env.SOLANA_RPC,
    process.env.SOLANA_RPC2,
    'https://api.devnet.solana.com',
  ].filter(Boolean) as string[]

  try {
    const { Connection } = require('@solana/web3.js')
    const { sig } = req.params
    let lastErr: any
    for (const rpc of TX_RPCS) {
      try {
        const c = new Connection(rpc, 'confirmed')
        const statuses = await c.getSignatureStatuses([sig])
        const st = statuses?.value?.[0]
        return res.json({ ok: true, status: st ?? null })
      } catch (e: any) {
        lastErr = e
        const msg = String(e?.message ?? e)
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many')) continue
        throw e
      }
    }
    res.status(429).json({ ok: false, error: lastErr?.message ?? 'All RPCs rate limited' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── Intent Router ──────────────────────────────────────────────────────────
// POST /api/intent/route
// body: { asset: 'TSLA', amountUsd: 1000, riskTolerance: 'medium' }
router.post('/intent/route', async (req, res) => {
  try {
    const { asset, amountUsd, riskTolerance } = req.body as {
      asset: string; amountUsd: number; riskTolerance: 'low' | 'medium' | 'high'
    }
    if (!asset || !amountUsd || !riskTolerance) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amountUsd, or riskTolerance' })
    }
    const result = await routeIntent({ asset, amountUsd, riskTolerance })
    res.json({ ok: true, data: result })
  } catch (err: any) {
    console.error('[IntentRouter]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// POST /api/intent/execute-entry
// devnet:  只构建 Vault deposit tx（测试 token 直接存）
// mainnet: 构建 Jupiter swap tx + Vault deposit tx（双签）
// body: { asset: 'TSLA', amountUsd: 1000, walletAddress: '...' }
router.post('/intent/execute-entry', async (req, res) => {
  try {
    const { asset, amountUsd, walletAddress } = req.body as {
      asset: string; amountUsd: number; walletAddress: string
    }
    if (!asset || !amountUsd || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amountUsd, or walletAddress' })
    }

    const TICKER_MAP: Record<string, string> = {
      TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
      GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
    }
    const xstockSymbol = TICKER_MAP[asset.toUpperCase()]
    if (!xstockSymbol) {
      return res.status(400).json({ ok: false, error: `Unsupported asset: ${asset}` })
    }

    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const isDevnet = SOLANA_RPC.includes('devnet')

    const {
      Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram,
    } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount,
    } = require('@solana/spl-token')

    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const userPk     = new PublicKey(walletAddress)
    const XSTOCK_DECIMALS = 6

    // ── Mint 地址：devnet 用测试 mint，mainnet 用 Backed Finance ──────────
    const DEVNET_MINTS: Record<string, string> = {
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }
    const MAINNET_MINTS: Record<string, string> = {
      TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
      NVDAx: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      SPYx:  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      AAPLx: 'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
      GOOGLx:'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
      METAx: 'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
      COINx: 'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
      MSTRx: 'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
    }
    const mintMap = isDevnet ? DEVNET_MINTS : MAINNET_MINTS
    const xstockMintStr = mintMap[xstockSymbol]
    if (!xstockMintStr) {
      return res.status(400).json({ ok: false, error: `No ${isDevnet ? 'devnet' : 'mainnet'} mint for ${xstockSymbol}` })
    }

    const xstockMint = new PublicKey(xstockMintStr)
    const { vaultPda, receiptMint } = deriveVaultPdas(xstockMint, programId)
    const userXstockAta  = getAssociatedTokenAddressSync(xstockMint, userPk)
    const vaultXstockAta = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)
    const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, userPk, false, TOKEN_PROGRAM_ID)
    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()], programId
    )

    // Mock USDC mint (devnet — created by create-mock-usdc.js)
    const MOCK_USDC_MINT = 'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k'

    const { createTransferCheckedInstruction } = require('@solana/spl-token')
    const fs = require('fs')

    // ── devnet：build single-signer USDC transfer tx (user → pool) ─────────
    // ── mainnet：Jupiter quote + swap tx ───────────────────────────────────
    let xstockAmountRaw: number
    let swapTransaction: string | null = null
    let swapLastValidBlockHeight: number | null = null
    let priceImpactPct = 0

    if (isDevnet) {
      // Devnet: server mints xStock directly to user (simulates Jupiter swap)
      // No user tx needed for swap — only vault deposit requires user signature.
      const oracleRow = await (await import('../db/client.js')).prisma.priceSnapshot.findFirst({
        where: { ticker: asset.toUpperCase(), issuer: 'yahoo' },
        orderBy: { capturedAt: 'desc' },
      })
      const oraclePrice = oracleRow?.oraclePrice ?? 300
      xstockAmountRaw = Math.floor((amountUsd / oraclePrice) * 10 ** XSTOCK_DECIMALS)

      const { Keypair } = require('@solana/web3.js')
      const { createMintToInstruction } = require('@solana/spl-token')
      const keypairPath = process.env.MINT_AUTHORITY_KEYPAIR
        || `${process.env.HOME}/.config/solana/deploy-keypair.json`
      const mintAuthority = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
      )

      // Create user xStock ATA if needed, then mint xStock
      const mintTx = new Transaction()
      mintTx.feePayer = mintAuthority.publicKey
      try { await getAccount(connection, userXstockAta, 'confirmed', TOKEN_PROGRAM_ID) }
      catch {
        mintTx.add(createAssociatedTokenAccountInstruction(
          mintAuthority.publicKey, userXstockAta, userPk, xstockMint,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        ))
      }
      mintTx.add(createMintToInstruction(
        xstockMint, userXstockAta, mintAuthority.publicKey, xstockAmountRaw, [], TOKEN_PROGRAM_ID
      ))
      const { blockhash: mintBh } = await connection.getLatestBlockhash('confirmed')
      mintTx.recentBlockhash = mintBh
      mintTx.sign(mintAuthority)
      const mintSig = await connection.sendRawTransaction(mintTx.serialize(), { skipPreflight: true, maxRetries: 5 })
      // Poll for mint confirmation before building deposit tx
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const st = await connection.getSignatureStatus(mintSig)
        const c = st?.value?.confirmationStatus
        if (c === 'confirmed' || c === 'finalized') break
        if (st?.value?.err) throw new Error(`xStock mint failed: ${JSON.stringify(st.value.err)}`)
      }
      // No swap tx for user to sign — swapTransaction stays null
    } else {
      // mainnet：Jupiter quote USDC → xStock
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const inputAmount = Math.floor(amountUsd * 10 ** 6)
      const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_MINT}&outputMint=${xstockMintStr}&amount=${inputAmount}&slippageBps=50`

      const quoteResp = await fetch(quoteUrl, { signal: AbortSignal.timeout(10000) })
      if (!quoteResp.ok) throw new Error(`Jupiter quote failed: ${quoteResp.status}`)
      const quoteData = await quoteResp.json() as {
        outAmount: string; priceImpactPct: string; routePlan: unknown[]
      }

      xstockAmountRaw = parseInt(quoteData.outAmount)
      priceImpactPct = parseFloat(quoteData.priceImpactPct)

      const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!swapResp.ok) throw new Error(`Jupiter swap build failed: ${swapResp.status}`)
      const swapData = await swapResp.json() as { swapTransaction: string; lastValidBlockHeight: number }
      swapTransaction = swapData.swapTransaction
      swapLastValidBlockHeight = swapData.lastValidBlockHeight
    }

    // ── Vault deposit tx（devnet + mainnet 共用）────────────────────────────
    const amountBuf = Buffer.alloc(8)
    amountBuf.writeBigUInt64LE(BigInt(xstockAmountRaw))
    const depositIxData = Buffer.concat([DEPOSIT_DISC, amountBuf])

    const { blockhash, lastValidBlockHeight: depositHeight } = await connection.getLatestBlockhash()
    const depositTx = new Transaction()
    depositTx.recentBlockhash = blockhash
    depositTx.feePayer = userPk
    // Pre-add compute budget so Phantom does not inject its own (causes Alchemy forwarding issues)
    depositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }))
    depositTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }))

    try {
      await getAccount(connection, userReceiptAta, 'confirmed', TOKEN_PROGRAM_ID)
    } catch {
      depositTx.add(createAssociatedTokenAccountInstruction(
        userPk, userReceiptAta, userPk, receiptMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ))
    }

    depositTx.add(new TransactionInstruction({
      programId,
      keys: [
        { pubkey: userPk,          isSigner: true,  isWritable: true  },
        { pubkey: vaultPda,        isSigner: false, isWritable: true  },
        { pubkey: receiptMint,     isSigner: false, isWritable: true  },
        { pubkey: userXstockAta,   isSigner: false, isWritable: true  },
        { pubkey: vaultXstockAta,  isSigner: false, isWritable: true  },
        { pubkey: userReceiptAta,  isSigner: false, isWritable: true  },
        { pubkey: userPositionPda, isSigner: false, isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      ],
      data: depositIxData,
    }))

    const depositTxB64 = depositTx.serialize({ requireAllSignatures: false }).toString('base64')

    res.json({
      ok: true,
      data: {
        // devnet-swap: mock swap tx (partial-signed by server) + deposit tx
        // mainnet: Jupiter swap tx + deposit tx
        mode: isDevnet ? 'devnet-swap' : 'mainnet',
        mockUsdcMint: isDevnet ? 'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k' : null,
        // Tx 1: swap (mainnet=Jupiter, devnet=mock swap partial-signed by server)
        swapTransaction,
        swapLastValidBlockHeight,
        // Tx 2: Vault deposit
        depositTransaction: depositTxB64,
        depositBlockhash: blockhash,
        depositLastValidBlockHeight: depositHeight,
        // Meta
        xstockSymbol,
        usdcIn: amountUsd,
        xstockOut: xstockAmountRaw / 10 ** XSTOCK_DECIMALS,
        priceImpactPct,
        vaultPda: vaultPda.toBase58(),
        receiptMint: receiptMint.toBase58(),
      },
    })
  } catch (err: any) {
    console.error('[IntentExecute]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── OnStock Vault ──────────────────────────────────────────────────────────

const VAULT_PROGRAM_ID = 'Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx'
const VAULT_SEED = Buffer.from('vault')
const RECEIPT_SEED = Buffer.from('receipt')

// sha256("global:deposit")[0..8]  — Anchor instruction discriminator
const DEPOSIT_DISC = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182])
// sha256("global:withdraw")[0..8]
const WITHDRAW_DISC = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34])

// xStock mint addresses
// devnet: test mints (initialized via initialize-devnet.js)
// mainnet: Backed Finance mints
const IS_DEVNET = (process.env.SOLANA_RPC ?? '').includes('devnet') || (process.env.SOLANA_RPC ?? '').includes('localhost') || (process.env.SOLANA_RPC ?? '').includes('127.0.0.1')
const XSTOCK_MINTS: Record<string, string> = IS_DEVNET
  ? {
      // localnet / devnet test mints
      TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
      NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
      SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
      AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
      GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
      METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
      COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
      MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
    }
  : {
      // mainnet Backed Finance mints
      TSLAx:  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
      NVDAx:  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      SPYx:   'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      QQQx:   'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
      AAPLx:  'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
    }

function deriveVaultPdas(xstockMint: any /* PublicKey */, programId: any /* PublicKey */) {
  const { PublicKey } = require('@solana/web3.js')
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, xstockMint.toBuffer()],
    programId
  )
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, xstockMint.toBuffer()],
    programId
  )
  return { vaultPda, vaultBump, receiptMint }
}

// POST /api/earn/vault/build-deposit
// 构建 OnStock Vault deposit 交易（server 端编码，前端签名）
// body: { asset: 'TSLAx', amount: 1.5, walletAddress: '...' }
router.post('/earn/vault/build-deposit', async (req, res) => {
  try {
    const { asset, amount, walletAddress } = req.body as {
      asset: string; amount: number; walletAddress: string
    }
    if (!asset || !amount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amount, or walletAddress' })
    }

    const mintStr = XSTOCK_MINTS[asset]
    if (!mintStr) return res.status(400).json({ ok: false, error: `Unknown asset: ${asset}` })

    const {
      Connection, PublicKey, Transaction, TransactionInstruction,
      SystemProgram, SYSVAR_RENT_PUBKEY,
    } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
      getAccount,
    } = require('@solana/spl-token')

    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const connection = new Connection(SOLANA_RPC, 'confirmed')

    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const xstockMint = new PublicKey(mintStr)
    const userPk     = new PublicKey(walletAddress)

    const { vaultPda, vaultBump, receiptMint } = deriveVaultPdas(xstockMint, programId)

    // ATAs
    const userXstockAta   = getAssociatedTokenAddressSync(xstockMint, userPk)
    const vaultXstockAta  = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)
    const userReceiptAta  = getAssociatedTokenAddressSync(receiptMint, userPk, false, TOKEN_PROGRAM_ID)

    // User position PDA
    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()],
      programId
    )

    // Amount in lamports (6 decimals for xStocks)
    const DECIMALS = 6
    const amountLamports = BigInt(Math.floor(amount * 10 ** DECIMALS))
    const amountBuf = Buffer.alloc(8)
    amountBuf.writeBigUInt64LE(amountLamports)

    const ixData = Buffer.concat([DEPOSIT_DISC, amountBuf])

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

    const tx = new Transaction()
    tx.recentBlockhash = blockhash
    tx.feePayer = userPk

    // Create receipt ATA if it doesn't exist
    try {
      await getAccount(connection, userReceiptAta, 'confirmed', TOKEN_PROGRAM_ID)
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(
        userPk, userReceiptAta, userPk, receiptMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ))
    }

    // Vault deposit instruction
    const depositIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: userPk,           isSigner: true,  isWritable: true  }, // user
        { pubkey: vaultPda,         isSigner: false, isWritable: true  }, // vault
        { pubkey: receiptMint,      isSigner: false, isWritable: true  }, // receipt_mint
        { pubkey: userXstockAta,    isSigner: false, isWritable: true  }, // user_xstock_ata
        { pubkey: vaultXstockAta,   isSigner: false, isWritable: true  }, // vault_xstock_ata
        { pubkey: userReceiptAta,   isSigner: false, isWritable: true  }, // user_receipt_ata
        { pubkey: userPositionPda,  isSigner: false, isWritable: true  }, // user_position
        { pubkey: TOKEN_PROGRAM_ID,               isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,        isSigner: false, isWritable: false },
      ],
      data: ixData,
    })
    tx.add(depositIx)

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64')

    res.json({
      ok: true,
      data: {
        transaction: serialized,
        blockhash,
        lastValidBlockHeight,
        asset,
        amount,
        vaultPda: vaultPda.toBase58(),
        receiptMint: receiptMint.toBase58(),
      }
    })
  } catch (err: any) {
    console.error('[Vault build-deposit]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// POST /api/earn/vault/build-withdraw
// 构建 OnStock Vault withdraw 交易
// body: { asset: 'TSLAx', shares: 1.5, walletAddress: '...' }
router.post('/earn/vault/build-withdraw', async (req, res) => {
  try {
    const { asset, shares, walletAddress } = req.body as {
      asset: string; shares: number; walletAddress: string
    }
    if (!asset || !shares || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, shares, or walletAddress' })
    }

    const mintStr = XSTOCK_MINTS[asset]
    if (!mintStr) return res.status(400).json({ ok: false, error: `Unknown asset: ${asset}` })

    const {
      Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
    } = require('@solana/web3.js')
    const {
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      getAssociatedTokenAddressSync,
    } = require('@solana/spl-token')

    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const connection = new Connection(SOLANA_RPC, 'confirmed')

    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const xstockMint = new PublicKey(mintStr)
    const userPk     = new PublicKey(walletAddress)

    const { vaultPda, receiptMint } = deriveVaultPdas(xstockMint, programId)

    const userXstockAta  = getAssociatedTokenAddressSync(xstockMint, userPk)
    const vaultXstockAta = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)
    const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, userPk, false, TOKEN_PROGRAM_ID)

    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()],
      programId
    )

    const DECIMALS = 6
    const sharesLamports = BigInt(Math.floor(shares * 10 ** DECIMALS))
    const sharesBuf = Buffer.alloc(8)
    sharesBuf.writeBigUInt64LE(sharesLamports)

    const ixData = Buffer.concat([WITHDRAW_DISC, sharesBuf])

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

    const tx = new Transaction()
    tx.recentBlockhash = blockhash
    tx.feePayer = userPk

    const withdrawIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: userPk,           isSigner: true,  isWritable: true  },
        { pubkey: vaultPda,         isSigner: false, isWritable: true  },
        { pubkey: receiptMint,      isSigner: false, isWritable: true  },
        { pubkey: userXstockAta,    isSigner: false, isWritable: true  },
        { pubkey: vaultXstockAta,   isSigner: false, isWritable: true  },
        { pubkey: userReceiptAta,   isSigner: false, isWritable: true  },
        { pubkey: userPositionPda,  isSigner: false, isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      ],
      data: ixData,
    })
    tx.add(withdrawIx)

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64')

    res.json({
      ok: true,
      data: {
        transaction: serialized,
        blockhash,
        lastValidBlockHeight,
        asset,
        shares,
      }
    })
  } catch (err: any) {
    console.error('[Vault build-withdraw]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// GET /api/earn/vault/position?asset=TSLAx&wallet=xxx
// 查询用户在 vault 的仓位
router.get('/earn/vault/position', async (req, res) => {
  try {
    const { asset, wallet } = req.query as { asset: string; wallet: string }
    if (!asset || !wallet) return res.status(400).json({ ok: false, error: 'Missing asset or wallet' })

    const mintStr = XSTOCK_MINTS[asset]
    if (!mintStr) return res.status(400).json({ ok: false, error: `Unknown asset: ${asset}` })

    const { Connection, PublicKey } = require('@solana/web3.js')
    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const connection = new Connection(SOLANA_RPC, 'confirmed')

    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const xstockMint = new PublicKey(mintStr)
    const userPk     = new PublicKey(wallet)

    const { vaultPda, receiptMint } = deriveVaultPdas(xstockMint, programId)

    // Fetch vault state (discriminator + borsh layout)
    const VAULT_DISC = Buffer.from([211, 8, 232, 43, 2, 152, 117, 119])
    const vaultInfo = await connection.getAccountInfo(vaultPda)

    let nav = 1.0  // default 1:1 if vault not found
    let totalShares = 0
    if (vaultInfo?.data && vaultInfo.data.length >= 73) {
      const d = vaultInfo.data
      // Layout: disc(8) authority(32) xstock_mint(32) receipt_mint(32) total_deposited(8) total_shares(8)
      const totalDeposited = Number(d.readBigUInt64LE(8 + 32 + 32 + 32))
      totalShares = Number(d.readBigUInt64LE(8 + 32 + 32 + 32 + 8))
      nav = totalShares > 0 ? totalDeposited / totalShares : 1.0
    }

    // Fetch user position
    const [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()],
      programId
    )
    const posInfo = await connection.getAccountInfo(userPositionPda)

    let userShares = 0
    let depositedAmount = 0
    if (posInfo?.data && posInfo.data.length >= 57) {
      const d = posInfo.data
      // Layout: disc(8) owner(32) vault(32) deposited_amount(8) shares(8) deposit_timestamp(8)
      depositedAmount = Number(d.readBigUInt64LE(8 + 32 + 32))
      userShares = Number(d.readBigUInt64LE(8 + 32 + 32 + 8))
    }

    const currentValue = userShares * nav
    const DECIMALS = 6

    res.json({
      ok: true,
      data: {
        asset,
        vaultPda: vaultPda.toBase58(),
        receiptMint: receiptMint.toBase58(),
        userShares: userShares / 10 ** DECIMALS,
        depositedAmount: depositedAmount / 10 ** DECIMALS,
        currentValue: currentValue / 10 ** DECIMALS,
        nav: nav,  // current NAV per share
        pnl: (currentValue - depositedAmount) / 10 ** DECIMALS,
      }
    })
  } catch (err: any) {
    console.error('[Vault position]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// GET /api/earn/vault/positions?wallet=xxx
// 批量查询钱包在所有 xStock vault 的持仓，只返回 userShares > 0 的
router.get('/earn/vault/positions', async (req, res) => {
  try {
    const { wallet } = req.query as { wallet: string }
    if (!wallet) return res.status(400).json({ ok: false, error: 'Missing wallet' })

    const { Connection, PublicKey } = require('@solana/web3.js')
    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const programId  = new PublicKey(VAULT_PROGRAM_ID)
    const userPk     = new PublicKey(wallet)
    const DECIMALS   = 6

    const results = await Promise.all(
      Object.entries(XSTOCK_MINTS).map(async ([asset, mintStr]) => {
        try {
          const xstockMint = new PublicKey(mintStr)
          const { vaultPda, receiptMint } = deriveVaultPdas(xstockMint, programId)

          const [userPositionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('position'), vaultPda.toBuffer(), userPk.toBuffer()],
            programId
          )

          const [vaultInfo, posInfo] = await Promise.all([
            connection.getAccountInfo(vaultPda),
            connection.getAccountInfo(userPositionPda),
          ])

          if (!posInfo?.data || posInfo.data.length < 57) return null

          const pd = posInfo.data
          const depositedRaw = Number(pd.readBigUInt64LE(8 + 32 + 32))
          const sharesRaw    = Number(pd.readBigUInt64LE(8 + 32 + 32 + 8))
          if (sharesRaw === 0) return null

          let nav = 1.0
          if (vaultInfo?.data && vaultInfo.data.length >= 73) {
            const vd = vaultInfo.data
            const totalDeposited = Number(vd.readBigUInt64LE(8 + 32 + 32 + 32))
            const totalShares    = Number(vd.readBigUInt64LE(8 + 32 + 32 + 32 + 8))
            if (totalShares > 0) nav = totalDeposited / totalShares
          }

          const userShares     = sharesRaw    / 10 ** DECIMALS
          const depositedAmount= depositedRaw / 10 ** DECIMALS
          const currentValue   = (sharesRaw * nav) / 10 ** DECIMALS

          // Get deposit timestamp from first tx on the position PDA
          let depositedAt: string | null = null
          try {
            const sigs = await connection.getSignaturesForAddress(userPositionPda, { limit: 1 }, 'confirmed')
            if (sigs.length > 0 && sigs[0].blockTime) {
              depositedAt = new Date(sigs[0].blockTime * 1000).toISOString()
            }
          } catch { /* non-fatal */ }

          return {
            asset,
            vaultPda:     vaultPda.toBase58(),
            receiptMint:  receiptMint.toBase58(),
            userShares,
            depositedAmount,
            currentValue,
            nav,
            pnl: currentValue - depositedAmount,
            depositedAt,
          }
        } catch {
          return null
        }
      })
    )

    const positions = results.filter(Boolean)
    res.json({ ok: true, data: positions })
  } catch (err: any) {
    console.error('[Vault positions]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// GET /api/health
router.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})
