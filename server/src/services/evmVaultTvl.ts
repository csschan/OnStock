/**
 * EVM Vault TVL + APY Service
 * Reads totalAssets() and getVaultInfo() from ERC4626 vaults on X Layer and Arbitrum.
 * No external dependencies — raw JSON-RPC via fetch().
 */

import { latestPrices } from '../fetchers/stockprice.js'
import { XLAYER_CONFIG } from '../config/xlayer.js'
import { ARBITRUM_CONFIG } from '../config/arbitrum.js'

// Function selectors
const TOTAL_ASSETS_SELECTOR  = '0x01e1d114' // totalAssets()
const GET_VAULT_INFO_SELECTOR = '0x9f9bc521' // getVaultInfo() → (totalAssets, totalShares, apyBps, totalYield, lastYieldTime)

// xStock symbol → underlying stock ticker
const SYMBOL_TO_TICKER: Record<string, string> = {
  TSLAx: 'TSLA', NVDAx: 'NVDA', SPYx: 'SPY', AAPLx: 'AAPL',
  GOOGLx: 'GOOGL', METAx: 'META', COINx: 'COIN', MSTRx: 'MSTR',
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to, data }, 'latest'],
      }),
      signal: AbortSignal.timeout(8000),
    })
    const json = await res.json() as { result?: string; error?: unknown }
    if (json.error || !json.result || json.result === '0x') return null
    return json.result
  } catch {
    return null
  }
}

export interface VaultData {
  tvlUsd: number
  apyPct: number   // from contract, or fallback to config
}

async function fetchChainVaults(
  chainName: string,
  rpcUrl: string,
  vaults: Record<string, string>,
  fallbackApyBps: Record<string, number>,
): Promise<Map<string, VaultData>> {
  const result = new Map<string, VaultData>()
  const entries = Object.entries(vaults)
  if (entries.length === 0) return result

  const [tvlResults, infoResults] = await Promise.all([
    Promise.allSettled(entries.map(([, addr]) => ethCall(rpcUrl, addr, TOTAL_ASSETS_SELECTOR))),
    Promise.allSettled(entries.map(([, addr]) => ethCall(rpcUrl, addr, GET_VAULT_INFO_SELECTOR))),
  ])

  for (let i = 0; i < entries.length; i++) {
    const [symbol] = entries[i]
    const ticker   = SYMBOL_TO_TICKER[symbol] ?? symbol.replace('x', '')
    const priceUsd = latestPrices.get(ticker) ?? 0

    // TVL from totalAssets()
    let tvlUsd = 0
    const tvlRes = tvlResults[i]
    if (tvlRes.status === 'fulfilled' && tvlRes.value) {
      const tokenAmt = Number(BigInt(tvlRes.value)) / 1e18
      tvlUsd = tokenAmt * priceUsd
    }

    // APY from getVaultInfo() — 3rd uint256 = apyBps (96-byte offset in ABI-encoded tuple)
    let apyPct = (fallbackApyBps[symbol] ?? 0) / 100
    const infoRes = infoResults[i]
    if (infoRes.status === 'fulfilled' && infoRes.value && infoRes.value.length >= 194) {
      // ABI-encoded tuple: each uint256 = 32 bytes = 64 hex chars, skip '0x' prefix
      // index 0 → totalAssets  (offset 2)
      // index 1 → totalShares  (offset 66)
      // index 2 → apyBps       (offset 130)
      const hex = infoRes.value.slice(2)
      const apyBpsOnChain = parseInt(hex.slice(128, 192), 16)
      if (apyBpsOnChain > 0 && apyBpsOnChain < 10000) {
        apyPct = apyBpsOnChain / 100
        console.log(`[EvmVault] ${chainName} ${symbol} APY: ${apyPct.toFixed(2)}% (on-chain)`)
      }
    }

    if (tvlUsd > 0) {
      console.log(`[EvmVault] ${chainName} ${symbol} TVL: $${tvlUsd.toFixed(0)}`)
    }

    result.set(symbol, { tvlUsd, apyPct })
  }

  return result
}

// In-memory cache — refreshed every 2 minutes
let xlayerCache: Map<string, VaultData> = new Map()
let arbitrumCache: Map<string, VaultData> = new Map()
let lastFetch = 0
const CACHE_TTL = 120_000

export async function getEvmVaultData(): Promise<{
  xlayer: Map<string, VaultData>
  arbitrum: Map<string, VaultData>
}> {
  const now = Date.now()
  if (now - lastFetch < CACHE_TTL && xlayerCache.size > 0) {
    return { xlayer: xlayerCache, arbitrum: arbitrumCache }
  }

  const [xl, arb] = await Promise.allSettled([
    fetchChainVaults('XLayer',   XLAYER_CONFIG.rpc,   XLAYER_CONFIG.vaults,   XLAYER_CONFIG.apyBps),
    fetchChainVaults('Arbitrum', ARBITRUM_CONFIG.rpc, ARBITRUM_CONFIG.vaults, ARBITRUM_CONFIG.apyBps),
  ])

  if (xl.status  === 'fulfilled') xlayerCache   = xl.value
  if (arb.status === 'fulfilled') arbitrumCache = arb.value
  lastFetch = now

  return { xlayer: xlayerCache, arbitrum: arbitrumCache }
}

// Keep backward-compatible TVL-only export for callers that only need TVL
export async function getEvmVaultTvl(): Promise<{
  xlayer: Map<string, number>
  arbitrum: Map<string, number>
}> {
  const { xlayer, arbitrum } = await getEvmVaultData()
  return {
    xlayer:   new Map([...xlayer.entries()].map(([k, v]) => [k, v.tvlUsd])),
    arbitrum: new Map([...arbitrum.entries()].map(([k, v]) => [k, v.tvlUsd])),
  }
}
