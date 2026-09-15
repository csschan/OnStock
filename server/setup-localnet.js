#!/usr/bin/env node
/**
 * setup-localnet.js
 * 在 localnet 上创建所有 xStock token mints，并打印新地址
 * 运行: node setup-localnet.js
 */

const {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js')
const {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
  MINT_SIZE,
} = require('@solana/spl-token')
const fs = require('fs')
const path = require('path')

const RPC = 'http://127.0.0.1:8899'
const DECIMALS = 6

const SYMBOLS = ['TSLAx', 'NVDAx', 'SPYx', 'AAPLx', 'GOOGLx', 'METAx', 'COINx', 'MSTRx']

async function main() {
  const connection = new Connection(RPC, 'confirmed')

  const keypairPath = process.env.MINT_AUTHORITY_KEYPAIR
    || path.join(process.env.HOME, '.config/solana/deploy-keypair.json')
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  )
  console.log('Authority:', authority.publicKey.toBase58())

  // Airdrop SOL if needed
  const bal = await connection.getBalance(authority.publicKey)
  if (bal < 1e9) {
    console.log('Airdropping 10 SOL to authority...')
    const sig = await connection.requestAirdrop(authority.publicKey, 10e9)
    await connection.confirmTransaction(sig, 'confirmed')
    console.log('Airdrop done')
  }

  const mints = {}

  for (const sym of SYMBOLS) {
    const mintKp = Keypair.generate()
    const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKp.publicKey,
        DECIMALS,
        authority.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    )
    const { blockhash } = await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = authority.publicKey

    await sendAndConfirmTransaction(connection, tx, [authority, mintKp], { commitment: 'confirmed' })
    mints[sym] = mintKp.publicKey.toBase58()
    console.log(`✓ ${sym}: ${mintKp.publicKey.toBase58()}`)
  }

  console.log('\n=== DEVNET_MINTS (copy to routes.ts) ===')
  for (const [sym, addr] of Object.entries(mints)) {
    console.log(`      ${sym}: '${addr}',`)
  }

  // Write to a JSON file for easy reference
  fs.writeFileSync(
    path.join(__dirname, 'localnet-mints.json'),
    JSON.stringify(mints, null, 2)
  )
  console.log('\nSaved to localnet-mints.json')
}

main().catch(err => { console.error(err); process.exit(1) })
