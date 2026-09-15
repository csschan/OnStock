const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js')
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
        createAssociatedTokenAccountInstruction, getAccount } = require('@solana/spl-token')
const crypto = require('crypto')
const fs = require('fs'), path = require('path')

const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR'
const PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')
const VAULT_SEED = Buffer.from('vault')
const RECEIPT_SEED = Buffer.from('receipt')
const DEPOSIT_DISC = crypto.createHash('sha256').update('global:deposit').digest().slice(0, 8)

const MINTS = {
  AAPLx: 'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
  GOOGLx:'3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
  METAx: '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
}
const SEED_AMOUNTS = { AAPLx: 8, GOOGLx: 12, METAx: 6 }

async function depositToVault(conn, authority, sym, mintStr, amount) {
  const mintPk = new PublicKey(mintStr)
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED, mintPk.toBuffer()], PROGRAM_ID)
  const [receiptMint] = PublicKey.findProgramAddressSync([RECEIPT_SEED, mintPk.toBuffer()], PROGRAM_ID)
  const userXstockAta  = getAssociatedTokenAddressSync(mintPk, authority.publicKey)
  const vaultXstockAta = getAssociatedTokenAddressSync(mintPk, vaultPda, true)
  const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, authority.publicKey, false, TOKEN_PROGRAM_ID)
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), vaultPda.toBuffer(), authority.publicKey.toBuffer()], PROGRAM_ID
  )
  const amountBuf = Buffer.alloc(8)
  amountBuf.writeBigUInt64LE(BigInt(amount * 10 ** 6))
  const tx = new Transaction()
  tx.feePayer = authority.publicKey
  try { await getAccount(conn, userReceiptAta, 'confirmed', TOKEN_PROGRAM_ID) }
  catch { tx.add(createAssociatedTokenAccountInstruction(authority.publicKey, userReceiptAta, authority.publicKey, receiptMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)) }
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultPda,            isSigner: false, isWritable: true },
      { pubkey: receiptMint,         isSigner: false, isWritable: true },
      { pubkey: userXstockAta,       isSigner: false, isWritable: true },
      { pubkey: vaultXstockAta,      isSigner: false, isWritable: true },
      { pubkey: userReceiptAta,      isSigner: false, isWritable: true },
      { pubkey: userPositionPda,     isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DEPOSIT_DISC, amountBuf]),
  }))
  const { blockhash } = await conn.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.sign(authority)
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 })
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const status = await conn.getSignatureStatus(sig)
    const conf = status?.value?.confirmationStatus
    if (conf === 'confirmed' || conf === 'finalized') return sig
    if (status?.value?.err) throw new Error(JSON.stringify(status.value.err))
  }
  return sig
}

async function main() {
  const conn = new Connection(RPC, 'confirmed')
  const kp = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.config/solana/deploy-keypair.json'), 'utf8'))
  const authority = Keypair.fromSecretKey(Uint8Array.from(kp))
  console.log('Authority:', authority.publicKey.toBase58())
  for (const [sym, mintStr] of Object.entries(MINTS)) {
    try {
      const sig = await depositToVault(conn, authority, sym, mintStr, SEED_AMOUNTS[sym])
      console.log(`✓ ${sym} seeded ${SEED_AMOUNTS[sym]} tokens | ${sig.slice(0,16)}...`)
    } catch(e) { console.error(`✗ ${sym}:`, e.message) }
  }
  console.log('Done.')
}
main().catch(e => { console.error(e.message); process.exit(1) })
