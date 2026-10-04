import { Router } from 'express'
import { ethers } from 'ethers'
import { ARBITRUM_CONFIG, ARB_VAULT_ABI, ARB_ERC20_ABI, loadArbitrumDeployment } from '../config/arbitrum.js'

export const arbitrumRouter = Router()

// Load deployment addresses on startup
const deployed = loadArbitrumDeployment()

const provider = new ethers.JsonRpcProvider(ARBITRUM_CONFIG.rpc)

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || ''
const deployer = DEPLOYER_KEY ? new ethers.Wallet(DEPLOYER_KEY, provider) : null

const TICKER_TO_XSTOCK: Record<string, string> = {
  TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
  GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
}

// ─── GET /api/arbitrum/info ─────────────────────────────────────────────────
arbitrumRouter.get('/info', async (_req, res) => {
  res.json({
    ok: true,
    data: {
      deployed,
      chainId: ARBITRUM_CONFIG.chainId,
      rpc: ARBITRUM_CONFIG.rpc,
      explorer: ARBITRUM_CONFIG.explorer,
      contracts: ARBITRUM_CONFIG.contracts,
      tokens: ARBITRUM_CONFIG.tokens,
      vaults: ARBITRUM_CONFIG.vaults,
    },
  })
})

// ─── POST /api/arbitrum/faucet ──────────────────────────────────────────────
arbitrumRouter.post('/faucet', async (req, res) => {
  try {
    if (!deployed) return res.status(503).json({ ok: false, error: 'Arbitrum contracts not deployed' })
    const { walletAddress } = req.body as { walletAddress: string }
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ ok: false, error: 'Invalid walletAddress' })
    }
    if (!deployer) {
      return res.status(500).json({ ok: false, error: 'Deployer key not configured' })
    }

    const results: { symbol: string; amount: string; txHash: string }[] = []

    // Mint 10,000 USDC
    if (ARBITRUM_CONFIG.contracts.usdc) {
      const usdc = new ethers.Contract(ARBITRUM_CONFIG.contracts.usdc, ARB_ERC20_ABI, deployer)
      const usdcTx = await usdc.mint(walletAddress, ethers.parseUnits('10000', 6))
      await usdcTx.wait()
      results.push({ symbol: 'USDC', amount: '10000', txHash: usdcTx.hash })
    }

    // Mint 100 of each xStock
    for (const [symbol, addr] of Object.entries(ARBITRUM_CONFIG.tokens)) {
      const token = new ethers.Contract(addr, ARB_ERC20_ABI, deployer)
      const tx = await token.mint(walletAddress, ethers.parseEther('100'))
      await tx.wait()
      results.push({ symbol, amount: '100', txHash: tx.hash })
    }

    console.log(`[Arbitrum Faucet] Minted tokens to ${walletAddress}`)
    res.json({ ok: true, data: { tokens: results } })
  } catch (err: any) {
    console.error('[Arbitrum Faucet]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── GET /api/arbitrum/vault/:asset ─────────────────────────────────────────
arbitrumRouter.get('/vault/:asset', async (req, res) => {
  try {
    if (!deployed) return res.status(503).json({ ok: false, error: 'Arbitrum contracts not deployed' })
    const xstock = TICKER_TO_XSTOCK[req.params.asset.toUpperCase()] ?? req.params.asset
    const vaultAddr = ARBITRUM_CONFIG.vaults[xstock]
    if (!vaultAddr) {
      return res.status(404).json({ ok: false, error: `No vault for ${xstock}` })
    }

    const vault = new ethers.Contract(vaultAddr, ARB_VAULT_ABI, provider)
    const [totalAssets, totalSupply] = await Promise.all([
      vault.totalAssets(),
      vault.totalSupply(),
    ])

    const apyBps = ARBITRUM_CONFIG.apyBps[xstock] ?? 420

    res.json({
      ok: true,
      data: {
        asset: xstock,
        vaultAddress: vaultAddr,
        totalAssets: ethers.formatEther(totalAssets),
        totalShares: ethers.formatEther(totalSupply),
        apyPct: apyBps / 100,
      },
    })
  } catch (err: any) {
    console.error('[Arbitrum Vault]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── POST /api/arbitrum/execute ─────────────────────────────────────────────
// Same pattern as X Layer: mint xStock (testnet) + build approve + deposit tx
arbitrumRouter.post('/execute', async (req, res) => {
  try {
    if (!deployed) return res.status(503).json({ ok: false, error: 'Arbitrum contracts not deployed' })
    const { asset, amountUsd, walletAddress } = req.body as {
      asset: string; amountUsd: number; walletAddress: string
    }
    if (!asset || !amountUsd || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amountUsd, or walletAddress' })
    }

    const xstock = TICKER_TO_XSTOCK[asset.toUpperCase()] ?? asset
    const tokenAddr = ARBITRUM_CONFIG.tokens[xstock]
    const vaultAddr = ARBITRUM_CONFIG.vaults[xstock]
    if (!tokenAddr || !vaultAddr) {
      return res.status(400).json({ ok: false, error: `Unsupported asset: ${asset}` })
    }

    // Get oracle price
    const { prisma } = await import('../db/client.js')
    const oracleRow = await prisma.priceSnapshot.findFirst({
      where: { ticker: asset.toUpperCase(), issuer: 'yahoo' },
      orderBy: { capturedAt: 'desc' },
    })
    const oraclePrice = oracleRow?.oraclePrice ?? 300
    const tokenAmount = ethers.parseEther((amountUsd / oraclePrice).toFixed(18))

    // Server mints xStock to user (testnet)
    let mintTxHash: string | null = null
    if (deployer) {
      const token = new ethers.Contract(tokenAddr, ARB_ERC20_ABI, deployer)
      const mintTx = await token.mint(walletAddress, tokenAmount)
      await mintTx.wait()
      mintTxHash = mintTx.hash
      console.log(`[Arbitrum Execute] Minted ${ethers.formatEther(tokenAmount)} ${xstock} to ${walletAddress}`)
    }

    // Build approve + deposit tx data
    const tokenIface = new ethers.Interface(ARB_ERC20_ABI)
    const vaultIface = new ethers.Interface(ARB_VAULT_ABI)

    const approveTx = {
      to: tokenAddr,
      data: tokenIface.encodeFunctionData('approve', [vaultAddr, tokenAmount]),
      chainId: ARBITRUM_CONFIG.chainId,
    }
    const depositTx = {
      to: vaultAddr,
      data: vaultIface.encodeFunctionData('deposit', [tokenAmount, walletAddress]),
      chainId: ARBITRUM_CONFIG.chainId,
    }

    const apyBps = ARBITRUM_CONFIG.apyBps[xstock] ?? 420

    res.json({
      ok: true,
      data: {
        chain: 'arbitrum',
        chainId: ARBITRUM_CONFIG.chainId,
        mode: 'arbitrum-testnet',
        mintTxHash,
        approveTx,
        depositTx,
        xstockSymbol: xstock,
        xstockOut: Number(ethers.formatEther(tokenAmount)),
        usdcIn: amountUsd,
        oraclePrice,
        vaultAddress: vaultAddr,
        tokenAddress: tokenAddr,
        apyPct: apyBps / 100,
        explorer: ARBITRUM_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[Arbitrum Execute]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})
