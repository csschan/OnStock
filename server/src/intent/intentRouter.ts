/**
 * OnStock Intent Router
 *
 * Dynamic routing engine: generates optimal execution paths
 * for a user's xStock exposure intent based on real-time market
 * signals (premium rate, momentum, APY).
 */

import { getLatestPrices, getPriceHistory } from '../aggregator.js'
import { fetchAllDefiYields } from '../fetchers/defiYields.js'
import { XLAYER_CONFIG, XLAYER_AAVE } from '../config/xlayer.js'

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
  // X Layer cross-chain info
  xlayerVaultApy: number
  // Routes (sorted by recommendation score)
  routes: RecommendedRoute[]
  // Summary headline
  marketSummary: string
  generatedAt: string
}

// ─── Pre-IPO tickers (no mainnet vault, no Kamino, swap-only) ───────────────

const PRE_IPO_TICKERS = new Set([
  'ANTHROPIC', 'OPENAI', 'SPACEX', 'ANDURIL', 'NEURALINK',
  'FIGUREAI', 'XAI', 'POLYMARKET', 'KALSHI',
])

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
  // PreStocks — pre-IPO tokens on Solana
  ANTHROPIC:  'ANTHROPIC',
  OPENAI:     'OPENAI',
  SPACEX:     'SPACEX',
  ANDURIL:    'ANDURIL',
  NEURALINK:  'NEURALINK',
  FIGUREAI:   'FIGUREAI',
  XAI:        'XAI',
  POLYMARKET: 'POLYMARKET',
  KALSHI:     'KALSHI',
}

// Solana mint address for Jupiter swap URL (PreStocks use mint address, xStocks use symbol)
const TICKER_TO_SOLANA_MINT: Record<string, string> = {
  ANTHROPIC:  'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
  OPENAI:     'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
  SPACEX:     'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh',
  ANDURIL:    'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
  NEURALINK:  'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
  FIGUREAI:   'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd',
  XAI:        'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
  POLYMARKET: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
  KALSHI:     'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua',
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
  vaultTvl: number
  kaminoTvl: number
}> {
  const yields = await fetchAllDefiYields()
  const vaultYield  = yields.find(y => y.protocol === 'onstock' && y.asset === xstockSymbol)
  const kaminoYield = yields.find(y => y.protocol === 'kamino'  && y.asset === xstockSymbol)
  return {
    vaultApy:   vaultYield?.netApy     ?? 4.2,
    kaminoApy:  kaminoYield?.supplyApy ?? 0,
    vaultTvl:   vaultYield?.tvlUsd     ?? 0,
    kaminoTvl:  kaminoYield?.tvlUsd    ?? 0,
  }
}

// ─── Pre-IPO route generation (buy/hold only, no vault/Kamino/leverage) ─────

function buildPreIpoRoutes(
  ticker: string,
  amountUsd: number,
  riskTolerance: 'low' | 'medium' | 'high',
  premiumPct: number,
  momentum24h: number,
  oraclePrice: number | null,
): RecommendedRoute[] {
  const routes: RecommendedRoute[] = []
  const mintAddress = TICKER_TO_SOLANA_MINT[ticker] ?? ticker
  const isDiscount = premiumPct < -0.5
  const isBullish = momentum24h > 1.0
  const isBearish = momentum24h < -2.0
  const isExpensive = premiumPct > 1.5
  const priceStr = oraclePrice ? `$${oraclePrice.toFixed(2)}` : 'unknown'
  const premiumLabel = premiumPct > 0
    ? `premium +${premiumPct.toFixed(2)}%`
    : `discount ${premiumPct.toFixed(2)}%`

  // Route 1: Direct buy (spot entry)
  routes.push({
    id: 'best_entry',
    title: isDiscount
      ? `Discount entry: buy ${ticker} below mark price`
      : `Buy ${ticker} on Jupiter`,
    tag: 'best_entry',
    tagLabel: isDiscount ? 'Discount opportunity' : 'Spot buy',
    steps: [
      {
        action: 'buy_spot',
        protocol: 'Jupiter',
        asset: ticker,
        amountUsd,
        description: isDiscount
          ? `Buy ${ticker} with $${amountUsd.toLocaleString()} USDC (${Math.abs(premiumPct).toFixed(2)}% below mark price — rare discount)`
          : `Buy ${ticker} with $${amountUsd.toLocaleString()} USDC (${premiumLabel}, mark price ${priceStr})`,
        url: `https://jup.ag/swap/USDC-${mintAddress}`,
      },
    ],
    projectedApy: null,
    totalAmountUsd: amountUsd,
    reasoning: isDiscount
      ? `${ticker} is trading ${Math.abs(premiumPct).toFixed(2)}% below its mark price — a discount entry on a pre-IPO token. These rarely go below mark; buying now gives immediate edge before the premium reverts.`
      : isBullish
      ? `${ticker} is up ${momentum24h.toFixed(1)}% in 24h with positive momentum. Pre-IPO tokens on Jupiter can move fast — buying with full position captures the upside directly.`
      : `Direct spot buy via Jupiter. ${ticker} is a pre-IPO token with no vault or lending — hold in wallet after purchase.`,
    warnings: isExpensive
      ? [`${ticker} is ${premiumPct.toFixed(2)}% above mark price — on-chain price exceeds the reference valuation`]
      : [],
    confidence: isDiscount ? 'high' : isBullish ? 'high' : 'medium',
  })

  // Route 2: Buy and hold (long-term conviction)
  if (!isBearish) {
    routes.push({
      id: 'max_yield',
      title: `Long-term hold: buy and hold ${ticker}`,
      tag: 'max_yield',
      tagLabel: 'Long-term hold',
      steps: [
        {
          action: 'buy_spot',
          protocol: 'Jupiter',
          asset: ticker,
          amountUsd,
          description: `Buy $${amountUsd.toLocaleString()} ${ticker} and hold in wallet — bet on pre-IPO valuation appreciation`,
          url: `https://jup.ag/swap/USDC-${mintAddress}`,
        },
      ],
      projectedApy: null,
      totalAmountUsd: amountUsd,
      reasoning: `${ticker} is a private company token. There is no vault yield or DeFi integration — this is a pure directional trade on the company's pre-IPO valuation. Suitable for investors with strong conviction on the company's long-term trajectory.`,
      warnings: [
        'Pre-IPO tokens carry illiquidity risk — on-chain liquidity may be limited compared to public stocks',
        'Mark price is indicative only; actual secondary market price may diverge significantly',
      ],
      confidence: 'medium',
    })
  }

  // Route 3: Defensive (small position, wait for better price)
  if (isBearish || isExpensive || riskTolerance === 'low') {
    const splitSpot = amountUsd * 0.3
    const holdUsdc = amountUsd * 0.7
    routes.push({
      id: 'defensive',
      title: isExpensive
        ? `Wait for mark price to catch up: small test position`
        : `Cautious entry: 30% position, hold rest in USDC`,
      tag: 'defensive',
      tagLabel: 'Low risk',
      steps: [
        {
          action: 'buy_spot',
          protocol: 'Jupiter',
          asset: ticker,
          amountUsd: splitSpot,
          description: `Buy only 30% ($${splitSpot.toLocaleString()}) now to test the position`,
          url: `https://jup.ag/swap/USDC-${mintAddress}`,
        },
        {
          action: 'hold_usdc',
          protocol: 'Wallet',
          asset: 'USDC',
          amountUsd: holdUsdc,
          description: `Hold 70% ($${holdUsdc.toLocaleString()}) in USDC — add more once ${isExpensive ? 'on-chain premium narrows' : isBearish ? 'price stabilizes' : 'a better entry appears'}`,
        },
      ],
      projectedApy: null,
      totalAmountUsd: amountUsd,
      reasoning: isExpensive
        ? `${ticker} on-chain price is ${premiumPct.toFixed(2)}% above mark — expensive entry. Start with 30% and wait for the premium to narrow before adding.`
        : isBearish
        ? `${ticker} dropped ${Math.abs(momentum24h).toFixed(1)}% in 24h. Pre-IPO tokens can be illiquid in downturns. Build a small initial position and wait for stabilization.`
        : `Conservative approach: take a small test position and hold the majority in USDC until you see a clearer signal.`,
      warnings: isExpensive
        ? [`Paying ${premiumPct.toFixed(2)}% above mark price — higher entry cost relative to reference valuation`]
        : isBearish
        ? [`Down ${Math.abs(momentum24h).toFixed(1)}% in 24h — bearish short-term trend`]
        : [],
      confidence: 'high',
    })
  }

  return routes.sort((a, b) => {
    if (a.disabled && !b.disabled) return 1
    if (!a.disabled && b.disabled) return -1
    return 0
  })
}

// ─── Route generation logic ─────────────────────────────────────────────────

// Minimum TVL (USD) required before recommending a pool
const MIN_POOL_TVL = 500

function selectBestYieldPool(
  vaultApy: number, vaultTvl: number,
  kaminoApy: number, kaminoTvl: number,
): { protocol: string; action: RouteAction; apy: number; tvl: number } {
  // Vault is always eligible — APY is deterministic (we control the contract).
  // Only gate Kamino by TVL to avoid routing into empty third-party pools.
  const kaminoEligible = kaminoTvl >= MIN_POOL_TVL && kaminoApy > 0

  if (!kaminoEligible) {
    return { protocol: 'OnStock Vault', action: 'vault_deposit', apy: vaultApy, tvl: vaultTvl }
  }
  // Kamino is eligible — APY difference < 1%: pick higher TVL; otherwise pick higher APY
  if (Math.abs(vaultApy - kaminoApy) < 1.0) {
    return vaultTvl >= kaminoTvl
      ? { protocol: 'OnStock Vault', action: 'vault_deposit', apy: vaultApy, tvl: vaultTvl }
      : { protocol: 'Kamino',        action: 'kamino_supply', apy: kaminoApy, tvl: kaminoTvl }
  }
  return vaultApy >= kaminoApy
    ? { protocol: 'OnStock Vault', action: 'vault_deposit', apy: vaultApy, tvl: vaultTvl }
    : { protocol: 'Kamino',        action: 'kamino_supply', apy: kaminoApy, tvl: kaminoTvl }
}

function buildRoutes(
  ticker: string,
  xstockSymbol: string,
  amountUsd: number,
  riskTolerance: 'low' | 'medium' | 'high',
  premiumPct: number,
  momentum24h: number,
  vaultApy: number,
  kaminoApy: number,
  vaultTvl: number,
  kaminoTvl: number,
  oraclePrice: number | null,
): RecommendedRoute[] {

  const routes: RecommendedRoute[] = []
  const best = selectBestYieldPool(vaultApy, vaultTvl, kaminoApy, kaminoTvl)
  const bestYieldApy      = best.apy
  const bestYieldProtocol = best.protocol
  const bestYieldAction   = best.action

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
          url: `https://jup.ag/swap/USDC-${TICKER_TO_SOLANA_MINT[ticker] ?? xstockSymbol}`,
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
    // Blend only when both pools have sufficient TVL and similar APY
    const splitVault = amountUsd * 0.7
    const splitKamino = amountUsd * 0.3
    const blendedApy = (vaultApy * 0.7 + kaminoApy * 0.3)
    const useBlend = kaminoApy > 0
      && Math.abs(vaultApy - kaminoApy) < 2
      && vaultTvl >= MIN_POOL_TVL
      && kaminoTvl >= MIN_POOL_TVL

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
              url: `https://jup.ag/swap/USDC-${TICKER_TO_SOLANA_MINT[ticker] ?? xstockSymbol}`,
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
              url: `https://jup.ag/swap/USDC-${TICKER_TO_SOLANA_MINT[ticker] ?? xstockSymbol}`,
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

  // ── Route 5: X Layer Cross-Chain (Vault vs Aave comparison) ────────────────
  {
    const xlayerVaultApyBps = XLAYER_CONFIG.apyBps[xstockSymbol] ?? 0
    const xlayerVaultApy = xlayerVaultApyBps / 100
    const xlayerAaveApy = XLAYER_AAVE.supplyApy[xstockSymbol] ?? 0

    if (xlayerVaultApy > 0 || xlayerAaveApy > 0) {
      // Pick the better X Layer yield
      const useAave = xlayerAaveApy > xlayerVaultApy
      const bestXlApy = Math.max(xlayerVaultApy, xlayerAaveApy)
      const bestXlProtocol = useAave ? 'Aave V3' : 'OnStock Vault'
      const bestXlAction = useAave ? 'kamino_supply' : 'vault_deposit'

      routes.push({
        id: 'best_entry',
        title: `Cross-chain: ${xstockSymbol} on X Layer via ${bestXlProtocol} (${bestXlApy.toFixed(1)}% APY)`,
        tag: 'max_yield',
        tagLabel: 'X Layer Vault',
        steps: [
          {
            action: 'buy_spot',
            protocol: 'Jupiter (Solana)',
            asset: xstockSymbol,
            amountUsd,
            description: `Buy ${xstockSymbol} with $${amountUsd.toLocaleString()} USDC on Solana via Jupiter`,
            url: `https://jup.ag/swap/USDC-${TICKER_TO_SOLANA_MINT[ticker] ?? xstockSymbol}`,
          },
          {
            action: bestXlAction,
            protocol: `${bestXlProtocol} (X Layer)`,
            asset: xstockSymbol,
            amountUsd,
            description: useAave
              ? `Supply ${xstockSymbol} to Aave V3 on X Layer to earn ${xlayerAaveApy.toFixed(2)}% supply APY`
              : `Deposit into ERC4626 Vault on X Layer to earn ${xlayerVaultApy.toFixed(2)}% APY`,
            apy: bestXlApy,
          },
        ],
        projectedApy: bestXlApy,
        totalAmountUsd: amountUsd,
        reasoning: useAave
          ? `Aave V3 on X Layer offers ${xlayerAaveApy.toFixed(1)}% supply APY for ${xstockSymbol}, higher than the X Layer Vault (${xlayerVaultApy.toFixed(1)}%). Aave's deep liquidity pool and battle-tested smart contracts make this a reliable yield source on OKX's L2.`
          : `OnStock Vault on X Layer offers ${xlayerVaultApy.toFixed(1)}% APY for ${xstockSymbol}, higher than Aave (${xlayerAaveApy.toFixed(1)}%). Lower L2 gas costs make frequent compounding more efficient than mainnet.`,
        warnings: [
          'Cross-chain execution requires bridging assets from Solana to X Layer',
          `Alternative: ${useAave ? `OnStock Vault ${xlayerVaultApy.toFixed(1)}% APY` : `Aave V3 ${xlayerAaveApy.toFixed(1)}% APY`} also available on X Layer`,
        ],
        confidence: 'medium',
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

  const isPreIpo = PRE_IPO_TICKERS.has(ticker)

  const signals = await readMarketSignals(ticker)
  const { oraclePrice, onchainPrice, premiumPct, momentum24h } = signals

  // Pre-IPO tokens: no vault, no Kamino, no leverage — swap-only routes
  if (isPreIpo) {
    const routes = buildPreIpoRoutes(
      ticker,
      req.amountUsd,
      req.riskTolerance,
      premiumPct,
      momentum24h,
      oraclePrice,
    )
    const priceStr = oraclePrice ? `$${oraclePrice.toFixed(2)}` : 'unknown'
    const premiumStr = premiumPct > 0
      ? `on-chain premium +${premiumPct.toFixed(2)}%`
      : `on-chain discount ${premiumPct.toFixed(2)}%`
    const momentumStr = momentum24h > 0
      ? `up ${momentum24h.toFixed(1)}% in 24h`
      : `down ${Math.abs(momentum24h).toFixed(1)}% in 24h`
    return {
      asset: ticker,
      xstockSymbol,
      amountUsd: req.amountUsd,
      oraclePrice,
      onchainPrice,
      premiumPct,
      momentum24h,
      bestVaultApy: 0,
      bestKaminoApy: 0,
      xlayerVaultApy: 0,
      routes,
      marketSummary: `${ticker} mark price ${priceStr}, ${premiumStr}, ${momentumStr} — pre-IPO token, tradeable on Jupiter`,
      generatedAt: new Date().toISOString(),
    }
  }

  // xStocks: full route generation with vault + Kamino + leverage
  const apys = await readApySignals(xstockSymbol)
  const { vaultApy, kaminoApy, vaultTvl, kaminoTvl } = apys

  const routes = buildRoutes(
    ticker,
    xstockSymbol,
    req.amountUsd,
    req.riskTolerance,
    premiumPct,
    momentum24h,
    vaultApy,
    kaminoApy,
    vaultTvl,
    kaminoTvl,
    oraclePrice,
  )

  const xlayerApyBps = XLAYER_CONFIG.apyBps[xstockSymbol] ?? 0

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
    xlayerVaultApy: xlayerApyBps / 100,
    routes,
    marketSummary: buildMarketSummary(xstockSymbol, premiumPct, momentum24h, oraclePrice),
    generatedAt: new Date().toISOString(),
  }
}
