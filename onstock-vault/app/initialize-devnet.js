/**
 * Initialize OnStock Vault on devnet with test TSLAx mint
 * Run: node app/initialize-devnet.js
 */
const anchor = require('@coral-xyz/anchor')
const { Connection, Keypair, PublicKey } = require('@solana/web3.js')
const fs = require('fs')

const VAULT_PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')
const TEST_TSLAX_MINT  = new PublicKey('4FGhgbtYyS6MQ4vTAyNJeevmFxYkmcVpVffcNXo415rd')

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed')

  const keypairPath = process.env.KEYPAIR || `${process.env.HOME}/.config/solana/id.json`
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  )

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(keypair),
    { commitment: 'confirmed' }
  )
  anchor.setProvider(provider)

  const IDL = JSON.parse(
    fs.readFileSync(__dirname + '/../target/idl/onstock_vault.json', 'utf8')
  )
  const program = new anchor.Program(IDL, provider)

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), TEST_TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  )
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), TEST_TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  )

  console.log('Authority :', keypair.publicKey.toBase58())
  console.log('xStock    :', TEST_TSLAX_MINT.toBase58())
  console.log('Vault PDA :', vaultPda.toBase58())
  console.log('Receipt   :', receiptMint.toBase58())

  // Check if already initialized
  const existing = await connection.getAccountInfo(vaultPda)
  if (existing) {
    console.log('\nVault already initialized! (data length:', existing.data.length, ')')
    return
  }

  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token')
  const vaultXstockAta = getAssociatedTokenAddressSync(TEST_TSLAX_MINT, vaultPda, true)
  console.log('Vault xStock ATA:', vaultXstockAta.toBase58())

  // Derive vault bump
  const [, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), TEST_TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  )

  console.log('\nInitializing vault...')
  const tx = await program.methods
    .initializeVault(vaultBump)
    .accounts({
      authority: keypair.publicKey,
      xstockMint: TEST_TSLAX_MINT,
      vault: vaultPda,
      receiptMint,
      vaultXstockAta,
      tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc()

  console.log('✓ Vault initialized! tx:', tx)
  console.log('\nAdd to server .env or routes.ts:')
  console.log(`DEVNET_TSLAX_MINT=4FGhgbtYyS6MQ4vTAyNJeevmFxYkmcVpVffcNXo415rd`)
  console.log(`Vault PDA: ${vaultPda.toBase58()}`)
  console.log(`Receipt Mint: ${receiptMint.toBase58()}`)
}

main().catch(console.error)
