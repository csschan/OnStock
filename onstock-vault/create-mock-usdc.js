/**
 * One-time script: Create a test USDC mint on devnet (no WebSocket needed).
 * Run: node create-mock-usdc.js
 */
const {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction,
} = require('@solana/web3.js')
const {
  TOKEN_PROGRAM_ID,
  MintLayout,
  createInitializeMintInstruction,
} = require('@solana/spl-token')
const fs = require('fs'), path = require('path')

const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR'
const MINT_DECIMALS = 6

async function pollConfirm(conn, sig) {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const s = await conn.getSignatureStatus(sig)
    const c = s?.value?.confirmationStatus
    if (c === 'confirmed' || c === 'finalized') return
    if (s?.value?.err) throw new Error(`Tx failed: ${JSON.stringify(s.value.err)}`)
  }
  throw new Error('Confirmation timeout')
}

async function main() {
  const conn = new Connection(RPC, 'confirmed')
  const kp = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.config/solana/deploy-keypair.json'), 'utf8'))
  const payer = Keypair.fromSecretKey(Uint8Array.from(kp))
  console.log('Payer:', payer.publicKey.toBase58())

  // Generate a new keypair for the mint
  const mintKp = Keypair.generate()
  console.log('New mint keypair:', mintKp.publicKey.toBase58())

  const lamports = await conn.getMinimumBalanceForRentExemption(MintLayout.span)

  const tx = new Transaction()
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MintLayout.span,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKp.publicKey,
      MINT_DECIMALS,
      payer.publicKey,  // mint authority
      payer.publicKey,  // freeze authority
      TOKEN_PROGRAM_ID,
    )
  )

  const { blockhash } = await conn.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer, mintKp)

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 })
  console.log('Tx sent:', sig)
  await pollConfirm(conn, sig)

  console.log('\n✓ Mock USDC mint created:', mintKp.publicKey.toBase58())
  console.log('\nAdd this to routes.ts / faucet config:')
  console.log(`MOCK_USDC_MINT = '${mintKp.publicKey.toBase58()}'`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
