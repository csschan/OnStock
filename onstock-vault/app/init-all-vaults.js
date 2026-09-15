/**
 * Initialize OnStock Vaults for all devnet test mints
 * Run: node app/init-all-vaults.js
 */
const anchor = require('@coral-xyz/anchor')
const { Connection, Keypair, PublicKey } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token')
const fs = require('fs')

const VAULT_PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')

const DEVNET_MINTS = {
  TSLAx: '4FGhgbtYyS6MQ4vTAyNJeevmFxYkmcVpVffcNXo415rd',
  NVDAx: '5UXkDmDdayJRVSJGwVApyQ28TeYGn3eN1A7VUJBm5jB7',
  SPYx:  'F3bXCStN89nxLNqe8vJg23MUyQJ4zy1BcUiRE9rSesYG',
  AAPLx: '5uJURqqzS81EhGzTReLRc3yi9UgseBB4o5TXXGSxXnR7',
  METAx: '6ru5cseEQ5qiMqtjgggsNd9mgtXVoY5NxtJRy2BRy2yg',
}

async function initVault(program, connection, keypair, symbol, mintStr) {
  const mint = new PublicKey(mintStr)
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), mint.toBuffer()], VAULT_PROGRAM_ID
  )
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), mint.toBuffer()], VAULT_PROGRAM_ID
  )
  const vaultXstockAta = getAssociatedTokenAddressSync(mint, vaultPda, true)

  const existing = await connection.getAccountInfo(vaultPda)
  if (existing) {
    console.log(`✓ ${symbol} vault already exists (${vaultPda.toBase58().slice(0,8)}...)`)
    return { symbol, vaultPda: vaultPda.toBase58(), receiptMint: receiptMint.toBase58() }
  }

  console.log(`  Initializing ${symbol} vault...`)
  const tx = await program.methods
    .initializeVault(vaultBump)
    .accounts({
      authority: keypair.publicKey,
      xstockMint: mint,
      vault: vaultPda,
      receiptMint,
      vaultXstockAta,
      tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc()
  console.log(`✓ ${symbol} vault initialized: ${tx.slice(0,12)}...`)
  return { symbol, vaultPda: vaultPda.toBase58(), receiptMint: receiptMint.toBase58() }
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')))
  )
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  anchor.setProvider(provider)
  const IDL = JSON.parse(fs.readFileSync(__dirname + '/../target/idl/onstock_vault.json', 'utf8'))
  const program = new anchor.Program(IDL, provider)

  console.log('Authority:', keypair.publicKey.toBase58())
  console.log('')

  const results = []
  for (const [symbol, mintStr] of Object.entries(DEVNET_MINTS)) {
    try {
      const r = await initVault(program, connection, keypair, symbol, mintStr)
      results.push(r)
    } catch (e) {
      console.error(`✗ ${symbol} failed:`, e.message)
    }
  }

  console.log('\n=== Devnet Mint Map (paste into server routes.ts) ===')
  console.log('const DEVNET_MINTS: Record<string, string> = {')
  for (const [symbol, mint] of Object.entries(DEVNET_MINTS)) {
    console.log(`  ${symbol}: '${mint}',`)
  }
  console.log('}')
}

main().catch(console.error)
