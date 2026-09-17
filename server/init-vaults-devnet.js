#!/usr/bin/env node
/**
 * init-vaults-devnet.js
 * 为每个 xStock mint 初始化 OnStock Vault（devnet）
 * 部署合约后运行: node init-vaults-devnet.js
 */

const {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, SYSVAR_RENT_PUBKEY, sendAndConfirmTransaction,
} = require('@solana/web3.js')
const {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token')
const fs = require('fs'), path = require('path')
const crypto = require('crypto')

const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR'
const PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')
const VAULT_SEED = Buffer.from('vault')
const RECEIPT_SEED = Buffer.from('receipt')

// sha256("global:initialize_vault")[0..8]
function disc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8)
}
const INIT_VAULT_DISC = disc('initialize_vault')
console.log('initialize_vault disc:', [...INIT_VAULT_DISC])

const MINTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'devnet-mints.json'), 'utf8'))

async function main() {
  const conn = new Connection(RPC, 'confirmed')
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, '.config/solana/deploy-keypair.json'), 'utf8'
    )))
  )
  console.log('Authority:', kp.publicKey.toBase58())

  for (const [sym, mintStr] of Object.entries(MINTS)) {
    const xstockMint = new PublicKey(mintStr)

    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, xstockMint.toBuffer()], PROGRAM_ID
    )
    const [receiptMint] = PublicKey.findProgramAddressSync(
      [RECEIPT_SEED, xstockMint.toBuffer()], PROGRAM_ID
    )
    const vaultXstockAta = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)

    // Check if already initialized
    const vaultInfo = await conn.getAccountInfo(vaultPda)
    if (vaultInfo) {
      console.log(`✓ ${sym} vault already exists, skipping`)
      continue
    }

    const data = Buffer.concat([INIT_VAULT_DISC, Buffer.from([vaultBump])])

    const tx = new Transaction()
    const { blockhash } = await conn.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = kp.publicKey

    tx.add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: kp.publicKey,                isSigner: true,  isWritable: true  }, // 0: authority
        { pubkey: xstockMint,                  isSigner: false, isWritable: false }, // 1: xstock_mint
        { pubkey: vaultPda,                    isSigner: false, isWritable: true  }, // 2: vault
        { pubkey: receiptMint,                 isSigner: false, isWritable: true  }, // 3: receipt_mint
        { pubkey: vaultXstockAta,              isSigner: false, isWritable: true  }, // 4: vault_xstock_ata
        { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // 5: token_program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 6: associated_token_program
        { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false }, // 7: system_program
        { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false }, // 8: rent
      ],
      data,
    }))

    try {
      tx.sign(kp)
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true })

      // Poll for confirmation (Alchemy devnet doesn't support signatureSubscribe)
      let confirmed = false
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const status = await conn.getSignatureStatuses([sig])
        const s = status?.value?.[0]
        if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
          if (s.err) throw new Error(`on-chain error: ${JSON.stringify(s.err)}`)
          confirmed = true
          break
        }
        if (s?.err) throw new Error(`on-chain error: ${JSON.stringify(s.err)}`)
      }
      if (!confirmed) throw new Error('Timed out waiting for confirmation')

      console.log(`✓ ${sym} vault initialized: ${sig.slice(0,16)}...`)
      console.log(`  vaultPda:    ${vaultPda.toBase58()}`)
      console.log(`  receiptMint: ${receiptMint.toBase58()}`)
    } catch (e) {
      console.error(`✗ ${sym} failed:`, e.message)
    }
  }
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
