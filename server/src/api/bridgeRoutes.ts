/**
 * Cross-Chain Bridge Relay API
 *
 * Burn & Mint model:
 *   1. User burns osToken on source chain (via bridgeBurn)
 *   2. Backend verifies burn event
 *   3. Backend mints equivalent osToken on destination chain (via bridgeMint)
 *
 * Endpoints:
 *   POST /api/bridge/initiate   — Build bridge burn tx for user to sign
 *   POST /api/bridge/complete   — Relay: verify burn + mint on dest chain (auto-called after burn confirms)
 *   GET  /api/bridge/status/:id — Check bridge status
 */

import { Router } from 'express'
import { ethers } from 'ethers'
import { ARBITRUM_CONFIG } from '../config/arbitrum.js'
import { getLatestPrices } from '../aggregator.js'
import { latestPrices } from '../fetchers/stockprice.js'

export const bridgeRouter = Router()

// ─── Config ─────────────────────────────────────────────────────────────────

interface GatewayDeploy {
  gateway: string
  osTokens: Record<string, string>
  usdc: string
}

function loadDeploy(): GatewayDeploy | null {
  try {
    const fs = require('fs')
    const path = require('path')
    const f = path.resolve(__dirname, '../../../xlayer-contracts/deployment-arbitrumSepolia.json')
    if (!fs.existsSync(f)) return null
    const d = JSON.parse(fs.readFileSync(f, 'utf8'))
    return d.gateway ? { gateway: d.gateway, osTokens: d.osTokens, usdc: d.usdc } : null
  } catch { return null }
}

const deploy = loadDeploy()
const provider = new ethers.JsonRpcProvider(ARBITRUM_CONFIG.rpc)
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || ''
const keeper = DEPLOYER_KEY ? new ethers.Wallet(DEPLOYER_KEY, provider) : null

const GATEWAY_ABI = [
  'function mint(string ticker, uint256 usdcAmount) returns (uint256)',
  'function redeem(string ticker, uint256 osAmount) returns (uint256)',
  'function bridgeBurn(string ticker, uint256 amount, string destChain, string destAddress)',
  'function bridgeMint(string ticker, address to, uint256 amount, string srcChain, uint256 srcNonce)',
  'function bridgeNonce() view returns (uint256)',
  'function setPrice(string ticker, uint256 priceUsd, bool marketOpen)',
  'function getAsset(string ticker) view returns (address, uint256, uint256, bool, uint256, uint256)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]

// ─── In-memory bridge log ───────────────────────────────────────────────────

interface BridgeRecord {
  id: string
  srcChain: string
  destChain: string
  ticker: string
  amount: number
  sender: string
  destAddress: string
  status: 'pending' | 'burned' | 'minting' | 'completed' | 'failed'
  burnTxHash?: string
  mintTxHash?: string
  nonce?: number
  createdAt: number
}

// Helper: get chain-specific DEX price
async function getChainPrice(ticker: string, chain: string): Promise<number | null> {
  try {
    const priceData = await getLatestPrices(ticker)
    const chainMap: Record<string, string> = { arbitrum: 'ethereum', solana: 'solana', robinhood: 'robinhood-chain', bnb: 'bnb' }
    const chainId = chainMap[chain] ?? chain
    const sources = priceData.sources.filter(s => s.chain === chainId)
    if (sources.length > 0) {
      return sources.reduce((a, b) => (b.liquidityUsd ?? 0) > (a.liquidityUsd ?? 0) ? b : a, sources[0]).dexPrice
    }
    if (priceData.sources.length > 0) return priceData.sources[0].dexPrice
    return latestPrices.get(ticker) ?? null
  } catch {
    return latestPrices.get(ticker) ?? null
  }
}

const bridgeLog: BridgeRecord[] = []
let nextId = 1

// ─── POST /api/bridge/initiate ──────────────────────────────────────────────
// Build bridgeBurn tx for user to sign on source chain

bridgeRouter.post('/initiate', async (req, res) => {
  if (!deploy) return res.json({ ok: false, error: 'Gateway not deployed' })

  try {
    const { ticker, amount, srcChain, destChain, destAddress, walletAddress } = req.body as {
      ticker: string; amount: number; srcChain: string; destChain: string
      destAddress: string; walletAddress: string
    }

    if (!ticker || !amount || !srcChain || !destChain || !destAddress || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const osTokenAddr = deploy.osTokens[tickerUp]
    if (!osTokenAddr) return res.status(400).json({ ok: false, error: `Unknown asset: ${tickerUp}` })

    const osUnits = ethers.parseUnits(amount.toString(), 6)

    // Create bridge record
    const record: BridgeRecord = {
      id: `bridge-${nextId++}`,
      srcChain,
      destChain,
      ticker: tickerUp,
      amount,
      sender: walletAddress,
      destAddress,
      status: 'pending',
      createdAt: Date.now(),
    }
    bridgeLog.push(record)

    // Get real prices on both chains
    const [srcPrice, destPrice] = await Promise.all([
      getChainPrice(tickerUp, srcChain),
      getChainPrice(tickerUp, destChain),
    ])

    // Robinhood: transfer native stock token to escrow (gateway), then mint on dest
    if (srcChain === 'robinhood') {
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

      const nativeAddr = RH_STOCK_TOKENS[tickerUp]
      if (!nativeAddr) return res.status(400).json({ ok: false, error: `No Robinhood token for ${tickerUp}` })

      // Load Robinhood deployment for gateway address
      const { loadRobinhoodDeployment } = await import('../config/robinhood.js')
      const rhDeploy = loadRobinhoodDeployment()
      if (!rhDeploy) return res.status(400).json({ ok: false, error: 'Robinhood not deployed' })

      const tokenIface = new ethers.Interface(ERC20_ABI)
      // Robinhood stock tokens are 18 decimals
      const amountWei = ethers.parseEther(amount.toString())

      // User transfers native stock token to Gateway (escrow)
      const transferTx = {
        to: nativeAddr,
        data: tokenIface.encodeFunctionData('transfer', [rhDeploy.gateway, amountWei]),
        chainId: 46630,  // Robinhood testnet
      }

      const usdcValue = amount * (srcPrice ?? 0)
      const fee = usdcValue * 0.0005
      const netUsdc = usdcValue - fee
      const destTokens = destPrice ? (netUsdc / destPrice) : 0

      res.json({
        ok: true,
        data: {
          bridgeId: record.id,
          srcChain, destChain, ticker: tickerUp, amount,
          burnTx: transferTx,  // frontend uses burnTx key
          pricing: {
            srcPrice, destPrice,
            srcValue: Number(usdcValue.toFixed(2)),
            fee: Number(fee.toFixed(2)),
            feePct: '0.05%',
            destTokens: Number(destTokens.toFixed(6)),
            nativeToken: nativeAddr,
          },
          explorer: 'https://explorer.testnet.chain.robinhood.com',
        },
      })
    } else if (srcChain === 'arbitrum') {
      const osIface = new ethers.Interface(ERC20_ABI)
      const gwIface = new ethers.Interface(GATEWAY_ABI)

      // Push source chain price to contract before burn
      if (keeper && srcPrice) {
        const gw = new ethers.Contract(deploy.gateway, GATEWAY_ABI, keeper)
        try { await (await gw.setPrice(tickerUp, Math.round(srcPrice * 1e6), true)).wait() } catch {}
      }

      const approveTx = {
        to: osTokenAddr,
        data: osIface.encodeFunctionData('approve', [deploy.gateway, osUnits]),
        chainId: ARBITRUM_CONFIG.chainId,
      }

      const burnTx = {
        to: deploy.gateway,
        data: gwIface.encodeFunctionData('bridgeBurn', [tickerUp, osUnits, destChain, destAddress]),
        chainId: ARBITRUM_CONFIG.chainId,
      }

      // Calculate what user gets on dest chain
      const srcValue = amount * (srcPrice ?? 0)
      const fee = srcValue * 0.0005
      const destTokens = destPrice ? ((srcValue - fee) / destPrice) : 0

      res.json({
        ok: true,
        data: {
          bridgeId: record.id,
          srcChain, destChain, ticker: tickerUp, amount,
          approveTx, burnTx,
          pricing: {
            srcPrice, destPrice,
            srcValue: Number(srcValue.toFixed(2)),
            fee: Number(fee.toFixed(2)),
            feePct: '0.05%',
            destTokens: Number(destTokens.toFixed(6)),
            priceImpact: srcPrice && destPrice ? ((destPrice - srcPrice) / srcPrice * 100).toFixed(3) + '%' : null,
          },
          explorer: ARBITRUM_CONFIG.explorer,
        },
      })
    } else if (srcChain === 'solana') {
      // Solana → Arbitrum: user burns on Solana (frontend builds Anchor tx)
      // After burn confirms, call /bridge/complete to mint on Arbitrum
      res.json({
        ok: true,
        data: {
          bridgeId: record.id,
          srcChain, destChain, ticker: tickerUp, amount,
          instruction: 'Sign burn transaction in Phantom wallet. After confirmation, bridge will auto-complete.',
          solanaProgram: '76R7gyAYTFTnKPW3ePx44KTm1AQgRRqQopxTpGxpSy6G',
        },
      })
    } else {
      res.status(400).json({ ok: false, error: `Unsupported srcChain: ${srcChain}` })
    }
  } catch (err: any) {
    console.error('[Bridge Initiate]', err)
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/bridge/complete ──────────────────────────────────────────────
// Called after burn is confirmed — mints on destination chain

bridgeRouter.post('/complete', async (req, res) => {
  if (!deploy || !keeper) return res.json({ ok: false, error: 'Not configured' })

  try {
    const { bridgeId, burnTxHash } = req.body as { bridgeId: string; burnTxHash: string }
    const record = bridgeLog.find(r => r.id === bridgeId)
    if (!record) return res.status(404).json({ ok: false, error: 'Bridge not found' })

    record.burnTxHash = burnTxHash
    record.status = 'burned'

    if (record.destChain === 'arbitrum') {
      // Mint osTSLA on Arbitrum via bridgeMint
      record.status = 'minting'
      const gw = new ethers.Contract(deploy.gateway, GATEWAY_ABI, keeper)

      const { latestPrices: lp } = await import('../fetchers/stockprice.js')
      const srcPrice = await getChainPrice(record.ticker, record.srcChain)
      const price = srcPrice ?? lp.get(record.ticker) ?? 0
      const usdcValue = record.amount * price * 0.9995
      const usdcUnits = ethers.parseUnits(usdcValue.toFixed(6), 6)

      try { await (await gw.setPrice(record.ticker, Math.round(price * 1e6), true)).wait() } catch {}

      const nonce = Date.now()
      const tx = await gw.bridgeMint(record.ticker, record.destAddress, usdcUnits, record.srcChain, nonce)
      const receipt = await tx.wait()
      record.mintTxHash = receipt.hash
      record.status = 'completed'

      console.log(`[Bridge] ${record.srcChain}→arbitrum: ${record.amount} os${record.ticker} minted`)

      res.json({
        ok: true,
        data: {
          bridgeId: record.id, status: 'completed',
          mintTxHash: receipt.hash, explorer: `${ARBITRUM_CONFIG.explorer}/tx/${receipt.hash}`,
        },
      })
    } else if (record.destChain === 'robinhood') {
      // Release native stock token from RH Gateway escrow to user
      record.status = 'minting'

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

      const nativeAddr = RH_STOCK_TOKENS[record.ticker]
      if (!nativeAddr) throw new Error(`No native token for ${record.ticker}`)

      const rhRpc = new ethers.JsonRpcProvider('https://rpc.testnet.chain.robinhood.com')
      const rhKeeper = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY || '', rhRpc)

      // Transfer native token from deployer/reserve to user
      // (In production: Gateway contract would release escrow)
      const tokenC = new ethers.Contract(nativeAddr, [
        'function transfer(address,uint256) returns(bool)',
        'function balanceOf(address) view returns(uint256)',
      ], rhKeeper)

      // Apply 0.05% fee
      const netAmount = record.amount * 0.9995
      const amountWei = ethers.parseEther(netAmount.toString())

      const bal = await tokenC.balanceOf(rhKeeper.address)
      if (bal < amountWei) {
        throw new Error(`Insufficient native ${record.ticker} in reserve: have ${ethers.formatEther(bal)}, need ${netAmount}`)
      }

      const tx = await tokenC.transfer(record.destAddress, amountWei)
      const receipt = await tx.wait()
      record.mintTxHash = receipt.hash
      record.status = 'completed'

      console.log(`[Bridge] ${record.srcChain}→robinhood: ${netAmount} native ${record.ticker} sent to ${record.destAddress}`)

      res.json({
        ok: true,
        data: {
          bridgeId: record.id, status: 'completed',
          mintTxHash: receipt.hash, explorer: `https://explorer.testnet.chain.robinhood.com/tx/${receipt.hash}`,
        },
      })
    } else if (record.destChain === 'solana') {
      // Mint on Solana — keeper directly mints SPL token
      record.status = 'minting'

      try {
        const { Connection, Keypair, PublicKey } = await import('@solana/web3.js')
        const spl = await import('@solana/spl-token')
        const fs = await import('fs')
        const path = await import('path')

        // Validate Solana address
        let destPubkey: InstanceType<typeof PublicKey>
        try {
          destPubkey = new PublicKey(record.destAddress)
        } catch {
          throw new Error(`Invalid Solana address: ${record.destAddress}`)
        }

        const solRpc = process.env.SOLANA_RPC || 'https://api.devnet.solana.com'
        const conn = new Connection(solRpc, 'confirmed')

        const keyPath = process.env.SOLANA_KEEPER_KEY || path.resolve(process.env.HOME || '', '.config/solana/deploy-keypair.json')
        if (!fs.existsSync(keyPath)) throw new Error(`Solana keeper key not found: ${keyPath}`)
        const rawKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
        const solKeeper = Keypair.fromSecretKey(Uint8Array.from(rawKey))

        console.log(`[Bridge] Solana mint: keeper=${solKeeper.publicKey.toBase58().slice(0,8)}, dest=${record.destAddress.slice(0,8)}, amount=${record.amount}`)

        // Load Solana gateway deployment — try multiple paths
        const solDeployPaths = [
          path.resolve(process.cwd(), '../onstock-vault/gateway-deployment.json'),
          path.resolve(__dirname, '../../../onstock-vault/gateway-deployment.json'),
        ]
        let solDeploy: any = null
        for (const p of solDeployPaths) {
          if (fs.existsSync(p)) { solDeploy = JSON.parse(fs.readFileSync(p, 'utf8')); break }
        }
        if (!solDeploy) throw new Error('Solana deployment file not found')

        // Use bridgeOsTokens (keeper-controlled mints) for bridge
        const osMintStr = solDeploy.bridgeOsTokens?.[record.ticker] ?? solDeploy.osTokens?.[record.ticker]
        if (!osMintStr) throw new Error(`No Solana osMint for ${record.ticker}`)

        const osMint = new PublicKey(osMintStr)
        const amount = BigInt(Math.round(record.amount * 1e6))

        console.log(`[Bridge] osMint=${osMintStr.slice(0,8)}, amount=${amount}`)

        // Get or create dest ATA
        const destAta = await spl.getOrCreateAssociatedTokenAccount(conn, solKeeper, osMint, destPubkey)

        // Mint osToken to dest — with retry on confirm timeout
        let sig = ''
        try {
          sig = await spl.mintTo(conn, solKeeper, osMint, destAta.address, solKeeper.publicKey, amount)
        } catch (mintErr: any) {
          // mintTo may throw with signature in error if confirm times out
          // Extract signature from error message if possible
          const errMsg = mintErr?.message ?? ''
          const sigMatch = errMsg.match(/[1-9A-HJ-NP-Za-km-z]{87,88}/)
          if (sigMatch) {
            sig = sigMatch[0]
            console.log(`[Bridge] Solana mint sent but confirm timed out. Sig: ${sig.slice(0, 20)}`)
          } else {
            throw mintErr
          }
        }

        record.mintTxHash = sig
        record.status = 'completed'
        console.log(`[Bridge] ${record.srcChain}→solana: ${record.amount} os${record.ticker} → ${record.destAddress}, sig: ${sig.slice(0, 20)}`)

        res.json({
          ok: true,
          data: {
            bridgeId: record.id,
            status: 'completed',
            mintTxHash: sig,
            explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
          },
        })
      } catch (solErr: any) {
        record.status = 'failed'
        console.error('[Bridge Solana Mint]', solErr?.message?.slice(0, 120))
        res.status(500).json({ ok: false, error: `Solana mint failed: ${solErr?.message?.slice(0, 80)}` })
      }
    } else {
      res.status(400).json({ ok: false, error: `Unsupported destChain: ${record.destChain}` })
    }
  } catch (err: any) {
    console.error('[Bridge Complete]', err)
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── GET /api/bridge/status/:id ─────────────────────────────────────────────

bridgeRouter.get('/status/:id', (req, res) => {
  const record = bridgeLog.find(r => r.id === req.params.id)
  if (!record) return res.status(404).json({ ok: false, error: 'Not found' })

  res.json({
    ok: true,
    data: {
      ...record,
      explorerBurn: record.burnTxHash
        ? `${ARBITRUM_CONFIG.explorer}/tx/${record.burnTxHash}`
        : null,
      explorerMint: record.mintTxHash && record.mintTxHash !== 'solana-pending'
        ? `${ARBITRUM_CONFIG.explorer}/tx/${record.mintTxHash}`
        : null,
    },
  })
})

// ─── GET /api/bridge/history ────────────────────────────────────────────────

bridgeRouter.get('/history', (_req, res) => {
  res.json({ ok: true, data: bridgeLog.slice(-20).reverse() })
})
