#!/usr/bin/env node
/**
 * create-prestocks-devnet.js
 * Create 9 mock PreStocks SPL token mints on Solana devnet
 * Appends results to devnet-mints.json
 *
 * Usage: node create-prestocks-devnet.js
 */

const {
  Connection, Keypair, PublicKey, Transaction,
} = require('@solana/web3.js')
const {
  createInitializeMint2Instruction,
  TOKEN_PROGRAM_ID,
  MintLayout,
  getMinimumBalanceForRentExemptMint,
} = require('@solana/spl-token')
const { SystemProgram } = require('@solana/web3.js')
const fs = require('fs'), path = require('path')

const RPC = process.env.SOLANA_RPC || 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR'
const DECIMALS = 6

const PRESTOCKS = [
  'ANTHROPIC',
  'OPENAI',
  'SPACEX',
  'ANDURIL',
  'NEURALINK',
  'FIGUREAI',
  'XAI',
  'POLYMARKET',
  'KALSHI',
]

async function main() {
  const conn = new Connection(RPC, 'confirmed')

  // Load payer keypair
  const keypairPath = path.join(process.env.HOME, '.config/solana/deploy-keypair.json')
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  )
  console.log('Payer:', payer.publicKey.toBase58())

  const balance = await conn.getBalance(payer.publicKey)
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`)
  if (balance < 0.05 * 1e9) {
    console.error('Low balance — airdrop first: solana airdrop 1 --url devnet')
    process.exit(1)
  }

  // Load existing mints
  const mintsPath = path.join(__dirname, 'devnet-mints.json')
  const existing = JSON.parse(fs.readFileSync(mintsPath, 'utf8'))

  const lamports = await getMinimumBalanceForRentExemptMint(conn)
  const results = {}

  for (const symbol of PRESTOCKS) {
    // Skip only if already exists AND we haven't forced recreation
    if (existing[symbol] && !process.env.FORCE_RECREATE) {
      console.log(`✓ ${symbol} already exists: ${existing[symbol]}`)
      results[symbol] = existing[symbol]
      continue
    }

    const mintKp = Keypair.generate()
    console.log(`Creating ${symbol} mint: ${mintKp.publicKey.toBase58()}`)

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MintLayout.span,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKp.publicKey,
        DECIMALS,
        payer.publicKey,   // mint authority
        null,              // no freeze authority (matches TSLAx/xStock mints)
        TOKEN_PROGRAM_ID,
      )
    )

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = payer.publicKey
    tx.sign(payer, mintKp)

    try {
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })

      // Poll for confirmation (Alchemy devnet doesn't support signatureSubscribe)
      let confirmed = false
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const status = await conn.getSignatureStatuses([sig])
        const s = status?.value?.[0]
        if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
          confirmed = true
          break
        }
        if (s?.err) {
          throw new Error(`tx error: ${JSON.stringify(s.err)}`)
        }
      }

      if (!confirmed) throw new Error('Timed out waiting for confirmation')
      console.log(`  ✓ ${symbol}: ${mintKp.publicKey.toBase58()}`)
      results[symbol] = mintKp.publicKey.toBase58()
    } catch (err) {
      console.error(`  ✗ ${symbol} failed:`, err.message)
    }

    // Short delay between txs
    await new Promise(r => setTimeout(r, 1000))
  }

  // Merge and write back
  const merged = { ...existing, ...results }
  fs.writeFileSync(mintsPath, JSON.stringify(merged, null, 2))
  console.log('\nUpdated devnet-mints.json:')
  console.log(JSON.stringify(merged, null, 2))
  console.log('\nNext: node init-vaults-devnet.js')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
