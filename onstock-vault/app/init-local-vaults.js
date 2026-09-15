const anchor = require('@coral-xyz/anchor')
const { Connection, Keypair, PublicKey } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token')
const fs = require('fs')

const VAULT_PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')

const LOCAL_MINTS = {
  TSLAx: 'DQ1aTLDzDyXMacis6DXTY7WKWSkswYp1Cq3DtiYuQUa8',
  NVDAx: '8rxpXGJCncYBE379upmExG9iWrWi8KoWwtPUV1XfySvr',
  SPYx:  '9h6Dh56aJEebcZRTyEMyK4yJTKjXXPny8NTtXAXJbqhZ',
  AAPLx: 'DRm1TK1QVKnuc8qpipcVjyELbLpByfPKUermAvpysCeg',
  METAx: 'EuVUdUSieKkjQ5qVttFT6DtUXbBi1TWAqCa2HUDZ4vcG',
}

async function main() {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed')
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')))
  )
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  anchor.setProvider(provider)
  const IDL = JSON.parse(fs.readFileSync(__dirname + '/../target/idl/onstock_vault.json', 'utf8'))
  const program = new anchor.Program(IDL, provider)

  for (const [symbol, mintStr] of Object.entries(LOCAL_MINTS)) {
    const mint = new PublicKey(mintStr)
    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), mint.toBuffer()], VAULT_PROGRAM_ID
    )
    const [receiptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from('receipt'), mint.toBuffer()], VAULT_PROGRAM_ID
    )
    const vaultXstockAta = getAssociatedTokenAddressSync(mint, vaultPda, true)

    const existing = await connection.getAccountInfo(vaultPda)
    if (existing) { console.log(`✓ ${symbol} already exists`); continue }

    try {
      const tx = await program.methods.initializeVault(vaultBump).accounts({
        authority: keypair.publicKey, xstockMint: mint, vault: vaultPda,
        receiptMint, vaultXstockAta,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
        systemProgram: anchor.web3.SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      }).rpc()
      console.log(`✓ ${symbol} initialized: ${tx.slice(0,12)}...`)
    } catch(e) { console.error(`✗ ${symbol}: ${e.message}`) }
  }
}

main().catch(console.error)
