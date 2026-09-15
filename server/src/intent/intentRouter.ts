/**
 * OnStock Intent Router
 *
 * Dynamic routing engine: generates optimal execution paths
 * for a user's xStock exposure intent based on real-time market
 * signals (premium rate, momentum, APY).
 */

import { getLatestPrices, getPriceHistory } from '../aggregator.js'
import { fetchAllDefiYields } from '../fetchers/defiYields.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntentRequest {
  asset: string                          // 'TSLA', 'NVDA', etc. (ticker, not xStock symbol)
  amountUsd: number
  riskTolerance: 'low' | 'medium' | 'high'
}

export type RouteAction =
  | 'buy_spot'        // Buy xStock via Jupiter
  | 'vault_deposit'   // Deposit into OnStock Vault
  | 'kamino_supply'   // Supply directly to Kamino
  | 'shift_long'      // Shift leveraged long
  | 'shift_short'     // Shift leveraged short (hedge)
  | 'hold_usdc'       // Hold USDC and wait for entry

export interface RouteStep {
  action: RouteAction
  protocol: string
  asset: string
  amountUsd: number
  description: string
  apy?: number
  leverage?: string
  url?: string
}

export type RouteTag = 'best_entry' | 'max_yield' | 'leveraged' | 'defensive'

export interface RecommendedRoute {
  id: RouteTag
  title: string
  tag: RouteTag
  tagLabel: string
  steps: RouteStep[]
  projectedApy: number | null
  totalAmountUsd: number
  reasoning: string
  warnings: string[]
  confidence: 'high' | 'medium' | 'low'
  disabled?: boolean
  disabledReason?: string
}

export interface IntentRouterResult {
  asset: string
  xstockSymbol: string
  amountUsd: number
  // Market signals
  oraclePrice: number | null
  onchainPrice: number | null
  premiumPct: number          // positive = overpriced vs real stock
  momentum24h: number         // 24h price change %
  bestVaultApy: number
  bestKaminoApy: number
  // Routes (sorted by recommendation score)
  routes: RecommendedRoute[]
  // Summary headline
  marketSummary: string
  generatedAt: string
}

// ─── Ticker → xStock symbol mapping ────────────────────────────────────────

const TICKER_TO_XSTOCK: Record<string, string> = {
  TSLA:  'TSLAx',
  NVDA:  'NVDAx',
  SPY:   'SPYx',
  QQQ:   'QQQx',
  AAPL:  'AAPLx',
  GOOGL: 'GOOGLx',
  META:  'METAx',
  COIN:  'COINx',
  MSTR:  'MSTRx',
  CRCL:  'CRCLx',
}

const SHIFT_TOKENS: Record<string, { long2x: string; short1x: string }> = {
  TSLA: { long2x: 'TSL2L', short1x: 'TSL1S' },
  SPY:  { long2x: 'SPX3L', short1x: 'SPX3S' },
}

// ─── Read market signals ────────────────────────────────────────────────────

async function readMarketSignals(ticker: string): Promise<{
  oraclePrice: number | null
  onchainPrice: number | null
  premiumPct: number
  momentum24h: number
}> {
  const [priceData, history] = await Promise.all([
    getLatestPrices(ticker),
    getPriceHistory(ticker, 24),
  ])

  const oraclePrice = priceData.oraclePrice ?? null

  // Pick the best on-chain buy price on Solana (highest liquidity source)
  const solanaSources = priceData.sources.filter(s => s.chain === 'solana')
  const bestSource = solanaSources.length > 0
    ? solanaSources.reduce((best, s) =>
        (s.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0) ? s : best,
        solanaSources[0])
    : priceData.sources[0] ?? null

  const onchainPrice = bestSource?.dexPrice ?? null
  const premiumPct = (onchainPrice && oraclePrice)
    ? ((onchainPrice - oraclePrice) / oraclePrice) * 100
    : 0

  // 24h momentum: compare earliest and latest oracle prices
  let momentum24h = 0
  if (history.length >= 2) {
    const oldest = history[0]
    const newest = history[history.length - 1]
    const oldPrice = oldest.oraclePrice ?? oldest.dexPrice
    const newPrice = newest.oraclePrice ?? newest.dexPrice
    if (oldPrice && newPrice && oldPrice > 0) {
      momentum24h = ((newPrice - oldPrice) / oldPrice) * 100
    }
  }

  return { oraclePrice, onchainPrice, premiumPct, momentum24h }
}

async function readApySignals(xstockSymbol: string): Promise<{
  vaultApy: number
  kaminoApy: number
}> {
  const yields = await fetchAllDefiYields()
  const vaultYield = yields.find(y => y.protocol === 'onstock' && y.asset === xstockSymbol)
  const kaminoYield = yields.find(y => y.protocol === 'kamino' && y.asset === xstockSymbol)
  return {
    vaultApy: vaultYield?.netApy ?? 4.2,
    kaminoApy: kaminoYield?.supplyApy ?? 0,
  }
}

// ─── Route generation logic ─────────────────────────────────────────────────

function buildRoutes(
  ticker: string,
  xstockSymbol: string,
  amountUsd: number,
  riskTolerance: 'low' | 'medium' | 'high',
  premiumPct: number,
  momentum24h: number,
  vaultApy: number,
  kaminoApy: number,
  oraclePrice: number | null,
): RecommendedRoute[] {

  const routes: RecommendedRoute[] = []
  const bestYieldApy = Math.max(vaultApy, kaminoApy)
  const bestYieldProtocol = vaultApy >= kaminoApy ? 'OnStack Vault' : 'Kamino'
  const bestYieldAction: RouteAction = vaultApy >= kaminoApy ? 'vault_deposit' : 'kamino_supply'

  const premiumLabel = premiumPct > 0
    ? `premium +${premiumPct.toFixed(2)}%`
    : `discount ${premiumPct.toFixed(2)}%`

  const shiftTokens = SHIFT_TOKENS[ticker]

  // ── Route 1: Best Entry (spot buy + Vault) ────────────────────────────────
  {
    const isGoodEntry = premiumPct < 1.0
    const isDiscount = premiumPct < -0.5

    const buyAmount = amountUsd
    const warnings: string[] = []

    if (premiumPct > 0.5 && premiumPct <= 1.5) {
      warnings.push(`${xstockSymbol} currently has a ${premiumPct.toFixed(2)}% premium, slightly above the real stock price`)
    }
    if (premiumPct > 1.5) {
      warnings.push(`${xstockSymbol} premium of ${premiumPct.toFixed(2)}% is high — consider waiting for the premium to narrow before entering`)
    }

    routes.push({
      id: 'best_entry',
      title: isDiscount
        ? `Discount entry + deposit in Vault to earn yield`
        : `Spot buy + deposit in Vault to earn yield`,
      tag: 'best_entry',
      tagLabel: isDiscount ? 'Discount opportunity' : 'Steady entry',
      steps: [
        {
          action: 'buy_spot',
          protocol: 'Jupiter',
          asset: xstockSymbol,
          amountUsd: buyAmount,
          description: isDiscount
            ? `Buy ${xstockSymbol} with $${buyAmount.toLocaleString()} USDC (currently at ${Math.abs(premiumPct).toFixed(2)}% discount, below the real stock price)`
            : `Buy ${xstockSymbol} with $${buyAmount.toLocaleString()} USDC (${premiumLabel})`,
          url: `https://jup.ag/swap/USDC-${xstockSymbol}`,
        },
        {
          action: bestYieldAction,
          protocol: bestYieldProtocol,
          asset: xstockSymbol,
          amountUsd: buyAmount,
          description: `Deposit all ${xstockSymbol} into ${bestYieldProtocol} to automatically earn ${bestYieldApy.toFixed(2)}% APY`,
          apy: bestYieldApy,
        },
      ],
      projectedApy: bestYieldApy,
      totalAmountUsd: amountUsd,
      reasoning: isDiscount
        ? `${xstockSymbol} on-chain price is currently ${Math.abs(premiumPct).toFixed(2)}% below the real stock price — a rare discount entry opportunity. After buying, deposit into ${bestYieldProtocol} to earn an additional ${bestYieldApy.toFixed(1)}% APY. Total return = stock appreciation + DeFi yield.`
        : isGoodEntry
        ? `${xstockSymbol} premium is reasonable (${premiumLabel}), good for direct entry. After depositing into ${bestYieldProtocol}, earn ${bestYieldApy.toFixed(1)}% annual yield while holding — like owning the stock with a dividend.`
        : `${xstockSymbol} currently at ${premiumLabel}, entry cost is slightly high. If you're still bullish long-term, buy and deposit into ${bestYieldProtocol} to offset holding costs with yield.`,
      warnings,
      confidence: isGoodEntry ? 'high' : premiumPct < 2.0 ? 'medium' : 'low',
    })
  }

  // ── Route 2: Max Yield (maximize yield as the objective) ──────────────────
  {
    // Compare: full position Vault vs full position Kamino vs split strategy
    const splitVault = amountUsd * 0.7
    const splitKamino = amountUsd * 0.3
    const blendedApy = (vaultApy * 0.7 + kaminoApy * 0.3)
    const useBlend = kaminoApy > 0 && Math.abs(vaultApy - kaminoApy) < 2

    routes.push({
      id: 'max_yield',
      title: useBlend
        ? `Maximize yield: Vault + Kamino combo`
        : `Maximize yield: full position in ${bestYieldProtocol}`,
      tag: 'max_yield',
      tagLabel: 'Highest yield',
      steps: useBlend
        ? [
            {
              action: 'buy_spot',
              protocol: 'Jupiter',
              asset: xstockSymbol,
              amountUsd,
              description: `Buy $${amountUsd.toLocaleString()} ${xstockSymbol}`,
              url: `https://jup.ag/swap/USDC-${xstockSymbol}`,
            },
            {
              action: 'vault_deposit',
              protocol: 'OnStock Vault',
              asset: xstockSymbol,
              amountUsd: splitVault,
              description: `70% ($${splitVault.toLocaleString()}) deposited into OnStock Vault (${vaultApy.toFixed(2)}% APY)`,
              apy: vaultApy,
            },
            {
              action: 'kamino_supply',
              protocol: 'Kamino',
              asset: xstockSymbol,
              amountUsd: splitKamino,
              description: `30% ($${splitKamino.toLocaleString()}) supplied to Kamino (${kaminoApy.toFixed(2)}% APY + LTV allows borrowing USDC)`,
              apy: kaminoApy,
            },
          ]
        : [
            {
              action: 'buy_spot',
              protocol: 'Jupiter',
              asset: xstockSymbol,
              amountUsd,
              description: `Buy $${amountUsd.toLocaleString()} ${xstockSymbol}`,
              url: `https://jup.ag/swap/USDC-${xstockSymbol}`,
            },
            {
              action: bestYieldAction,
              protocol: bestYieldProtocol,
              asset: xstockSymbol,
              amountUsd,
              description: `Deposit all into ${bestYieldProtocol} to earn ${bestYieldApy.toFixed(2)}% APY`,
              apy: bestYieldApy,
            },
          ],
      projectedApy: useBlend ? blendedApy : bestYieldApy,
      totalAmountUsd: amountUsd,
      reasoning: useBlend
        ? `Vault and Kamino yields are similar. Split strategy: 70% in Vault for auto-compounding, 30% in Kamino to retain LTV borrowing capacity. Blended APY ${blendedApy.toFixed(2)}% while maintaining flexibility.`
        : `${bestYieldProtocol} currently offers the highest yield for ${xstockSymbol} (${bestYieldApy.toFixed(2)}% APY). ${bestYieldApy > 5 ? 'Yield significantly exceeds traditional stock dividends — full position recommended.' : 'Stable yield, low risk.'}`,
      warnings: premiumPct > 1.5
        ? [`${xstockSymbol} premium is ${premiumPct.toFixed(2)}% — higher entry cost means longer time to break even on yield`]
        : [],
      confidence: kaminoApy > 0 ? 'high' : 'medium',
    })
  }

  // ── Route 3: Leveraged (momentum-driven, shown for medium/high risk only) ─
  if (riskTolerance !== 'low' && shiftTokens) {
    const isBullish = momentum24h > 1.0
    const isDip = momentum24h < -2.0 && premiumPct < 0.5
    const isOverpriced = premiumPct > 1.5

    const leveragedToken = isBullish || isDip
      ? shiftTokens.long2x
      : isOverpriced
      ? shiftTokens.short1x
      : shiftTokens.long2x

    const isLong = leveragedToken === shiftTokens.long2x
    const leverageLabel = isLong ? '2x Long' : '1x Short'

    const disabled = !isBullish && !isDip && !isOverpriced && momentum24h > -1 && premiumPct < 0.5
    const disabledReason = disabled
      ? `No clear momentum signal (24h change ${momentum24h > 0 ? '+' : ''}${momentum24h.toFixed(1)}%) — leveraged entry has unfavorable risk/reward`
      : undefined

    routes.push({
      id: 'leveraged',
      title: isLong
        ? `Momentum leveraged: ${leveragedToken} (2x Long)`
        : `Premium hedge: ${leveragedToken} (1x Short)`,
      tag: 'leveraged',
      tagLabel: isLong ? 'High risk/reward' : 'Hedge overbought',
      disabled,
      disabledReason,
      steps: [
        {
          action: isLong ? 'shift_long' : 'shift_short',
          protocol: 'Shift RWA via Jupiter',
          asset: leveragedToken,
          amountUsd,
          description: isLong
            ? `Buy ${leveragedToken} with $${amountUsd.toLocaleString()} (2x long exposure, no liquidation, NAV decay mechanism)`
            : `Buy ${leveragedToken} with $${amountUsd.toLocaleString()} (1x short hedge, offsets ${xstockSymbol} premium risk)`,
          leverage: leverageLabel,
          url: `https://jup.ag/swap/USDC-${leveragedToken}`,
        },
      ],
      projectedApy: null,
      totalAmountUsd: amountUsd,
      reasoning: isDip
        ? `${xstockSymbol} dropped ${Math.abs(momentum24h).toFixed(1)}% in 24h with no significant on-chain premium — a leveraged dip-buy signal. ${leveragedToken} provides 2x long exposure with no liquidation, suitable for short-term directional trades.`
        : isBullish
        ? `${xstockSymbol} up ${momentum24h.toFixed(1)}% in 24h with strong momentum. ${leveragedToken} amplifies upside gains with no liquidation risk, but NAV decays daily — best held for 1-7 days.`
        : `${xstockSymbol} on-chain premium is ${premiumPct.toFixed(2)}%, spot is expensive. Use ${leveragedToken} to short-hedge — profit if the premium narrows, while hedging spot position risk.`,
      warnings: [
        'Leveraged tokens have daily NAV decay (~0.1%/day) and are not suitable for long-term holding',
        'Recommended holding period is under 7 days — set take-profit and stop-loss levels',
        ...(riskTolerance === 'medium' ? ['Your risk tolerance is medium — please manage position size accordingly'] : []),
      ],
      confidence: (isBullish || isDip) ? 'high' : isOverpriced ? 'medium' : 'low',
    })
  }

  // ── Route 4: Defensive (recommended when premium is too high or bearish) ──
  {
    const isBearish = momentum24h < -3.0
    const isVeryExpensive = premiumPct > 2.0

    if (isBearish || isVeryExpensive || riskTolerance === 'low') {
      const splitSpot = amountUsd * 0.4
      const holdUsdc = amountUsd * 0.6

      routes.push({
        id: 'defensive',
        title: isVeryExpensive
          ? 'Wait for premium to narrow: dollar-cost average in'
          : isBearish
          ? 'Defensive strategy: light position + hold USDC'
          : 'Conservative strategy: small test position',
        tag: 'defensive',
        tagLabel: isVeryExpensive ? 'Wait for opportunity' : 'Low risk',
        steps: [
          {
            action: 'buy_spot',
            protocol: 'Jupiter',
            asset: xstockSymbol,
            amountUsd: splitSpot,
            description: `Start with 40% ($${splitSpot.toLocaleString()}) to buy ${xstockSymbol}, reducing average cost risk`,
            url: `https://jup.ag/swap/USDC-${xstockSymbol}`,
          },
          {
            action: 'vault_deposit',
            protocol: 'OnStock Vault',
            asset: xstockSymbol,
            amountUsd: splitSpot,
            description: `Deposit purchased portion into Vault to earn ${vaultApy.toFixed(1)}% APY while waiting`,
            apy: vaultApy,
          },
          {
            action: 'hold_usdc',
            protocol: 'Wallet',
            asset: 'USDC',
            amountUsd: holdUsdc,
            description: `Hold remaining 60% ($${holdUsdc.toLocaleString()}) in USDC, add to position after ${isVeryExpensive ? `premium drops below 0.5%` : isBearish ? `price stabilizes` : `a better entry opportunity`}`,
          },
        ],
        projectedApy: vaultApy * 0.4,
        totalAmountUsd: amountUsd,
        reasoning: isVeryExpensive
          ? `${xstockSymbol} premium is currently ${premiumPct.toFixed(2)}% — on-chain price is significantly above the real stock price. Recommend building a 40% position first, holding the rest in USDC until the premium narrows (historically reverts within 1-3 days).`
          : isBearish
          ? `${xstockSymbol} dropped ${Math.abs(momentum24h).toFixed(1)}% in 24h, market sentiment is bearish. Build a light base position, keep most USDC in reserve, and add once the trend is clearer.`
          : `Conservative strategy: buy a 40% position and deposit in Vault to earn yield, hold the rest in USDC for flexibility to enter at a better price.`,
        warnings: isVeryExpensive
          ? [`${xstockSymbol} premium is ${premiumPct.toFixed(2)}% — going full position now could mean an immediate ${premiumPct.toFixed(2)}% loss`]
          : isBearish
          ? [`Down ${Math.abs(momentum24h).toFixed(1)}% in the past 24h — short-term downtrend may not have ended`]
          : [],
        confidence: 'high',
      })
    }
  }

  // Sort by recommendation priority (disabled routes go last)
  return routes.sort((a, b) => {
    if (a.disabled && !b.disabled) return 1
    if (!a.disabled && b.disabled) return -1
    return 0
  })
}

// ─── Market summary text generation ─────────────────────────────────────────

function buildMarketSummary(
  xstockSymbol: string,
  premiumPct: number,
  momentum24h: number,
  oraclePrice: number | null,
): string {
  const priceStr = oraclePrice ? `$${oraclePrice.toFixed(2)}` : 'unknown'
  const premiumStr = premiumPct > 0
    ? `on-chain premium +${premiumPct.toFixed(2)}%`
    : `on-chain discount ${premiumPct.toFixed(2)}%`
  const momentumStr = momentum24h > 0
    ? `up ${momentum24h.toFixed(1)}% in 24h`
    : `down ${Math.abs(momentum24h).toFixed(1)}% in 24h`

  if (premiumPct < -0.5 && momentum24h > 0) {
    return `${xstockSymbol} ${premiumStr} (oracle price ${priceStr}), ${momentumStr} — discount + upward momentum, rare opportunity`
  }
  if (premiumPct > 2.0) {
    return `${xstockSymbol} ${premiumStr} (oracle price ${priceStr}), ${momentumStr} — on-chain price is expensive, consider waiting for premium to narrow`
  }
  if (momentum24h < -3.0) {
    return `${xstockSymbol} oracle price ${priceStr}, ${momentumStr}, ${premiumStr} — market declining, proceed with caution`
  }
  if (momentum24h > 3.0) {
    return `${xstockSymbol} oracle price ${priceStr}, ${momentumStr}, ${premiumStr} — strong uptrend`
  }
  return `${xstockSymbol} oracle price ${priceStr}, ${premiumStr}, ${momentumStr}`
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function routeIntent(req: IntentRequest): Promise<IntentRouterResult> {
  const ticker = req.asset.toUpperCase()
  const xstockSymbol = TICKER_TO_XSTOCK[ticker]
  if (!xstockSymbol) {
    throw new Error(`Unsupported asset: ${ticker}. Supported: ${Object.keys(TICKER_TO_XSTOCK).join(', ')}`)
  }

  const [signals, apys] = await Promise.all([
    readMarketSignals(ticker),
    readApySignals(xstockSymbol),
  ])

  const { oraclePrice, onchainPrice, premiumPct, momentum24h } = signals
  const { vaultApy, kaminoApy } = apys

  const routes = buildRoutes(
    ticker,
    xstockSymbol,
    req.amountUsd,
    req.riskTolerance,
    premiumPct,
    momentum24h,
    vaultApy,
    kaminoApy,
    oraclePrice,
  )

  return {
    asset: ticker,
    xstockSymbol,
    amountUsd: req.amountUsd,
    oraclePrice,
    onchainPrice,
    premiumPct,
    momentum24h,
    bestVaultApy: vaultApy,
    bestKaminoApy: kaminoApy,
    routes,
    marketSummary: buildMarketSummary(xstockSymbol, premiumPct, momentum24h, oraclePrice),
    generatedAt: new Date().toISOString(),
  }
}
