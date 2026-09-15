#!/usr/bin/env node
/**
 * init-vaults.js  — 用 Anchor 客户端初始化所有 xStock Vault
 * cd onstock-vault && node init-vaults.js
 */
const anchor = require('@coral-xyz/anchor')
const { PublicKey, Keypair, Connection } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync } = require('@solana/spl-token')
const fs = require('fs'), path = require('path')

const RPC = 'http://127.0.0.1:8899'
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, 'target/idl/onstock_vault.json'), 'utf8'))
const PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')
const MINTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/localnet-mints.json'), 'utf8'))

async function main() {
  const connection = new Connection(RPC, 'confirmed')
  const kpData = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.config/solana/deploy-keypair.json'), 'utf8'))
  const authority = Keypair.fromSecretKey(Uint8Array.from(kpData))

  const wallet = new anchor.Wallet(authority)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const program = new anchor.Program(IDL, provider)

  console.log('Authority:', authority.publicKey.toBase58())
  console.log('Program:', PROGRAM_ID.toBase58())

  for (const [sym, mintStr] of Object.entries(MINTS)) {
    const xstockMint = new PublicKey(mintStr)

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), xstockMint.toBuffer()], PROGRAM_ID
    )

    // Skip if already initialized
    const existing = await connection.getAccountInfo(vaultPda)
    if (existing) {
      console.log(`✓ ${sym} vault already exists`)
      continue
    }

    try {
      const [receiptMint] = PublicKey.findProgramAddressSync(
        [Buffer.from('receipt'), xstockMint.toBuffer()], PROGRAM_ID
      )
      const vaultXstockAta = getAssociatedTokenAddressSync(xstockMint, vaultPda, true)

      const tx = await program.methods
        .initializeVault()
        .accountsPartial({
          authority: authority.publicKey,
          xstockMint,
          vault: vaultPda,
          receiptMint,
          vaultXstockAta,
        })
        .rpc()
      console.log(`✓ ${sym} initialized: ${tx.slice(0, 16)}...`)
    } catch (e) {
      console.error(`✗ ${sym}:`, e.message?.slice(0, 200))
    }
  }
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
