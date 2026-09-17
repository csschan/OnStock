import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR'
const PROGRAM_ID = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx')

const PRESTOCKS_MINTS = {
  ANTHROPIC:  '2QkAjhXkhs7b42a69ib6teXaHGvHBnrxq7d1FaHRji9b',
  OPENAI:     '97YXr4199PG3HGoNuCU9TBYs493rvwxZSkVKuwHBjUUs',
  SPACEX:     '85fzv9BDsns7dfeLp8mVUFKtHS21YFB9E6XX5R7gW3zL',
  ANDURIL:    'GyMGDR7QzebB1Ju8SyhUU2R5EH7uTx5jvQurvGKe7zvo',
  NEURALINK:  '9QYrYf3ipeceNwafhu7zCoaj6AzvkNXmXgpEAkLysKE7',
  FIGUREAI:   '7vWgeemRTWVpgAwcUQDmno3VozhSE3i7c5twHyHjXBrC',
  XAI:        'AthRiZKDuChtHcutqe7Cj5h9kWgYSSdbfjNXrbjdPZt5',
  POLYMARKET: 'D5kDnJUszEAYmbi42hGY7AHy8CfuEWpCTHRGyhbCgUj9',
  KALSHI:     'C58yBtVgV3nnqZnsHrvZ61scgFhjh9uu8PtxA6QMiJ9B',
}

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/deploy-keypair.json'), 'utf8')))
)

const connection = new Connection(RPC, 'confirmed')
const wallet = new anchor.Wallet(kp)
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed', skipPreflight: true })

const idl = JSON.parse(readFileSync(join(__dirname, 'target/idl/onstock_vault.json'), 'utf8'))
const program = new anchor.Program(idl, provider)

async function poll(connection, sig) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const status = await connection.getSignatureStatuses([sig])
    const s = status?.value?.[0]
    if (s?.err) throw new Error(`on-chain error: ${JSON.stringify(s.err)}`)
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return
  }
  throw new Error('timeout')
}

async function main() {
  console.log('Authority:', kp.publicKey.toBase58())

  for (const [sym, mintStr] of Object.entries(PRESTOCKS_MINTS)) {
    const xstockMint = new PublicKey(mintStr)
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), xstockMint.toBuffer()], PROGRAM_ID
    )
    const vaultInfo = await connection.getAccountInfo(vaultPda)
    if (vaultInfo) { console.log(`✓ ${sym} vault already exists`); continue }

    try {
      const tx = await program.methods
        .initializeVault()
        .accountsPartial({ xstockMint, authority: kp.publicKey })
        .transaction()

      const { blockhash } = await connection.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer = kp.publicKey
      tx.sign(kp)

      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      await poll(connection, sig)
      console.log(`✓ ${sym}: ${sig.slice(0,20)}...`)
    } catch (e) {
      console.error(`✗ ${sym}: ${e.message}`)
    }
  }
}

main().catch(console.error)
