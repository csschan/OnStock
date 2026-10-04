/**
 * OSGateway API Routes (v4 — real DEX prices per chain)
 *
 * Buy/Sell use real DEX prices from the chain being traded on.
 * Cross-chain swap uses source chain sell price + dest chain buy price.
 * Only fee: 0.05% on cross-chain swaps.
 */

import { Router } from 'express'
import { ethers } from 'ethers'
import { ARBITRUM_CONFIG } from '../config/arbitrum.js'
import { latestPrices } from '../fetchers/stockprice.js'
import { getLatestPrices } from '../aggregator.js'
import { getMarketStatus } from '../config/marketStatus.js'

export const gatewayRouter = Router()

// ─── Load deployment ────────────────────────────────────────────────────────

interface GatewayDeployment {
  gateway: string
  pool: string
  osTokens: Record<string, string>
  usdc: string
}

function loadGatewayDeployment(): GatewayDeployment | null {
  try {
    const fs = require('fs')
    const path = require('path')
    const f = path.resolve(__dirname, '../../../xlayer-contracts/deployment-arbitrumSepolia.json')
    if (!fs.existsSync(f)) return null
    const data = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!data.gateway || !data.osTokens) return null
    return { gateway: data.gateway, pool: data.pool, osTokens: data.osTokens, usdc: data.usdc }
  } catch { return null }
}

const deployment = loadGatewayDeployment()
const provider = new ethers.JsonRpcProvider(ARBITRUM_CONFIG.rpc)
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || ''
const keeper = DEPLOYER_KEY ? new ethers.Wallet(DEPLOYER_KEY, provider) : null

const GATEWAY_ABI = [
  'function buy(string ticker, uint256 usdcAmount) returns (uint256)',
  'function sell(string ticker, uint256 tokenAmount) returns (uint256)',
  'function bridgeBurn(string ticker, uint256 tokenAmount, string destChain, string destAddress)',
  'function bridgeMint(string ticker, address to, uint256 usdcValue, string srcChain, uint256 srcNonce)',
  'function setPrice(string ticker, uint256 priceUsd, bool marketOpen)',
  'function setPriceBatch(string[] tickers, uint256[] prices, bool[] marketOpens)',
  'function getAsset(string ticker) view returns (address, uint256, uint256, bool, uint256, uint256)',
  'function assetCount() view returns (uint256)',
  'function bridgeFeeBps() view returns (uint256)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function mint(address to, uint256 amount)',
]

const POOL_ABI = [
  'function poolInfo() view returns (uint256, uint256, uint256, uint256)',
]

// ─── Helper: Get real DEX price per chain ───────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  arbitrum: 'ethereum',
  solana: 'solana',
  robinhood: 'robinhood-chain',
  bnb: 'bnb',
  ethereum: 'ethereum',
}

// Ticker → xStock symbol for aggregator lookup
const TICKER_TO_XSTOCK: Record<string, string> = {
  TSLA: 'TSLAx', NVDA: 'NVDAx', AAPL: 'AAPLx', SPY: 'SPYx',
  GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
}

interface PriceResult {
  price: number
  source: string
  liquidity: number
  allSources: { price: number; source: string; liquidity: number }[]
}

/**
 * Get optimal price for a chain.
 * side='sell' → highest price (sell expensive)
 * side='buy'  → lowest price (buy cheap)
 * side='best' → highest liquidity (default)
 */
async function getChainPrice(
  ticker: string,
  chain: string,
  side: 'sell' | 'buy' | 'best' = 'best',
): Promise<PriceResult | null> {
  try {
    const priceData = await getLatestPrices(ticker)
    const chainId = CHAIN_MAP[chain] ?? chain

    const chainSources = priceData.sources.filter(s => s.chain === chainId && s.dexPrice > 0)

    const allSources = chainSources.map(s => ({
      price: s.dexPrice,
      source: `${s.chain}/${s.issuer}`,
      liquidity: s.liquidityUsd ?? 0,
    }))

    if (chainSources.length > 0) {
      let best
      if (side === 'sell') {
        // Highest price = best for selling
        best = chainSources.reduce((a, b) => b.dexPrice > a.dexPrice ? b : a, chainSources[0])
      } else if (side === 'buy') {
        // Lowest price = best for buying
        best = chainSources.reduce((a, b) => b.dexPrice < a.dexPrice ? b : a, chainSources[0])
      } else {
        // Highest liquidity
        best = chainSources.reduce((a, b) =>
          (b.liquidityUsd ?? 0) > (a.liquidityUsd ?? 0) ? b : a, chainSources[0])
      }
      return {
        price: best.dexPrice,
        source: `${best.chain}/${best.issuer}`,
        liquidity: best.liquidityUsd ?? 0,
        allSources,
      }
    }

    // Fallback: any chain, same logic
    const allChainSources = priceData.sources.filter(s => s.dexPrice > 0)
    if (allChainSources.length > 0) {
      let best
      if (side === 'sell') {
        best = allChainSources.reduce((a, b) => b.dexPrice > a.dexPrice ? b : a, allChainSources[0])
      } else if (side === 'buy') {
        best = allChainSources.reduce((a, b) => b.dexPrice < a.dexPrice ? b : a, allChainSources[0])
      } else {
        best = allChainSources.reduce((a, b) =>
          (b.liquidityUsd ?? 0) > (a.liquidityUsd ?? 0) ? b : a, allChainSources[0])
      }
      return {
        price: best.dexPrice,
        source: `${best.chain}/${best.issuer} (fallback)`,
        liquidity: best.liquidityUsd ?? 0,
        allSources: allChainSources.map(s => ({
          price: s.dexPrice, source: `${s.chain}/${s.issuer}`, liquidity: s.liquidityUsd ?? 0,
        })),
      }
    }

    const yahoo = latestPrices.get(ticker)
    if (yahoo) return { price: yahoo, source: 'yahoo (fallback)', liquidity: 0, allSources: [] }
    return null
  } catch {
    const yahoo = latestPrices.get(ticker)
    if (yahoo) return { price: yahoo, source: 'yahoo (fallback)', liquidity: 0, allSources: [] }
    return null
  }
}

// ─── GET /api/gateway/info ──────────────────────────────────────────────────

gatewayRouter.get('/info', async (_req, res) => {
  if (!deployment) return res.json({ ok: false, error: 'Gateway not deployed' })

  try {
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, provider)
    const poolC = new ethers.Contract(deployment.pool, POOL_ABI, provider)
    const [count, bridgeFee, poolInfo] = await Promise.all([
      gw.assetCount(), gw.bridgeFeeBps(), poolC.poolInfo(),
    ])

    res.json({
      ok: true,
      data: {
        chain: 'arbitrum-sepolia',
        chainId: ARBITRUM_CONFIG.chainId,
        gateway: deployment.gateway,
        pool: deployment.pool,
        usdc: deployment.usdc,
        osTokens: deployment.osTokens,
        assetCount: Number(count),
        bridgeFeePct: Number(bridgeFee) / 100,
        tradeFeePct: 0.5, // buy/sell 0.5%
        poolReserve: Number(ethers.formatUnits(poolInfo[0], 6)),
        poolPendingOut: Number(ethers.formatUnits(poolInfo[2], 6)),
        solanaProgram: '76R7gyAYTFTnKPW3ePx44KTm1AQgRRqQopxTpGxpSy6G',
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── GET /api/gateway/asset/:ticker ─────────────────────────────────────────

gatewayRouter.get('/asset/:ticker', async (req, res) => {
  if (!deployment) return res.json({ ok: false, error: 'Not deployed' })

  try {
    const ticker = req.params.ticker.toUpperCase()
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, provider)
    const [osToken, priceUsd, lastUpdate, marketOpen, totalBought, totalSold] =
      await gw.getAsset(ticker)

    if (osToken === ethers.ZeroAddress) {
      return res.status(404).json({ ok: false, error: `Unknown: ${ticker}` })
    }

    // Get real DEX prices per chain — best sell price for display
    const [arbPrice, solPrice, rhPrice] = await Promise.all([
      getChainPrice(ticker, 'arbitrum', 'best'),
      getChainPrice(ticker, 'solana', 'best'),
      getChainPrice(ticker, 'robinhood', 'best'),
    ])

    const osContract = new ethers.Contract(osToken, ERC20_ABI, provider)
    const totalSupply = await osContract.totalSupply()
    const yahooPrice = latestPrices.get(ticker) ?? null

    res.json({
      ok: true,
      data: {
        ticker,
        osToken,
        oraclePrice: Number(priceUsd) / 1e6,
        yahooPrice,
        // Real DEX prices per chain
        prices: {
          arbitrum: arbPrice ? { price: arbPrice.price, source: arbPrice.source, liquidity: arbPrice.liquidity, allSources: arbPrice.allSources } : null,
          solana: solPrice ? { price: solPrice.price, source: solPrice.source, liquidity: solPrice.liquidity, allSources: solPrice.allSources } : null,
          robinhood: rhPrice ? { price: rhPrice.price, source: rhPrice.source, liquidity: rhPrice.liquidity, allSources: rhPrice.allSources } : null,
        },
        marketOpen,
        totalBought: Number(ethers.formatUnits(totalBought, 6)),
        totalSold: Number(ethers.formatUnits(totalSold, 6)),
        totalSupply: Number(ethers.formatUnits(totalSupply, 6)),
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── GET /api/gateway/prices ────────────────────────────────────────────────
// Returns all assets with per-chain prices for frontend

gatewayRouter.get('/prices', async (_req, res) => {
  try {
    const tickers = ['TSLA', 'NVDA', 'AAPL', 'SPY', 'GOOGL', 'META', 'COIN', 'MSTR']
    const results: Record<string, any> = {}

    await Promise.all(tickers.map(async (ticker) => {
      const [arbSell, arbBuy, solSell, solBuy, rhSell, rhBuy] = await Promise.all([
        getChainPrice(ticker, 'arbitrum', 'sell'),
        getChainPrice(ticker, 'arbitrum', 'buy'),
        getChainPrice(ticker, 'solana', 'sell'),
        getChainPrice(ticker, 'solana', 'buy'),
        getChainPrice(ticker, 'robinhood', 'sell'),
        getChainPrice(ticker, 'robinhood', 'buy'),
      ])
      const yahoo = latestPrices.get(ticker)

      const chains = [
        { name: 'arbitrum', sell: arbSell, buy: arbBuy },
        { name: 'solana', sell: solSell, buy: solBuy },
        { name: 'robinhood', sell: rhSell, buy: rhBuy },
      ]

      // Find best sell (highest) and best buy (lowest) across all chains
      const allSells = chains.filter(c => c.sell).map(c => ({ chain: c.name, price: c.sell!.price, source: c.sell!.source }))
      const allBuys = chains.filter(c => c.buy).map(c => ({ chain: c.name, price: c.buy!.price, source: c.buy!.source }))
      const bestSell = allSells.length ? allSells.reduce((a, b) => b.price > a.price ? b : a) : null
      const bestBuy = allBuys.length ? allBuys.reduce((a, b) => b.price < a.price ? b : a) : null

      results[ticker] = {
        yahoo,
        arbitrum: { bestSell: arbSell?.price, bestBuy: arbBuy?.price, sellSource: arbSell?.source, buySource: arbBuy?.source },
        solana: { bestSell: solSell?.price, bestBuy: solBuy?.price, sellSource: solSell?.source, buySource: solBuy?.source },
        robinhood: { bestSell: rhSell?.price, bestBuy: rhBuy?.price, sellSource: rhSell?.source, buySource: rhBuy?.source },
        bestArb: bestSell && bestBuy ? {
          sellChain: bestSell.chain,
          sellPrice: bestSell.price,
          sellSource: bestSell.source,
          buyChain: bestBuy.chain,
          buyPrice: bestBuy.price,
          buySource: bestBuy.source,
          spreadPct: ((bestSell.price - bestBuy.price) / bestBuy.price * 100).toFixed(3) + '%',
        } : null,
      }
    }))

    res.json({ ok: true, data: results })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/gateway/mint (buy) ───────────────────────────────────────────

gatewayRouter.post('/mint', async (req, res) => {
  if (!deployment) return res.json({ ok: false, error: 'Not deployed' })

  try {
    const { ticker, usdcAmount, walletAddress, chain: reqChain } = req.body as {
      ticker: string; usdcAmount: number; walletAddress: string; chain?: string
    }
    if (!ticker || !usdcAmount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const osTokenAddr = deployment.osTokens[tickerUp]
    if (!osTokenAddr) return res.status(400).json({ ok: false, error: `Unknown: ${tickerUp}` })

    // Get best buy price (lowest) on the trading chain
    const tradingChain = reqChain || 'arbitrum'
    const chainPrice = await getChainPrice(tickerUp, tradingChain, 'buy')
    if (!chainPrice) return res.status(400).json({ ok: false, error: `No price for ${tickerUp} on ${tradingChain}` })

    const price = chainPrice.price
    const priceUnits = Math.round(price * 1e6)
    const usdcUnits = ethers.parseUnits(usdcAmount.toString(), 6)

    // Push real DEX price to contract (testnet: always set marketOpen=true to avoid stale revert)
    if (keeper) {
      const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, keeper)
      try {
        await (await gw.setPrice(tickerUp, priceUnits, true)).wait()
        console.log(`[Gateway] Price pushed: ${tickerUp} = $${price.toFixed(2)}`)
      } catch (e: any) {
        console.error(`[Gateway] Price push failed: ${e.message?.slice(0, 60)}`)
      }
    }

    // Mint USDC to user only if balance insufficient (testnet)
    if (keeper) {
      const usdc = new ethers.Contract(deployment.usdc, ERC20_ABI, keeper)
      try {
        const bal = await usdc.balanceOf(walletAddress)
        if (bal < usdcUnits) {
          const deficit = usdcUnits - bal
          await (await usdc.mint(walletAddress, deficit)).wait()
        }
      } catch {}
    }

    // Build tx
    const usdcIface = new ethers.Interface(ERC20_ABI)
    const gwIface = new ethers.Interface(GATEWAY_ABI)

    const approveTx = {
      to: deployment.usdc,
      data: usdcIface.encodeFunctionData('approve', [deployment.gateway, usdcUnits]),
      chainId: ARBITRUM_CONFIG.chainId,
    }
    const mintTx = {
      to: deployment.gateway,
      data: gwIface.encodeFunctionData('buy', [tickerUp, usdcUnits]),
      chainId: ARBITRUM_CONFIG.chainId,
    }

    const tokenOut = (usdcAmount * 0.995) / price  // 0.5% fee

    res.json({
      ok: true,
      data: {
        chain: tradingChain,
        mode: 'buy',
        ticker: tickerUp,
        approveTx, mintTx,
        usdcIn: usdcAmount,
        price,
        priceSource: chainPrice.source,
        liquidity: chainPrice.liquidity,
        expectedTokenOut: Number(tokenOut.toFixed(6)),
        feePct: 0.5,
        osTokenAddress: osTokenAddr,
        explorer: ARBITRUM_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[Gateway Buy]', err)
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/gateway/redeem (sell) ────────────────────────────────────────

gatewayRouter.post('/redeem', async (req, res) => {
  if (!deployment) return res.json({ ok: false, error: 'Not deployed' })

  try {
    const { ticker, osAmount, walletAddress, chain: reqChain } = req.body as {
      ticker: string; osAmount: number; walletAddress: string; chain?: string
    }
    if (!ticker || !osAmount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const osTokenAddr = deployment.osTokens[tickerUp]
    if (!osTokenAddr) return res.status(400).json({ ok: false, error: `Unknown: ${tickerUp}` })

    // Get best sell price (highest) on the trading chain
    const tradingChain = reqChain || 'arbitrum'
    const chainPrice = await getChainPrice(tickerUp, tradingChain, 'sell')
    if (!chainPrice) return res.status(400).json({ ok: false, error: `No price for ${tickerUp}` })

    const price = chainPrice.price
    const priceUnits = Math.round(price * 1e6)
    const osUnits = ethers.parseUnits(osAmount.toString(), 6)

    // Push price (testnet: always marketOpen=true)
    if (keeper) {
      const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, keeper)
      try { await (await gw.setPrice(tickerUp, priceUnits, true)).wait() } catch {}
    }

    const osIface = new ethers.Interface(ERC20_ABI)
    const gwIface = new ethers.Interface(GATEWAY_ABI)

    const approveTx = {
      to: osTokenAddr,
      data: osIface.encodeFunctionData('approve', [deployment.gateway, osUnits]),
      chainId: ARBITRUM_CONFIG.chainId,
    }
    const redeemTx = {
      to: deployment.gateway,
      data: gwIface.encodeFunctionData('sell', [tickerUp, osUnits]),
      chainId: ARBITRUM_CONFIG.chainId,
    }

    const usdcOut = osAmount * price * 0.995  // 0.5% fee

    res.json({
      ok: true,
      data: {
        chain: tradingChain,
        mode: 'sell',
        ticker: tickerUp,
        approveTx, redeemTx,
        tokenIn: osAmount,
        price,
        priceSource: chainPrice.source,
        liquidity: chainPrice.liquidity,
        expectedUsdcOut: Number(usdcOut.toFixed(2)),
        feePct: 0.5,
        explorer: ARBITRUM_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[Gateway Sell]', err)
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/gateway/push-prices ──────────────────────────────────────────

gatewayRouter.post('/push-prices', async (_req, res) => {
  if (!deployment || !keeper) {
    return res.json({ ok: false, error: 'Not configured' })
  }

  try {
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, keeper)
    const market = getMarketStatus()

    const tickers: string[] = []
    const prices: bigint[] = []
    const marketOpens: boolean[] = []

    for (const ticker of Object.keys(deployment.osTokens)) {
      // Use real DEX price, fallback to Yahoo
      const chainPrice = await getChainPrice(ticker, 'solana')
      const price = chainPrice?.price ?? latestPrices.get(ticker)
      if (!price) continue
      tickers.push(ticker)
      prices.push(BigInt(Math.round(price * 1e6)))
      marketOpens.push(true) // testnet: always open to avoid stale revert
    }

    if (tickers.length === 0) return res.json({ ok: false, error: 'No prices' })

    const tx = await gw.setPriceBatch(tickers, prices, marketOpens)
    const receipt = await tx.wait()

    res.json({
      ok: true,
      data: { pushed: tickers.length, tickers, txHash: receipt.hash },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})
