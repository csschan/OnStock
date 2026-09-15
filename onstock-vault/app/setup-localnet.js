/**
 * One-shot localnet setup: create all test mints + initialize all vaults
 * Run: node app/setup-localnet.js
 */
const anchor = require('@coral-xyz/anchor')
const { Connection, Keypair, PublicKey } = require('@solana/web3.js')
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token')
const fs = require('fs')

const RPC = 'http://127.0.0.1:8899'
const VAULT_PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')
const ASSETS = ['TSLAx', 'NVDAx', 'SPYx', 'AAPLx', 'GOOGLx', 'METAx', 'COINx', 'MSTRx']

async function main() {
  const conn = new Connection(RPC, 'confirmed')
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/deploy-keypair.json`, 'utf8'))))
  const vaultAuth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8'))))

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(vaultAuth), { commitment: 'confirmed' })
  anchor.setProvider(provider)
  const IDL = JSON.parse(fs.readFileSync(__dirname + '/../target/idl/onstock_vault.json', 'utf8'))
  const program = new anchor.Program(IDL, provider)

  const results = {}

  for (const symbol of ASSETS) {
    console.log(`\n=== ${symbol} ===`)

    // 1. Create mint
    const mint = await createMint(conn, authority, authority.publicKey, null, 6)
    console.log(`  Mint: ${mint.toBase58()}`)

    // 2. Create ATA + mint 1000 tokens
    const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey)
    await mintTo(conn, authority, mint, ata.address, authority, 1000 * 1e6)
    console.log(`  Minted 1000 ${symbol}`)

    // 3. Initialize vault
    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), mint.toBuffer()], VAULT_PROGRAM_ID
    )
    const [receiptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from('receipt'), mint.toBuffer()], VAULT_PROGRAM_ID
    )
    const vaultXstockAta = getAssociatedTokenAddressSync(mint, vaultPda, true)

    try {
      await program.methods.initializeVault(vaultBump).accounts({
        authority: vaultAuth.publicKey, xstockMint: mint, vault: vaultPda,
        receiptMint, vaultXstockAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      }).rpc()
      console.log(`  Vault initialized`)
    } catch (e) {
      console.error(`  Vault failed: ${e.message.slice(0, 80)}`)
    }

    results[symbol] = mint.toBase58()
  }

  // Output mint map
  console.log('\n\n=== Copy to server routes.ts ===')
  for (const [sym, addr] of Object.entries(results)) {
    console.log(`      ${sym}: '${addr}',`)
  }

  // Save to file for easy reference
  fs.writeFileSync('/tmp/localnet_mints.json', JSON.stringify(results, null, 2))
  console.log('\nSaved to /tmp/localnet_mints.json')
}

main().catch(console.error)
