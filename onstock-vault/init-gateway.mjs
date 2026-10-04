/**
 * Initialize Solana OS-Gateway:
 * 1. Create Gateway PDA
 * 2. Create osToken mints (osTSLA, osNVDA, etc.) with Gateway as mint authority
 * 3. Register each asset in the Gateway
 * 4. Push initial prices
 *
 * Usage: node init-gateway.mjs
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { createMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import fs from 'fs'
import path from 'path'

const PROGRAM_ID = new PublicKey('76R7gyAYTFTnKPW3ePx44KTm1AQgRRqQopxTpGxpSy6G')
const GATEWAY_SEED = Buffer.from('gateway')
const ASSET_SEED = Buffer.from('asset')

// Devnet USDC — we'll create a mock
const RPC = 'https://api.devnet.solana.com'

const STOCKS = ['TSLA', 'NVDA', 'AAPL', 'SPY', 'GOOGL', 'META', 'COIN', 'MSTR']

// Initial prices (USD, will be updated by keeper)
const INITIAL_PRICES = {
  TSLA: 372, NVDA: 138, AAPL: 228, SPY: 596,
  GOOGL: 169, META: 596, COIN: 265, MSTR: 368,
}

async function main() {
  const connection = new Connection(RPC, 'confirmed')

  // Load deployer keypair
  const keyPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/deploy-keypair.json`
  const rawKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
  const deployer = Keypair.fromSecretKey(Uint8Array.from(rawKey))
  console.log('Deployer:', deployer.publicKey.toBase58())
  console.log('Balance:', (await connection.getBalance(deployer.publicKey)) / 1e9, 'SOL')

  // Step 1: Create mock USDC mint (devnet)
  console.log('\n── Step 1: Create USDC mint ──')
  let usdcMint
  const deployFile = path.resolve('./gateway-deployment.json')
  let deployment = {}
  if (fs.existsSync(deployFile)) {
    deployment = JSON.parse(fs.readFileSync(deployFile, 'utf8'))
  }

  if (deployment.usdcMint) {
    usdcMint = new PublicKey(deployment.usdcMint)
    console.log('USDC mint (existing):', usdcMint.toBase58())
  } else {
    usdcMint = await createMint(connection, deployer, deployer.publicKey, null, 6)
    console.log('USDC mint (new):', usdcMint.toBase58())
    deployment.usdcMint = usdcMint.toBase58()
    fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2))
  }

  // Step 2: Derive Gateway PDA
  console.log('\n── Step 2: Initialize Gateway ──')
  const [gatewayPda, gatewayBump] = PublicKey.findProgramAddressSync(
    [GATEWAY_SEED, usdcMint.toBuffer()],
    PROGRAM_ID,
  )
  console.log('Gateway PDA:', gatewayPda.toBase58(), 'bump:', gatewayBump)

  // Check if already initialized
  const gatewayAccount = await connection.getAccountInfo(gatewayPda)
  if (gatewayAccount) {
    console.log('Gateway already initialized, skipping...')
  } else {
    // Build initialize instruction manually
    // Anchor discriminator: sha256("global:initialize")[0..8]
    const crypto = await import('crypto')
    const disc = crypto.createHash('sha256').update('global:initialize').digest().subarray(0, 8)

    // Data: discriminator + bump (u8)
    const data = Buffer.alloc(9)
    disc.copy(data)
    data.writeUInt8(gatewayBump, 8)

    const initIx = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },  // authority
        { pubkey: usdcMint, isSigner: false, isWritable: false },          // usdc_mint
        { pubkey: gatewayPda, isSigner: false, isWritable: true },         // gateway
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })

    const tx = new Transaction().add(initIx)
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer])
    console.log('Gateway initialized:', sig)
  }

  deployment.gateway = gatewayPda.toBase58()
  deployment.gatewayBump = gatewayBump

  // Step 3: Create osToken mints + register assets
  console.log('\n── Step 3: Create osToken mints & register assets ──')
  const osTokens = {}

  for (const ticker of STOCKS) {
    console.log(`\n  ${ticker}:`)

    // Check if already registered
    if (deployment.osTokens?.[ticker]) {
      console.log(`    Already registered: ${deployment.osTokens[ticker]}`)
      osTokens[ticker] = deployment.osTokens[ticker]
      continue
    }

    // Create osToken mint with Gateway PDA as mint authority
    const osMint = await createMint(
      connection, deployer,
      gatewayPda,  // mint authority = gateway PDA (so program can mint)
      null,        // no freeze authority
      6,           // 6 decimals like USDC
    )
    console.log(`    osMint: ${osMint.toBase58()}`)
    osTokens[ticker] = osMint.toBase58()

    // Derive AssetInfo PDA
    const [assetPda, assetBump] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, gatewayPda.toBuffer(), Buffer.from(ticker)],
      PROGRAM_ID,
    )
    console.log(`    assetPDA: ${assetPda.toBase58()} bump: ${assetBump}`)

    // Build register_asset instruction
    const crypto2 = await import('crypto')
    const regDisc = crypto2.createHash('sha256').update('global:register_asset').digest().subarray(0, 8)

    // Borsh encode: discriminator + ticker (string: 4 bytes len + chars) + asset_bump (u8)
    const tickerBytes = Buffer.from(ticker)
    const dataLen = 8 + 4 + tickerBytes.length + 1
    const data = Buffer.alloc(dataLen)
    let offset = 0
    regDisc.copy(data, offset); offset += 8
    data.writeUInt32LE(tickerBytes.length, offset); offset += 4
    tickerBytes.copy(data, offset); offset += tickerBytes.length
    data.writeUInt8(assetBump, offset)

    const regIx = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },   // authority
        { pubkey: gatewayPda, isSigner: false, isWritable: true },          // gateway
        { pubkey: assetPda, isSigner: false, isWritable: true },            // asset_info
        { pubkey: osMint, isSigner: false, isWritable: false },             // os_mint
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })

    try {
      const tx = new Transaction().add(regIx)
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer])
      console.log(`    Registered: ${sig}`)
    } catch (e) {
      console.log(`    Register failed: ${e.message?.slice(0, 80)}`)
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500))
  }

  deployment.osTokens = osTokens

  // Step 4: Push initial prices
  console.log('\n── Step 4: Push initial prices ──')
  for (const ticker of STOCKS) {
    const priceUsd = INITIAL_PRICES[ticker]
    if (!priceUsd) continue

    const [assetPda] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, gatewayPda.toBuffer(), Buffer.from(ticker)],
      PROGRAM_ID,
    )

    // Build set_price instruction
    const crypto3 = await import('crypto')
    const priceDisc = crypto3.createHash('sha256').update('global:set_price').digest().subarray(0, 8)
    const tickerBytes = Buffer.from(ticker)
    const priceUnits = BigInt(Math.round(priceUsd * 1e6))

    // Data: disc + ticker(string) + price_usd(u64) + market_open(bool)
    const dataLen = 8 + 4 + tickerBytes.length + 8 + 1
    const data = Buffer.alloc(dataLen)
    let offset = 0
    priceDisc.copy(data, offset); offset += 8
    data.writeUInt32LE(tickerBytes.length, offset); offset += 4
    tickerBytes.copy(data, offset); offset += tickerBytes.length
    data.writeBigUInt64LE(priceUnits, offset); offset += 8
    data.writeUInt8(0, offset) // market closed (weekend)

    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: false }, // keeper
        { pubkey: gatewayPda, isSigner: false, isWritable: false },        // gateway
        { pubkey: assetPda, isSigner: false, isWritable: true },           // asset_info
      ],
      data,
    })

    try {
      const tx = new Transaction().add(ix)
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer])
      console.log(`  ${ticker}: $${priceUsd} → ${sig.slice(0, 20)}...`)
    } catch (e) {
      console.log(`  ${ticker}: failed — ${e.message?.slice(0, 60)}`)
    }

    await new Promise(r => setTimeout(r, 300))
  }

  // Save deployment
  deployment.programId = PROGRAM_ID.toBase58()
  deployment.deployer = deployer.publicKey.toBase58()
  deployment.network = 'devnet'
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2))
  console.log(`\n✅ Saved to ${deployFile}`)
  console.log('\nGateway:', gatewayPda.toBase58())
  console.log('USDC:', usdcMint.toBase58())
  console.log('Assets:', Object.keys(osTokens).length)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
