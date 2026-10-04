/**
 * Solana OS-Gateway API Routes
 *
 * - GET  /api/sol-gateway/info          — Gateway addresses + registered assets
 * - GET  /api/sol-gateway/asset/:ticker — On-chain asset info (price, supply)
 * - POST /api/sol-gateway/mint          — Build mint instruction for user to sign
 * - POST /api/sol-gateway/push-prices   — Keeper: push prices to Solana gateway
 */

import { Router } from 'express'
import { Connection, PublicKey, Transaction, Keypair, SystemProgram } from '@solana/web3.js'
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getMint, getAccount } from '@solana/spl-token'
import { latestPrices } from '../fetchers/stockprice.js'
import { getMarketStatus } from '../config/marketStatus.js'
import * as crypto from 'crypto'

export const solGatewayRouter = Router()

const PROGRAM_ID = new PublicKey('76R7gyAYTFTnKPW3ePx44KTm1AQgRRqQopxTpGxpSy6G')
const GATEWAY_SEED = Buffer.from('gateway')
const ASSET_SEED = Buffer.from('asset')
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com'
const connection = new Connection(RPC, 'confirmed')

// Load deployment
interface SolGatewayDeploy {
  gateway: string
  gatewayBump: number
  usdcMint: string
  osTokens: Record<string, string>
  programId: string
}

function loadSolDeploy(): SolGatewayDeploy | null {
  try {
    const fs = require('fs')
    const path = require('path')
    const f = path.resolve(__dirname, '../../../onstock-vault/gateway-deployment.json')
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch { return null }
}

const deploy = loadSolDeploy()

// Load keeper keypair
function loadKeeper(): Keypair | null {
  try {
    const fs = require('fs')
    const keyPath = process.env.SOLANA_KEEPER_KEY || `${process.env.HOME}/.config/solana/deploy-keypair.json`
    if (!fs.existsSync(keyPath)) return null
    const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
    return Keypair.fromSecretKey(Uint8Array.from(raw))
  } catch { return null }
}

const keeper = loadKeeper()

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDisc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

function getGatewayPda(): [PublicKey, number] {
  if (!deploy) throw new Error('No deployment')
  return PublicKey.findProgramAddressSync(
    [GATEWAY_SEED, new PublicKey(deploy.usdcMint).toBuffer()],
    PROGRAM_ID,
  )
}

function getAssetPda(ticker: string): [PublicKey, number] {
  const [gatewayPda] = getGatewayPda()
  return PublicKey.findProgramAddressSync(
    [ASSET_SEED, gatewayPda.toBuffer(), Buffer.from(ticker)],
    PROGRAM_ID,
  )
}

// ─── GET /api/sol-gateway/info ──────────────────────────────────────────────

solGatewayRouter.get('/info', (_req, res) => {
  if (!deploy) return res.json({ ok: false, error: 'Solana Gateway not deployed' })

  res.json({
    ok: true,
    data: {
      chain: 'solana-devnet',
      programId: deploy.programId,
      gateway: deploy.gateway,
      usdcMint: deploy.usdcMint,
      osTokens: deploy.osTokens,
      assetCount: Object.keys(deploy.osTokens).length,
      keeper: keeper?.publicKey.toBase58() ?? null,
    },
  })
})

// ─── GET /api/sol-gateway/asset/:ticker ─────────────────────────────────────

solGatewayRouter.get('/asset/:ticker', async (req, res) => {
  if (!deploy) return res.json({ ok: false, error: 'Not deployed' })

  try {
    const ticker = req.params.ticker.toUpperCase()
    const osMintStr = deploy.osTokens[ticker]
    if (!osMintStr) return res.status(404).json({ ok: false, error: `Unknown: ${ticker}` })

    // Read AssetInfo account
    const [assetPda] = getAssetPda(ticker)
    const accountInfo = await connection.getAccountInfo(assetPda)

    let priceUsd = 0
    let marketOpen = false
    let totalMinted = 0
    let totalRedeemed = 0

    if (accountInfo && accountInfo.data.length > 8) {
      // Parse AssetInfo: skip 8-byte discriminator
      // ticker: 4-byte len + chars, os_mint: 32 bytes, price_usd: u64, last_price_update: i64, market_open: bool, total_minted: u64, total_redeemed: u64
      const data = accountInfo.data
      let offset = 8
      const tickerLen = data.readUInt32LE(offset); offset += 4 + tickerLen
      offset += 32 // os_mint
      priceUsd = Number(data.readBigUInt64LE(offset)) / 1e6; offset += 8
      offset += 8 // last_price_update
      marketOpen = data.readUInt8(offset) === 1; offset += 1
      totalMinted = Number(data.readBigUInt64LE(offset)) / 1e6; offset += 8
      totalRedeemed = Number(data.readBigUInt64LE(offset)) / 1e6
    }

    // Get osToken supply
    const osMint = new PublicKey(osMintStr)
    let totalSupply = 0
    try {
      const mintInfo = await getMint(connection, osMint)
      totalSupply = Number(mintInfo.supply) / 1e6
    } catch {}

    const yahooPrice = latestPrices.get(ticker) ?? null

    res.json({
      ok: true,
      data: {
        ticker,
        chain: 'solana-devnet',
        osMint: osMintStr,
        oraclePrice: priceUsd,
        yahooPrice,
        marketOpen,
        totalMinted,
        totalRedeemed,
        totalSupply,
      },
    })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/sol-gateway/push-prices ──────────────────────────────────────

solGatewayRouter.post('/push-prices', async (_req, res) => {
  if (!deploy || !keeper) return res.json({ ok: false, error: 'Not configured' })

  try {
    const [gatewayPda] = getGatewayPda()
    const market = getMarketStatus()
    const disc = getDisc('set_price')
    const results: { ticker: string; price: number; sig?: string; error?: string }[] = []

    for (const ticker of Object.keys(deploy.osTokens)) {
      const price = latestPrices.get(ticker)
      if (!price) continue

      const [assetPda] = getAssetPda(ticker)
      const tickerBytes = Buffer.from(ticker)
      const priceUnits = BigInt(Math.round(price * 1e6))

      const dataLen = 8 + 4 + tickerBytes.length + 8 + 1
      const data = Buffer.alloc(dataLen)
      let offset = 0
      disc.copy(data, offset); offset += 8
      data.writeUInt32LE(tickerBytes.length, offset); offset += 4
      tickerBytes.copy(data, offset); offset += tickerBytes.length
      data.writeBigUInt64LE(priceUnits, offset); offset += 8
      data.writeUInt8(market.isOpen ? 1 : 0, offset)

      const ix = {
        programId: PROGRAM_ID,
        keys: [
          { pubkey: keeper.publicKey, isSigner: true, isWritable: false },
          { pubkey: gatewayPda, isSigner: false, isWritable: false },
          { pubkey: assetPda, isSigner: false, isWritable: true },
        ],
        data,
      }

      try {
        const tx = new Transaction().add(ix)
        tx.feePayer = keeper.publicKey
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
        tx.sign(keeper)
        const sig = await connection.sendRawTransaction(tx.serialize())
        await connection.confirmTransaction(sig, 'confirmed')
        results.push({ ticker, price, sig: sig.slice(0, 20) + '...' })
      } catch (e: any) {
        results.push({ ticker, price, error: e.message?.slice(0, 60) })
      }

      await new Promise(r => setTimeout(r, 300))
    }

    console.log(`[SolGateway] Pushed ${results.filter(r => r.sig).length}/${results.length} prices`)
    res.json({ ok: true, data: { pushed: results.filter(r => r.sig).length, results } })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message })
  }
})

// ─── POST /api/sol-gateway/mint ─────────────────────────────────────────────
// Build mint_os instruction for user to sign in Phantom

solGatewayRouter.post('/mint', async (req, res) => {
  if (!deploy || !keeper) return res.json({ ok: false, error: 'Not configured' })

  try {
    const { ticker, usdcAmount, walletAddress } = req.body as {
      ticker: string; usdcAmount: number; walletAddress: string
    }
    if (!ticker || !usdcAmount || !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Missing params' })
    }

    const tickerUp = ticker.toUpperCase()
    const osMintStr = deploy.osTokens[tickerUp]
    if (!osMintStr) return res.status(400).json({ ok: false, error: `Unknown: ${tickerUp}` })

    // Push fresh price first
    const yahooPrice = latestPrices.get(tickerUp)
    if (yahooPrice) {
      const [gatewayPda] = getGatewayPda()
      const [assetPda] = getAssetPda(tickerUp)
      const market = getMarketStatus()
      const disc = getDisc('set_price')
      const tickerBytes = Buffer.from(tickerUp)
      const priceUnits = BigInt(Math.round(yahooPrice * 1e6))
      const dataLen = 8 + 4 + tickerBytes.length + 8 + 1
      const data = Buffer.alloc(dataLen)
      let off = 0
      disc.copy(data, off); off += 8
      data.writeUInt32LE(tickerBytes.length, off); off += 4
      tickerBytes.copy(data, off); off += tickerBytes.length
      data.writeBigUInt64LE(priceUnits, off); off += 8
      data.writeUInt8(market.isOpen ? 1 : 0, off)

      const priceTx = new Transaction().add({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: keeper.publicKey, isSigner: true, isWritable: false },
          { pubkey: gatewayPda, isSigner: false, isWritable: false },
          { pubkey: assetPda, isSigner: false, isWritable: true },
        ],
        data,
      })
      priceTx.feePayer = keeper.publicKey
      priceTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
      priceTx.sign(keeper)
      try {
        const sig = await connection.sendRawTransaction(priceTx.serialize())
        await connection.confirmTransaction(sig, 'confirmed')
      } catch {}
    }

    // Mint mock USDC to user (devnet only)
    const usdcMint = new PublicKey(deploy.usdcMint)
    const userPubkey = new PublicKey(walletAddress)
    const usdcUnits = BigInt(Math.round(usdcAmount * 1e6))

    // Create user USDC ATA if needed, then mint
    const { createMint, mintTo } = await import('@solana/spl-token')
    const spl = await import('@solana/spl-token')

    const userUsdcAta = await getAssociatedTokenAddress(usdcMint, userPubkey)
    const mintTx = new Transaction()

    // Check if ATA exists
    const ataInfo = await connection.getAccountInfo(userUsdcAta)
    if (!ataInfo) {
      mintTx.add(createAssociatedTokenAccountInstruction(keeper.publicKey, userUsdcAta, userPubkey, usdcMint))
    }

    // Mint USDC to user
    mintTx.add(spl.createMintToInstruction(usdcMint, userUsdcAta, keeper.publicKey, usdcUnits))
    mintTx.feePayer = keeper.publicKey
    mintTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    mintTx.sign(keeper)
    let mintSig = ''
    try {
      mintSig = await connection.sendRawTransaction(mintTx.serialize())
      await connection.confirmTransaction(mintSig, 'confirmed')
      console.log(`[SolGateway] Minted ${usdcAmount} USDC to ${walletAddress}`)
    } catch (e: any) {
      console.warn(`[SolGateway] USDC mint failed: ${e.message?.slice(0, 60)}`)
    }

    // Build mint_os instruction for user to sign in Phantom
    const [gatewayPda] = getGatewayPda()
    const [assetPda] = getAssetPda(tickerUp)
    const osMint = new PublicKey(osMintStr)
    const userOsAta = await getAssociatedTokenAddress(osMint, userPubkey)
    const gatewayUsdcAta = await getAssociatedTokenAddress(usdcMint, gatewayPda, true)

    const disc = getDisc('mint_os')
    const mintData = Buffer.alloc(8 + 8)
    disc.copy(mintData, 0)
    mintData.writeBigUInt64LE(usdcUnits, 8)

    // Return unsigned instruction for frontend
    const osAmount = yahooPrice ? (usdcAmount * 0.999 / yahooPrice) : 0

    res.json({
      ok: true,
      data: {
        chain: 'solana-devnet',
        ticker: tickerUp,
        usdcMinted: usdcAmount,
        usdcMintSig: mintSig,
        oraclePrice: yahooPrice,
        expectedOsOut: Number(osAmount.toFixed(6)),
        // Instruction details for frontend to build tx
        instruction: {
          programId: PROGRAM_ID.toBase58(),
          gatewayPda: gatewayPda.toBase58(),
          assetPda: assetPda.toBase58(),
          osMint: osMintStr,
          userOsAta: userOsAta.toBase58(),
          userUsdcAta: userUsdcAta.toBase58(),
          gatewayUsdcAta: gatewayUsdcAta.toBase58(),
          usdcMint: deploy.usdcMint,
          data: mintData.toString('base64'),
        },
        explorer: `https://explorer.solana.com/tx/${mintSig}?cluster=devnet`,
      },
    })
  } catch (err: any) {
    console.error('[SolGateway Mint]', err)
    res.status(500).json({ ok: false, error: err?.message })
  }
})
