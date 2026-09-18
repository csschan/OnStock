import { Router } from 'express'
import { ethers } from 'ethers'
import { XLAYER_CONFIG, XLAYER_AAVE, VAULT_ABI, AAVE_POOL_ABI, ERC20_ABI } from '../config/xlayer.js'

export const xlayerRouter = Router()

const provider = new ethers.JsonRpcProvider(XLAYER_CONFIG.rpc)

// Deployer wallet for minting test tokens
const DEPLOYER_KEY = process.env.XLAYER_DEPLOYER_KEY || process.env.DEPLOYER_PRIVATE_KEY || ''
const deployer = DEPLOYER_KEY ? new ethers.Wallet(DEPLOYER_KEY, provider) : null

// ─── Helper: ticker → xStock symbol ─────────────────────────────────────────
const TICKER_TO_XSTOCK: Record<string, string> = {
  TSLA: 'TSLAx', NVDA: 'NVDAx', SPY: 'SPYx', AAPL: 'AAPLx',
  GOOGL: 'GOOGLx', META: 'METAx', COIN: 'COINx', MSTR: 'MSTRx',
}

// ─── GET /api/xlayer/info ────────────────────────────────────────────────────
// Returns X Layer deployment info for frontend
xlayerRouter.get('/info', async (_req, res) => {
  res.json({
    ok: true,
    data: {
      chainId: XLAYER_CONFIG.chainId,
      rpc: XLAYER_CONFIG.rpc,
      explorer: XLAYER_CONFIG.explorer,
      contracts: XLAYER_CONFIG.contracts,
      tokens: XLAYER_CONFIG.tokens,
      vaults: XLAYER_CONFIG.vaults,
    },
  })
})

// ─── POST /api/xlayer/faucet ─────────────────────────────────────────────────
// Mint test USDC + all xStock tokens to user wallet
xlayerRouter.post('/faucet', async (req, res) => {
  try {
    const { walletAddress } = req.body as { walletAddress: string }
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ ok: false, error: 'Invalid walletAddress' })
    }
    if (!deployer) {
      return res.status(500).json({ ok: false, error: 'Deployer key not configured' })
    }

    const results: { symbol: string; amount: string; txHash: string }[] = []

    // Mint 10,000 USDC
    const usdc = new ethers.Contract(XLAYER_CONFIG.contracts.usdc, ERC20_ABI, deployer)
    const usdcTx = await usdc.mint(walletAddress, ethers.parseUnits('10000', 6))
    await usdcTx.wait()
    results.push({ symbol: 'USDC', amount: '10000', txHash: usdcTx.hash })

    // Mint 100 of each xStock
    for (const [symbol, addr] of Object.entries(XLAYER_CONFIG.tokens)) {
      const token = new ethers.Contract(addr, ERC20_ABI, deployer)
      const tx = await token.mint(walletAddress, ethers.parseEther('100'))
      await tx.wait()
      results.push({ symbol, amount: '100', txHash: tx.hash })
    }

    console.log(`[XLayer Faucet] Minted tokens to ${walletAddress}`)
    res.json({ ok: true, data: { tokens: results } })
  } catch (err: any) {
    console.error('[XLayer Faucet]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── GET /api/xlayer/vault/:asset ────────────────────────────────────────────
// Get vault info for an xStock asset
xlayerRouter.get('/vault/:asset', async (req, res) => {
  try {
    const xstock = TICKER_TO_XSTOCK[req.params.asset.toUpperCase()] ?? req.params.asset
    const vaultAddr = XLAYER_CONFIG.vaults[xstock]
    if (!vaultAddr) {
      return res.status(404).json({ ok: false, error: `No vault for ${xstock}` })
    }

    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider)
    const [totalAssets, totalShares, apyBps, totalYield, lastYieldTime] = await vault.getVaultInfo()

    res.json({
      ok: true,
      data: {
        asset: xstock,
        vaultAddress: vaultAddr,
        totalAssets: ethers.formatEther(totalAssets),
        totalShares: ethers.formatEther(totalShares),
        apyPct: Number(apyBps) / 100,
        totalYieldAdded: ethers.formatEther(totalYield),
        lastYieldTime: Number(lastYieldTime),
      },
    })
  } catch (err: any) {
    console.error('[XLayer Vault]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── GET /api/xlayer/position?asset=TSLAx&wallet=0x... ───────────────────────
// Get user vault position
xlayerRouter.get('/position', async (req, res) => {
  try {
    const { asset, wallet } = req.query as { asset: string; wallet: string }
    const xstock = TICKER_TO_XSTOCK[asset?.toUpperCase()] ?? asset
    const vaultAddr = XLAYER_CONFIG.vaults[xstock]
    if (!vaultAddr || !wallet) {
      return res.status(400).json({ ok: false, error: 'Missing asset or wallet' })
    }

    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider)
    const shares = await vault.balanceOf(wallet)
    const totalAssets = await vault.totalAssets()
    const totalSupply = await vault.totalSupply()

    const sharesNum = Number(ethers.formatEther(shares))
    const nav = totalSupply > 0n
      ? Number(ethers.formatEther(totalAssets)) / Number(ethers.formatEther(totalSupply))
      : 1.0
    const currentValue = sharesNum * nav

    res.json({
      ok: true,
      data: {
        userShares: sharesNum,
        depositedAmount: sharesNum, // 1:1 at start
        currentValue,
        nav,
        pnl: currentValue - sharesNum,
      },
    })
  } catch (err: any) {
    console.error('[XLayer Position]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── POST /api/xlayer/execute ────────────────────────────────────────────────
// Execute intent on X Layer: mint xStock (testnet) + build vault deposit tx
// Returns unsigned tx data for frontend to sign with MetaMask/OKX Wallet
xlayerRouter.post('/execute', async (req, res) => {
  try {
    const { asset, amountUsd, walletAddress } = req.body as {
      asset: string; amountUsd: number; walletAddress: string
    }
    if (!asset || !amountUsd || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing asset, amountUsd, or walletAddress' })
    }

    const xstock = TICKER_TO_XSTOCK[asset.toUpperCase()] ?? asset
    const tokenAddr = XLAYER_CONFIG.tokens[xstock]
    const vaultAddr = XLAYER_CONFIG.vaults[xstock]
    if (!tokenAddr || !vaultAddr) {
      return res.status(400).json({ ok: false, error: `Unsupported asset: ${asset}` })
    }

    // Get oracle price for amount calculation
    const { prisma } = await import('../db/client.js')
    const oracleRow = await prisma.priceSnapshot.findFirst({
      where: { ticker: asset.toUpperCase(), issuer: 'yahoo' },
      orderBy: { capturedAt: 'desc' },
    })
    const oraclePrice = oracleRow?.oraclePrice ?? 300
    const tokenAmount = ethers.parseEther((amountUsd / oraclePrice).toFixed(18))

    // Step 1: Server mints xStock to user (testnet only)
    let mintTxHash: string | null = null
    if (deployer) {
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer)
      const mintTx = await token.mint(walletAddress, tokenAmount)
      await mintTx.wait()
      mintTxHash = mintTx.hash
      console.log(`[XLayer Execute] Minted ${ethers.formatEther(tokenAmount)} ${xstock} to ${walletAddress}`)
    }

    // Step 2: Build approve + deposit tx data for user to sign
    const tokenIface = new ethers.Interface(ERC20_ABI)
    const vaultIface = new ethers.Interface(VAULT_ABI)

    // Tx 1: approve vault to spend xStock
    const approveTxData = {
      to: tokenAddr,
      data: tokenIface.encodeFunctionData('approve', [vaultAddr, tokenAmount]),
      chainId: XLAYER_CONFIG.chainId,
    }

    // Tx 2: deposit into vault
    const depositTxData = {
      to: vaultAddr,
      data: vaultIface.encodeFunctionData('deposit', [tokenAmount, walletAddress]),
      chainId: XLAYER_CONFIG.chainId,
    }

    const apyBps = XLAYER_CONFIG.apyBps[xstock] ?? 420

    res.json({
      ok: true,
      data: {
        chain: 'xlayer',
        chainId: XLAYER_CONFIG.chainId,
        mode: 'xlayer-testnet',
        // Server-side mint (testnet)
        mintTxHash,
        // Unsigned tx data for frontend to sign
        approveTx: approveTxData,
        depositTx: depositTxData,
        // Meta
        xstockSymbol: xstock,
        xstockOut: Number(ethers.formatEther(tokenAmount)),
        usdcIn: amountUsd,
        oraclePrice,
        vaultAddress: vaultAddr,
        tokenAddress: tokenAddr,
        apyPct: apyBps / 100,
        explorer: XLAYER_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[XLayer Execute]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── POST /api/xlayer/build-withdraw ─────────────────────────────────────────
// Build withdraw tx data for user to sign
xlayerRouter.post('/build-withdraw', async (req, res) => {
  try {
    const { asset, shares, walletAddress } = req.body as {
      asset: string; shares: number; walletAddress: string
    }
    const xstock = TICKER_TO_XSTOCK[asset?.toUpperCase()] ?? asset
    const vaultAddr = XLAYER_CONFIG.vaults[xstock]
    if (!vaultAddr || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const vaultIface = new ethers.Interface(VAULT_ABI)
    const sharesWei = ethers.parseEther(shares.toString())

    const redeemTxData = {
      to: vaultAddr,
      data: vaultIface.encodeFunctionData('redeem', [sharesWei, walletAddress, walletAddress]),
      chainId: XLAYER_CONFIG.chainId,
    }

    res.json({
      ok: true,
      data: {
        chain: 'xlayer',
        redeemTx: redeemTxData,
        explorer: XLAYER_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[XLayer Withdraw]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── GET /api/xlayer/aave/info ───────────────────────────────────────────────
// Returns Aave pool info and APYs for all xStocks
xlayerRouter.get('/aave/info', async (_req, res) => {
  try {
    const pool = new ethers.Contract(XLAYER_AAVE.pool, AAVE_POOL_ABI, provider)
    const reserves: Record<string, any> = {}

    for (const [symbol, tokenAddr] of Object.entries(XLAYER_CONFIG.tokens)) {
      try {
        const [aTokenAddr, liquidityRate, borrowRate, totalSupply, totalBorrow] =
          await pool.getReserveData(tokenAddr)

        reserves[symbol] = {
          aTokenAddress: aTokenAddr,
          supplyApyPct: XLAYER_AAVE.supplyApy[symbol] ?? 0,
          liquidityRateRay: liquidityRate.toString(),
          borrowRateRay: borrowRate.toString(),
          totalSupply: ethers.formatEther(totalSupply),
          totalBorrow: ethers.formatEther(totalBorrow),
        }
      } catch {
        reserves[symbol] = { supplyApyPct: XLAYER_AAVE.supplyApy[symbol] ?? 0, error: 'not registered' }
      }
    }

    res.json({
      ok: true,
      data: {
        pool: XLAYER_AAVE.pool,
        reserves,
      },
    })
  } catch (err: any) {
    console.error('[XLayer Aave]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})

// ─── POST /api/xlayer/aave/supply ────────────────────────────────────────────
// Build approve + supply tx for Aave on X Layer
xlayerRouter.post('/aave/supply', async (req, res) => {
  try {
    const { asset, amountUsd, walletAddress } = req.body as {
      asset: string; amountUsd: number; walletAddress: string
    }
    const xstock = TICKER_TO_XSTOCK[asset?.toUpperCase()] ?? asset
    const tokenAddr = XLAYER_CONFIG.tokens[xstock]
    if (!tokenAddr || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    // Calculate token amount
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
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer)
      const mintTx = await token.mint(walletAddress, tokenAmount)
      await mintTx.wait()
      mintTxHash = mintTx.hash
    }

    // Build approve + supply tx data
    const tokenIface = new ethers.Interface(ERC20_ABI)
    const poolIface = new ethers.Interface(AAVE_POOL_ABI)

    const approveTxData = {
      to: tokenAddr,
      data: tokenIface.encodeFunctionData('approve', [XLAYER_AAVE.pool, tokenAmount]),
      chainId: XLAYER_CONFIG.chainId,
    }

    const supplyTxData = {
      to: XLAYER_AAVE.pool,
      data: poolIface.encodeFunctionData('supply', [tokenAddr, tokenAmount, walletAddress, 0]),
      chainId: XLAYER_CONFIG.chainId,
    }

    res.json({
      ok: true,
      data: {
        chain: 'xlayer',
        mode: 'xlayer-aave',
        mintTxHash,
        approveTx: approveTxData,
        supplyTx: supplyTxData,
        xstockSymbol: xstock,
        xstockOut: Number(ethers.formatEther(tokenAmount)),
        usdcIn: amountUsd,
        aavePool: XLAYER_AAVE.pool,
        aToken: XLAYER_AAVE.aTokens[xstock],
        apyPct: XLAYER_AAVE.supplyApy[xstock] ?? 0,
        explorer: XLAYER_CONFIG.explorer,
      },
    })
  } catch (err: any) {
    console.error('[XLayer Aave Supply]', err)
    res.status(500).json({ ok: false, error: err?.message ?? String(err) })
  }
})
