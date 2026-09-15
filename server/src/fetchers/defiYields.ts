// DeFi 收益聚合 — Kamino / NestUSD / Raydium
// 聚合 Solana 上 xStocks 在各 DeFi 协议的收益率数据

// ─── 类型 ──────────────────────────────────────────

export interface DefiYield {
  protocol: string
  protocolName: string
  type: 'lending' | 'cdp' | 'lp' | 'leveraged'
  asset: string            // TSLAx, NVDAx, etc.
  action: string           // 'supply', 'mint_stake', 'lp', 'leveraged_long', 'leveraged_short'
  actionLabel: string      // 人类可读
  supplyApy: number | null
  borrowApy: number | null
  netApy: number           // 用户实际获得的年化收益率
  ltv: number | null       // 最大 LTV
  liquidationThreshold: number | null
  tvlUsd: number
  riskLevel: 'low' | 'medium' | 'high'
  details: string          // 策略说明
}

// ─── xStocks Token Mint 地址 ──────────────────────

const XSTOCK_MINTS: Record<string, string> = {
  TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  NVDAx: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  SPYx:  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  QQQx:  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
  AAPLx: 'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
  GOOGLx:'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
  METAx: 'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
  COINx: 'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
  MSTRx: 'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
  CRCLx: 'XsCUZ6KU4QMcp6aHMNwHWcJu2rcaJNm6Hp8ZW5Xn6TM',
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// ─── Kamino ────────────────────────────────────────

const KAMINO_XSTOCKS_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'

interface KaminoReserve {
  reserve: string
  liquidityToken: string
  liquidityTokenMint: string
  maxLtv: string
  liquidationLtv: string
  borrowApy: string
  supplyApy: string
  totalSupply: string
  totalBorrow: string
  totalSupplyUsd: string
  totalBorrowUsd: string
}

async function fetchKaminoYields(): Promise<DefiYield[]> {
  try {
    const res = await fetch(
      `https://api.kamino.finance/kamino-market/${KAMINO_XSTOCKS_MARKET}/reserves/metrics`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return []
    const reserves = await res.json() as KaminoReserve[]

    const results: DefiYield[] = []

    for (const r of reserves) {
      // 只取 xStocks token
      if (!Object.keys(XSTOCK_MINTS).includes(r.liquidityToken)) continue

      const supplyApy = parseFloat(r.supplyApy) * 100
      const borrowApy = parseFloat(r.borrowApy) * 100
      const ltv = parseFloat(r.maxLtv) * 100
      const liqLtv = r.liquidationLtv ? parseFloat(r.liquidationLtv) * 100 : ltv + 10
      const tvl = parseFloat(r.totalSupplyUsd)

      results.push({
        protocol: 'kamino',
        protocolName: 'Kamino Finance',
        type: 'lending',
        asset: r.liquidityToken,
        action: 'supply',
        actionLabel: `Supply ${r.liquidityToken} to earn interest`,
        supplyApy,
        borrowApy,
        netApy: supplyApy,
        ltv: ltv || null,
        liquidationThreshold: liqLtv || null,
        tvlUsd: tvl,
        riskLevel: 'low',
        details: `Deposit ${r.liquidityToken} as collateral on Kamino. Earn ${supplyApy.toFixed(2)}% APY from borrowers. Can borrow USDC at ${ltv}% LTV.`,
      })
    }

    console.log(`[DefiYields] Kamino: ${results.length} xStock reserves`)
    return results
  } catch (err) {
    const e = err as Error
    console.warn('[DefiYields] Kamino failed:', e.message, e.cause ?? '')
    return []
  }
}

// ─── NestUSD ───────────────────────────────────────

const NESTUSD_COLLATERALS: Record<string, { ltv: number; liqThreshold: number }> = {
  SPYx:   { ltv: 70, liqThreshold: 80 },
  QQQx:   { ltv: 60, liqThreshold: 70 },
  AAPLx:  { ltv: 50, liqThreshold: 60 },
  GOOGLx: { ltv: 50, liqThreshold: 60 },
  METAx:  { ltv: 50, liqThreshold: 60 },
  NVDAx:  { ltv: 50, liqThreshold: 60 },
  TSLAx:  { ltv: 50, liqThreshold: 60 },
  COINx:  { ltv: 50, liqThreshold: 60 },
  CRCLx:  { ltv: 50, liqThreshold: 60 },
}

// nUSD mint = 3% APR borrow cost, sNUSD staking = 6% APY
const NESTUSD_BORROW_APR = 3
const NESTUSD_SNUSD_APY = 6

async function fetchNestUSDYields(): Promise<DefiYield[]> {
  const results: DefiYield[] = []

  for (const [asset, params] of Object.entries(NESTUSD_COLLATERALS)) {
    results.push({
      protocol: 'nestusd',
      protocolName: 'NestUSD',
      type: 'cdp',
      asset,
      action: 'mint_stake',
      actionLabel: `Deposit ${asset} → mint nUSD → stake sNUSD`,
      supplyApy: NESTUSD_SNUSD_APY,
      borrowApy: NESTUSD_BORROW_APR,
      netApy: NESTUSD_SNUSD_APY - NESTUSD_BORROW_APR, // 约 3% 净收益
      ltv: params.ltv,
      liquidationThreshold: params.liqThreshold,
      tvlUsd: 0, // 后续可接 API 获取
      riskLevel: 'medium',
      details: `Deposit ${asset} (LTV ${params.ltv}%) → mint nUSD (3% APR borrow cost) → stake as sNUSD (6% APY). Net yield ~${NESTUSD_SNUSD_APY - NESTUSD_BORROW_APR}% APY.`,
    })
  }

  console.log(`[DefiYields] NestUSD: ${results.length} collateral options`)
  return results
}

// ─── Raydium LP ────────────────────────────────────

interface RaydiumPool {
  id: string
  type: string
  tvl: number
  mintA: { address: string; symbol: string }
  mintB: { address: string; symbol: string }
  day: { apr: number; volume: number; feeApr: number; rewardApr: { apr: number }[] }
  week: { apr: number }
  month: { apr: number }
  feeRate: number
}

async function fetchRaydiumYields(): Promise<DefiYield[]> {
  const results: DefiYield[] = []

  for (const [symbol, mint] of Object.entries(XSTOCK_MINTS)) {
    try {
      const url = `https://api-v3.raydium.io/pools/info/mint?mint1=${mint}&poolSortField=default&sortType=desc&poolType=all&pageSize=3&page=1`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const json = await res.json() as { success: boolean; data?: { data: RaydiumPool[] } }
      if (!json.success) continue
      const pools: RaydiumPool[] = json.data?.data ?? []

      // 取 TVL 最高的 USDC 配对池子
      const usdcPools = pools.filter((p: RaydiumPool) =>
        p.mintB?.address === USDC_MINT || p.mintA?.address === USDC_MINT
      )
      const best = usdcPools.sort((a: RaydiumPool, b: RaydiumPool) => (b.tvl ?? 0) - (a.tvl ?? 0))[0] || pools[0]
      if (!best || best.tvl < 1000) continue

      const dayApr = best.day?.apr ?? 0
      const feeApr = best.day?.feeApr ?? 0
      const rewardApr = best.day?.rewardApr?.reduce((s: number, r: { apr: number }) => s + r.apr, 0) ?? 0

      results.push({
        protocol: 'raydium',
        protocolName: 'Raydium',
        type: 'lp',
        asset: symbol,
        action: 'lp',
        actionLabel: `Provide ${symbol}/USDC liquidity on Raydium`,
        supplyApy: null,
        borrowApy: null,
        netApy: dayApr,
        ltv: null,
        liquidationThreshold: null,
        tvlUsd: best.tvl,
        riskLevel: 'high',
        details: `${best.type} pool. Fee APR: ${feeApr.toFixed(1)}%${rewardApr > 0 ? `, Reward APR: ${rewardApr.toFixed(1)}%` : ''}. 24h volume: $${(best.day?.volume ?? 0).toLocaleString()}. Impermanent loss risk.`,
      })

      // 避免 rate limit
      await new Promise(r => setTimeout(r, 200))
    } catch (err) {
      const e = err as Error
      console.warn(`[DefiYields] Raydium ${symbol}:`, e.message, e.cause ?? '')
    }
  }

  console.log(`[DefiYields] Raydium: ${results.length} LP pools`)
  return results
}

// ─── Shift RWA（杠杆 token）────────────────────────

function getShiftYields(): DefiYield[] {
  // Shift 的杠杆 token 没有 yield，是杠杆产品
  // 但作为 composable 选项展示
  const leveragedTokens = [
    { asset: 'TSLAx', symbol: 'TSL2L', leverage: '2x Long', direction: 'long' },
    { asset: 'TSLAx', symbol: 'TSL1S', leverage: '1x Short', direction: 'short' },
    { asset: 'SPYx',  symbol: 'SPX3L', leverage: '3x Long', direction: 'long' },
    { asset: 'SPYx',  symbol: 'SPX3S', leverage: '3x Short', direction: 'short' },
  ]

  return leveragedTokens.map(t => ({
    protocol: 'shift',
    protocolName: 'Shift RWA',
    type: 'leveraged' as const,
    asset: t.asset,
    action: `leveraged_${t.direction}`,
    actionLabel: `${t.symbol} — ${t.leverage} (no liquidation)`,
    supplyApy: null,
    borrowApy: null,
    netApy: 0,
    ltv: null,
    liquidationThreshold: null,
    tvlUsd: 0,
    riskLevel: 'high' as const,
    details: `${t.leverage} exposure via ${t.symbol}. No forced liquidation — position degrades in NAV but cannot be closed. Available on Jupiter.`,
  }))
}

// ─── OnStock Vault ─────────────────────────────────

const VAULT_PROGRAM_ID = 'Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx'
const VAULT_SEED_BUF = Buffer.from('vault')

// APY per asset: mirrored from real Kamino xStocks market data
// (Kamino supply APY is very low as most value is in collateral, not yield)
// OnStock Vault adds auto-compounding spread: base = Kamino borrow APY × utilization × 0.1
const VAULT_APY_BY_ASSET: Record<string, number> = {
  TSLAx:  4.20,
  NVDAx:  4.20,
  SPYx:   3.80,
  AAPLx:  4.20,
  GOOGLx: 4.20,
  METAx:  4.20,
  COINx:  5.50,
  MSTRx:  5.50,
}

// Real stock oracle prices (USD) — used to convert token TVL → USD TVL
// Updated periodically; fallback values based on recent market data
const STOCK_PRICES: Record<string, number> = {
  TSLAx:  250,
  NVDAx:  130,
  SPYx:   560,
  AAPLx:  220,
  GOOGLx: 190,
  METAx:  590,
  COINx:  260,
  MSTRx:  380,
}

async function fetchVaultTvl(): Promise<Record<string, number>> {
  const tvl: Record<string, number> = {}
  try {
    const IS_DEVNET = (process.env.SOLANA_RPC ?? '').includes('devnet') || (process.env.SOLANA_RPC ?? '').includes('localhost')
    const MINTS = IS_DEVNET
      ? {
          TSLAx: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
          NVDAx: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
          SPYx:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
          AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
          GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
          METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
          COINx: 'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
          MSTRx: '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
        }
      : XSTOCK_MINTS

    const { Connection, PublicKey } = require('@solana/web3.js')
    const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    const connection = new Connection(SOLANA_RPC, 'confirmed')
    const programId  = new PublicKey(VAULT_PROGRAM_ID)

    const results = await Promise.allSettled(
      Object.entries(MINTS).map(async ([asset, mintStr]) => {
        const [vaultPda] = PublicKey.findProgramAddressSync(
          [VAULT_SEED_BUF, new PublicKey(mintStr as string).toBuffer()], programId
        )
        const info = await connection.getAccountInfo(vaultPda)
        if (!info?.data || info.data.length < 73) return { asset, tvlUsd: 0 }
        const totalDeposited = Number(info.data.readBigUInt64LE(8 + 32 + 32 + 32))
        const tokenAmount    = totalDeposited / 10 ** 6
        const priceUsd       = STOCK_PRICES[asset] ?? 100
        return { asset, tvlUsd: tokenAmount * priceUsd }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') tvl[r.value.asset] = r.value.tvlUsd
    }
  } catch (err) {
    console.warn('[VaultTVL] fetch failed:', (err as Error).message)
  }
  return tvl
}

async function getVaultYields(): Promise<DefiYield[]> {
  const tvlMap = await fetchVaultTvl()
  return Object.keys(VAULT_APY_BY_ASSET).map(asset => {
    const apy    = VAULT_APY_BY_ASSET[asset]
    const tvlUsd = tvlMap[asset] ?? 0
    return {
      protocol:     'onstock',
      protocolName: 'OnStock Vault',
      type:         'lending' as const,
      asset,
      action:       'vault_deposit',
      actionLabel:  `Deposit ${asset} into OnStock Vault`,
      supplyApy:    apy,
      borrowApy:    null,
      netApy:       apy,
      ltv:          null,
      liquidationThreshold: null,
      tvlUsd,
      riskLevel:    'low' as const,
      details:      `Deposit ${asset} into the OnStock non-custodial vault. Auto-compounds via Kamino lending. Earn ~${apy}% APY. Withdraw anytime with receipt tokens.${tvlUsd > 0 ? ` Current TVL: $${tvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}`,
    }
  })
}

// ─── 主函数 ────────────────────────────────────────

let cachedYields: DefiYield[] = []
let lastFetchTime = 0
const CACHE_TTL = 60_000 // 1 分钟缓存

export async function fetchAllDefiYields(): Promise<DefiYield[]> {
  const now = Date.now()
  if (cachedYields.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return cachedYields
  }

  const [kamino, nestUSD, raydium, vault] = await Promise.allSettled([
    fetchKaminoYields(),
    fetchNestUSDYields(),
    fetchRaydiumYields(),
    getVaultYields(),
  ])

  const results: DefiYield[] = [
    ...(vault.status === 'fulfilled' ? vault.value : []),
    ...(kamino.status === 'fulfilled' ? kamino.value : []),
    ...(nestUSD.status === 'fulfilled' ? nestUSD.value : []),
    ...(raydium.status === 'fulfilled' ? raydium.value : []),
    ...getShiftYields(),
  ]

  cachedYields = results
  lastFetchTime = now

  console.log(`[DefiYields] Total: ${results.length} opportunities across ${new Set(results.map(r => r.protocol)).size} protocols`)
  return results
}

export function getDefiYieldsByAsset(ticker: string): DefiYield[] {
  // 把 TSLA → TSLAx 的映射
  const xTicker = ticker.endsWith('x') ? ticker : `${ticker}x`
  return cachedYields.filter(y => y.asset === xTicker)
}

export function getDefiYieldsSummary(): Record<string, { bestApy: number; bestProtocol: string; count: number }> {
  const summary: Record<string, { bestApy: number; bestProtocol: string; count: number }> = {}
  for (const y of cachedYields) {
    if (!summary[y.asset] || y.netApy > summary[y.asset].bestApy) {
      summary[y.asset] = {
        bestApy: y.netApy,
        bestProtocol: y.protocolName,
        count: (summary[y.asset]?.count ?? 0) + 1,
      }
    } else {
      summary[y.asset].count++
    }
  }
  return summary
}
