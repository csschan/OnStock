/**
 * Bridge Watcher — Auto Cross-Chain Relay
 *
 * Listens for BridgeBurn events on all chains.
 * When detected → auto-mints osToken on destination chain.
 * Then async rebalances USDC between pools.
 *
 * THORChain equivalent: TSS node watching inbound txs → scheduling outbound.
 */

import { ethers } from 'ethers'

const GATEWAY_ABI = [
  'event BridgeBurn(address indexed user, bytes32 indexed ticker, uint256 amount, string destChain, string destAddress, uint256 nonce)',
  'function bridgeMint(string ticker, address to, uint256 amount, string srcChain, uint256 srcNonce)',
  'function setPrice(string ticker, uint256 priceUsd, bool marketOpen)',
]

const POOL_ABI = [
  'function rebalanceOut(uint256 amount, string destChain)',
  'function poolInfo() view returns (uint256, uint256, uint256, uint256, uint256, uint256)',
]

// Ticker hash → ticker string reverse map
const TICKER_HASHES: Record<string, string> = {}
for (const t of ['TSLA', 'NVDA', 'AAPL', 'SPY', 'GOOGL', 'META', 'COIN', 'MSTR']) {
  TICKER_HASHES[ethers.keccak256(ethers.toUtf8Bytes(t))] = t
}

interface BridgeConfig {
  arbGateway: string
  arbPool: string
  arbRpc: string
  solGatewayProgram: string
  solOsTokens: Record<string, string>    // ticker → SPL mint address
  deployerKey: string
  solKeeperPath: string
}

let watching = false

export async function startBridgeWatcher(config: BridgeConfig) {
  if (watching) return
  watching = true

  const arbProvider = new ethers.JsonRpcProvider(config.arbRpc)
  const keeper = new ethers.Wallet(config.deployerKey, arbProvider)
  const gateway = new ethers.Contract(config.arbGateway, GATEWAY_ABI, keeper)

  console.log(`[BridgeWatcher] Listening for BridgeBurn on Arbitrum Gateway: ${config.arbGateway}`)

  // Poll for events every 15 seconds (more reliable than websocket on testnet)
  let lastBlock = await arbProvider.getBlockNumber()

  setInterval(async () => {
    try {
      const currentBlock = await arbProvider.getBlockNumber()
      if (currentBlock <= lastBlock) return

      const filter = gateway.filters.BridgeBurn()
      const events = await gateway.queryFilter(filter, lastBlock + 1, currentBlock)

      for (const event of events) {
        const log = event as ethers.EventLog
        const [user, tickerHash, amount, destChain, destAddress, nonce] = log.args

        const ticker = TICKER_HASHES[tickerHash] ?? 'UNKNOWN'
        const amountStr = ethers.formatUnits(amount, 6)

        console.log(`[BridgeWatcher] BridgeBurn detected:`)
        console.log(`  User: ${user}`)
        console.log(`  Asset: ${ticker} (${amountStr})`)
        console.log(`  Dest: ${destChain} → ${destAddress}`)
        console.log(`  Nonce: ${nonce}`)

        // Auto-process based on destination chain
        if (destChain === 'solana') {
          await mintOnSolana(config, ticker, destAddress, amount, nonce)
        } else if (destChain === 'arbitrum' || destChain === 'robinhood') {
          // EVM dest chain — mint on Arbitrum Gateway (same contract for testnet)
          await mintOnArbitrum(config, ticker, destAddress, amount, nonce, destChain)
        } else {
          console.log(`[BridgeWatcher] Unknown dest chain: ${destChain}`)
        }
      }

      lastBlock = currentBlock
    } catch (err: any) {
      console.warn(`[BridgeWatcher] Poll error: ${err.message?.slice(0, 80)}`)
    }
  }, 15_000)

  console.log(`[BridgeWatcher] Started polling every 15s from block ${lastBlock}`)
}

async function mintOnArbitrum(
  config: BridgeConfig,
  ticker: string,
  destAddress: string,
  amount: bigint,
  nonce: bigint,
  destChain: string,
) {
  try {
    const arbProvider = new ethers.JsonRpcProvider(config.arbRpc)
    const keeper = new ethers.Wallet(config.deployerKey, arbProvider)
    const gw = new ethers.Contract(config.arbGateway, GATEWAY_ABI, keeper)

    const tx = await gw.bridgeMint(ticker, destAddress, amount, destChain, nonce)
    const receipt = await tx.wait()

    console.log(`[BridgeWatcher] ✅ Arbitrum mint complete:`)
    console.log(`  ${ethers.formatUnits(amount, 6)} os${ticker} → ${destAddress}`)
    console.log(`  Tx: ${receipt.hash}`)
  } catch (err: any) {
    console.error(`[BridgeWatcher] ❌ Arbitrum mint failed: ${err.message?.slice(0, 100)}`)
  }
}

async function mintOnSolana(
  config: BridgeConfig,
  ticker: string,
  destAddress: string,
  amount: bigint,
  nonce: bigint,
) {
  try {
    const { Connection, Keypair, PublicKey } = await import('@solana/web3.js')
    const spl = await import('@solana/spl-token')
    const fs = await import('fs')

    const conn = new Connection(process.env.SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed')
    const rawKey = JSON.parse(fs.readFileSync(config.solKeeperPath, 'utf8'))
    const solKeeper = Keypair.fromSecretKey(Uint8Array.from(rawKey))

    const osMintStr = config.solOsTokens[ticker]
    if (!osMintStr) {
      console.error(`[BridgeWatcher] No Solana osMint for ${ticker}`)
      return
    }

    const osMint = new PublicKey(osMintStr)
    const destPubkey = new PublicKey(destAddress)
    const mintAmount = BigInt(amount.toString()) // already in 6 decimals

    // Get or create dest ATA
    const destAta = await spl.getOrCreateAssociatedTokenAccount(conn, solKeeper, osMint, destPubkey)

    // Mint osToken on Solana
    const sig = await spl.mintTo(conn, solKeeper, osMint, destAta.address, solKeeper.publicKey, mintAmount)

    console.log(`[BridgeWatcher] ✅ Solana mint complete:`)
    console.log(`  ${ethers.formatUnits(amount, 6)} os${ticker} → ${destAddress}`)
    console.log(`  Sig: ${sig}`)
    console.log(`  Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`)
  } catch (err: any) {
    console.error(`[BridgeWatcher] ❌ Solana mint failed: ${err.message?.slice(0, 100)}`)
  }
}

// Keeper rebalance: move USDC from Arb Pool to Sol Pool
// Called periodically to keep pools balanced
export async function rebalancePools(config: BridgeConfig) {
  try {
    const arbProvider = new ethers.JsonRpcProvider(config.arbRpc)
    const keeper = new ethers.Wallet(config.deployerKey, arbProvider)
    const pool = new ethers.Contract(config.arbPool, POOL_ABI, keeper)

    const info = await pool.poolInfo()
    const pendingOut = Number(ethers.formatUnits(info[3], 6))

    if (pendingOut > 0) {
      console.log(`[Rebalancer] Pending outbound: $${pendingOut} — bridging to Solana pool...`)
      // In production: use CCTP/Wormhole to bridge USDC
      // For testnet: just log
      console.log(`[Rebalancer] (testnet) Would bridge $${pendingOut} via CCTP to Solana`)
    }
  } catch (err: any) {
    console.warn(`[Rebalancer] Error: ${err.message?.slice(0, 80)}`)
  }
}
