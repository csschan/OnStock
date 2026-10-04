/**
 * Robinhood Chain Gateway API Routes
 *
 * Unlike Arbitrum/Solana where we use mock tokens, Robinhood testnet has
 * REAL stock tokens (TSLA, AMZN, PLTR, etc.) issued by Robinhood.
 *
 * Flow:
 *   Buy:  Faucet gives user stock tokens directly (no Gateway needed for testnet)
 *   Sell: User transfers stock token to Gateway → receives USDC from Pool
 *   Swap: User transfers stock token to Gateway → Gateway mints osToken on dest chain
 *
 * The Gateway contract on Robinhood holds stock tokens in escrow.
 * For cross-chain: stock token locked on Robinhood → osToken minted on Arbitrum/Solana.
 */

import { Router } from 'express'
import { ethers } from 'ethers'
import { ROBINHOOD_CONFIG, loadRobinhoodDeployment } from '../config/robinhood.js'
import { latestPrices } from '../fetchers/stockprice.js'
import { getLatestPrices } from '../aggregator.js'

export const robinhoodGatewayRouter = Router()

const deployment = loadRobinhoodDeployment()
const provider = deployment ? new ethers.JsonRpcProvider(ROBINHOOD_CONFIG.rpc) : null
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || ''
const keeper = (DEPLOYER_KEY && provider) ? new ethers.Wallet(DEPLOYER_KEY, provider) : null

console.log(`[RH-Gateway] deployment: ${deployment ? 'loaded (gw=' + deployment.gateway?.slice(0, 10) + ')' : 'NOT FOUND'}`)
console.log(`[RH-Gateway] keeper: ${keeper ? 'set' : 'MISSING'}`)

// Robinhood official stock token addresses (testnet)
const RH_STOCK_TOKENS: Record<string, string> = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  AAPL: '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2',
  NVDA: '0x2C00c9B4F9b682dee1b0ED2401BDE214CaC437BA',
  AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
  NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  AMD:  '0x71178BAc73cBeb415514eB542a8995b82669778d',
  META: '0xB890131F655B4c36B685cF48d61754FDf4638890',
  SPY:  '0x8823b40A23387Df76E127744FFb38b26eB012A5c',
  GOOGL:'0x02f86DcC514C4974A0664f7364F93382997A01F6',
  MSTR: '0x26F05be33fb77255cd85A6F6abC9744D6B76A2F1',
}

// USDG (Paxos Global Dollar) on Robinhood chain
const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]

const GATEWAY_ABI = [
  'function buy(string ticker, uint256 usdcAmount) returns (uint256)',
  'function sell(string ticker, uint256 tokenAmount) returns (uint256)',
  'function bridgeBurn(string ticker, uint256 tokenAmount, string destChain, string destAddress)',
  'function setPrice(string ticker, uint256 priceUsd, bool marketOpen)',
  'function setPriceBatch(string[] tickers, uint256[] prices, bool[] marketOpens)',
  'function getAsset(string ticker) view returns (address, uint256, uint256, bool, uint256, uint256)',
  'function assetCount() view returns (uint256)',
  'function bridgeFeeBps() view returns (uint256)',
]

const POOL_ABI = [
  'function poolInfo() view returns (uint256, uint256, uint256, uint256)',
]

// Helper: get Robinhood chain price
async function getRhPrice(ticker: string): Promise<number> {
  try {
    const priceData = await getLatestPrices(ticker)
    const rhSource = priceData.sources.find(s => s.chain === 'robinhood-chain')
    if (rhSource) return rhSource.dexPrice
  } catch {}
  return latestPrices.get(ticker) ?? 0
}

// ─── GET /api/rh-gateway/info ───────────────────────────────────────────────

robinhoodGatewayRouter.get('/info', async (_req, res) => {
  if (!deployment || !provider) return res.json({ ok: false, error: 'Not deployed' })
  try {
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, provider)
    const poolC = new ethers.Contract(deployment.pool, POOL_ABI, provider)
    const [count, bridgeFee, poolInfo] = await Promise.all([
      gw.assetCount(), gw.bridgeFeeBps(), poolC.poolInfo(),
    ])
    res.json({
      ok: true,
      data: {
        chain: 'robinhood-testnet',
        chainId: ROBINHOOD_CONFIG.chainId,
        gateway: deployment.gateway,
        pool: deployment.pool,
        usdc: deployment.usdc,
        osTokens: deployment.osTokens,
        nativeStockTokens: RH_STOCK_TOKENS,
        usdg: USDG_ADDRESS,
        assetCount: Number(count),
        bridgeFeePct: Number(bridgeFee) / 100,
        tradeFeePct: 0.5,
        poolReserve: Number(ethers.formatUnits(poolInfo[0], 6)),
        explorer: ROBINHOOD_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── GET /api/rh-gateway/asset/:ticker ──────────────────────────────────────

robinhoodGatewayRouter.get('/asset/:ticker', async (req, res) => {
  if (!provider) return res.json({ ok: false, error: 'Not deployed' })
  try {
    const ticker = req.params.ticker.toUpperCase()
    const nativeAddr = RH_STOCK_TOKENS[ticker]
    if (!nativeAddr) return res.status(404).json({ ok: false, error: `Unknown: ${ticker}` })

    const tokenC = new ethers.Contract(nativeAddr, ERC20_ABI, provider)
    const [symbol, decimals, totalSupply] = await Promise.all([
      tokenC.symbol(), tokenC.decimals(), tokenC.totalSupply(),
    ])

    const price = await getRhPrice(ticker)

    res.json({
      ok: true,
      data: {
        ticker,
        chain: 'robinhood-testnet',
        nativeToken: nativeAddr,
        osToken: deployment?.osTokens?.[ticker] ?? null,
        symbol,
        decimals: Number(decimals),
        totalSupply: Number(ethers.formatUnits(totalSupply, decimals)),
        price,
        priceSource: 'robinhood-chain/robinhood',
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── GET /api/rh-gateway/balances/:address ──────────────────────────────────

robinhoodGatewayRouter.get('/balances/:address', async (req, res) => {
  if (!provider) return res.json({ ok: false, error: 'Not deployed' })
  try {
    const addr = req.params.address
    const balances: Record<string, number> = {}

    const breakdown: Record<string, { native: number; osToken: number; total: number }> = {}

    for (const [ticker, tokenAddr] of Object.entries(RH_STOCK_TOKENS)) {
      let nativeBal = 0
      let osBal = 0
      try {
        const c = new ethers.Contract(tokenAddr, ERC20_ABI, provider)
        nativeBal = Number(ethers.formatEther(await c.balanceOf(addr)))
      } catch {}
      // Also check osToken balance on this chain
      const osAddr = deployment?.osTokens?.[ticker]
      if (osAddr) {
        try {
          const c = new ethers.Contract(osAddr, ERC20_ABI, provider)
          osBal = Number(ethers.formatUnits(await c.balanceOf(addr), 6))
        } catch {}
      }
      balances[ticker] = nativeBal + osBal
      breakdown[ticker] = { native: nativeBal, osToken: osBal, total: nativeBal + osBal }
    }

    // MockUSDC balance
    if (deployment?.usdc) {
      try {
        const usdcC = new ethers.Contract(deployment.usdc, ERC20_ABI, provider)
        balances['USDC'] = Number(ethers.formatUnits(await usdcC.balanceOf(addr), 6))
      } catch { balances['USDC'] = 0 }
    }

    // ETH balance
    const ethBal = await provider.getBalance(addr)
    balances['ETH'] = Number(ethers.formatEther(ethBal))

    res.json({ ok: true, data: { address: addr, chain: 'robinhood-testnet', balances, breakdown } })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/rh-gateway/mint (buy) ────────────────────────────────────────

robinhoodGatewayRouter.post('/mint', async (req, res) => {
  if (!deployment || !keeper || !provider) return res.json({ ok: false, error: 'Not deployed' })
  try {
    const { ticker, usdcAmount, walletAddress } = req.body as {
      ticker: string; usdcAmount: number; walletAddress: string
    }
    if (!ticker || !usdcAmount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const osTokenAddr = deployment.osTokens[tickerUp]
    if (!osTokenAddr) return res.status(400).json({ ok: false, error: `Unknown: ${tickerUp}` })

    const price = await getRhPrice(tickerUp)
    if (!price) return res.status(400).json({ ok: false, error: 'No price' })

    const priceUnits = Math.round(price * 1e6)
    const usdcUnits = ethers.parseUnits(usdcAmount.toString(), 6)

    // Push price
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, keeper)
    try { await (await gw.setPrice(tickerUp, priceUnits, true)).wait() } catch {}

    // Mint USDC to user (testnet)
    const usdc = new ethers.Contract(deployment.usdc, ERC20_ABI, keeper)
    try { await (await usdc.mint(walletAddress, usdcUnits)).wait() } catch {}

    const usdcIface = new ethers.Interface(ERC20_ABI)
    const gwIface = new ethers.Interface(GATEWAY_ABI)

    res.json({
      ok: true,
      data: {
        chain: 'robinhood-testnet',
        mode: 'buy',
        ticker: tickerUp,
        approveTx: {
          to: deployment.usdc,
          data: usdcIface.encodeFunctionData('approve', [deployment.gateway, usdcUnits]),
          chainId: ROBINHOOD_CONFIG.chainId,
        },
        mintTx: {
          to: deployment.gateway,
          data: gwIface.encodeFunctionData('buy', [tickerUp, usdcUnits]),
          chainId: ROBINHOOD_CONFIG.chainId,
        },
        usdcIn: usdcAmount,
        price,
        priceSource: 'robinhood',
        expectedTokenOut: Number((usdcAmount * 0.995 / price).toFixed(6)),
        feePct: 0.5,
        osTokenAddress: osTokenAddr,
        explorer: ROBINHOOD_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/rh-gateway/redeem (sell native stock token) ──────────────────
// On Robinhood, user sells NATIVE stock token (TSLA, AMZN etc), not osToken.
// Flow: user transfers native token to Gateway (escrow) → receives MockUSDC from Pool.

robinhoodGatewayRouter.post('/redeem', async (req, res) => {
  if (!deployment || !keeper || !provider) return res.json({ ok: false, error: 'Not deployed' })
  try {
    const { ticker, osAmount, walletAddress } = req.body as {
      ticker: string; osAmount: number; walletAddress: string
    }
    if (!ticker || !osAmount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const nativeAddr = RH_STOCK_TOKENS[tickerUp]
    if (!nativeAddr) return res.status(400).json({ ok: false, error: `No Robinhood token for ${tickerUp}` })

    const price = await getRhPrice(tickerUp)
    if (!price) return res.status(400).json({ ok: false, error: 'No price' })

    // Native stock tokens are 18 decimals
    const amountWei = ethers.parseEther(osAmount.toString())
    const tokenIface = new ethers.Interface(ERC20_ABI)

    // User transfers native stock token to Gateway (escrow)
    // No approve needed — just a direct transfer
    const transferTx = {
      to: nativeAddr,
      data: tokenIface.encodeFunctionData('transfer', [deployment.gateway, amountWei]),
      chainId: ROBINHOOD_CONFIG.chainId,
    }

    const usdcOut = osAmount * price * 0.995  // 0.5% fee

    // Keeper sends MockUSDC to user (testnet auto-mint)
    if (keeper && deployment.usdc) {
      const usdc = new ethers.Contract(deployment.usdc, ERC20_ABI, keeper)
      const usdcUnits = ethers.parseUnits(usdcOut.toFixed(6), 6)
      try {
        const mintTx = await usdc.mint(walletAddress, usdcUnits)
        await mintTx.wait()
        console.log(`[RH-Gateway] Minted $${usdcOut.toFixed(2)} USDC to ${walletAddress}`)
      } catch (e: any) {
        console.error(`[RH-Gateway] USDC mint failed: ${e.message?.slice(0, 80)}`)
      }
    } else {
      console.warn('[RH-Gateway] Cannot mint USDC — keeper or usdc address missing')
    }

    res.json({
      ok: true,
      data: {
        chain: 'robinhood-testnet',
        mode: 'sell',
        ticker: tickerUp,
        // No approve step — just transfer
        approveTx: null,
        redeemTx: transferTx,
        nativeToken: nativeAddr,
        tokenIn: osAmount,
        price,
        expectedUsdcOut: Number(usdcOut.toFixed(2)),
        feePct: 0.5,
        explorer: ROBINHOOD_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/rh-gateway/swap-to-arbitrum ──────────────────────────────────
// User sends Robinhood native stock token → we mint osToken on Arbitrum
// Flow: user signs transfer(gateway, amount) on Robinhood → backend detects → mints on Arbitrum

robinhoodGatewayRouter.post('/swap-to-arbitrum', async (req, res) => {
  if (!deployment || !keeper) return res.json({ ok: false, error: 'Not configured' })
  try {
    const { ticker, amount, destAddress } = req.body as {
      ticker: string; amount: number; destAddress: string
    }
    if (!ticker || !amount || !destAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const nativeAddr = RH_STOCK_TOKENS[tickerUp]
    if (!nativeAddr) return res.status(400).json({ ok: false, error: `Unknown: ${tickerUp}` })

    const price = await getRhPrice(tickerUp)
    if (!price) return res.status(400).json({ ok: false, error: 'No price' })

    // Build transfer tx for user to sign — send stock token to gateway (escrow)
    const tokenIface = new ethers.Interface(ERC20_ABI)
    const amountWei = ethers.parseEther(amount.toString()) // Robinhood tokens are 18 decimals

    const transferTx = {
      to: nativeAddr,
      data: tokenIface.encodeFunctionData('transfer', [deployment.gateway, amountWei]),
      chainId: ROBINHOOD_CONFIG.chainId,
    }

    // Fee calculation
    const usdcValue = amount * price
    const fee = usdcValue * 0.0005  // 0.05%
    const netUsdc = usdcValue - fee

    res.json({
      ok: true,
      data: {
        chain: 'robinhood-testnet',
        mode: 'swap-to-arbitrum',
        ticker: tickerUp,
        transferTx,
        nativeToken: nativeAddr,
        amount,
        price,
        priceSource: 'robinhood',
        usdcValue: Number(usdcValue.toFixed(2)),
        fee: Number(fee.toFixed(2)),
        netUsdc: Number(netUsdc.toFixed(2)),
        destAddress,
        destChain: 'arbitrum',
        explorer: ROBINHOOD_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/rh-gateway/push-prices ───────────────────────────────────────

robinhoodGatewayRouter.post('/push-prices', async (_req, res) => {
  if (!deployment || !keeper) return res.json({ ok: false, error: 'Not configured' })
  try {
    const gw = new ethers.Contract(deployment.gateway, GATEWAY_ABI, keeper)
    const tickers: string[] = []
    const prices: bigint[] = []
    const opens: boolean[] = []

    for (const ticker of Object.keys(RH_STOCK_TOKENS)) {
      const price = await getRhPrice(ticker)
      if (!price) continue
      tickers.push(ticker)
      prices.push(BigInt(Math.round(price * 1e6)))
      opens.push(true)
    }

    if (tickers.length === 0) return res.json({ ok: false, error: 'No prices' })
    const tx = await gw.setPriceBatch(tickers, prices, opens)
    const receipt = await tx.wait()

    res.json({ ok: true, data: { pushed: tickers.length, tickers, txHash: receipt.hash } })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})
