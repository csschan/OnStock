// LP Pool 数据 — DexScreener (主) + GeckoTerminal (备)
// 返回 TVL、24h 成交量、手续费
// 替代已关停的 The Graph 免费 Subgraph

import { TOKENS } from '../config/tokens.js'

export interface PoolInfo {
  ticker: string
  issuer: string
  chain: string
  chainId: number
  tokenSymbol: string
  contractAddress: string
  poolAddress: string
  feeTier: number
  tvlUsd: number
  volume24hUsd: number
  fees24hUsd: number
  token0Symbol: string
  token1Symbol: string
}

// ─── DexScreener ───────────────────────────────────────────────

const DS_CHAIN: Record<string, string> = {
  ethereum: 'ethereum',
  bnb: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  solana: 'solana',
}

interface DSPair {
  chainId: string
  dexId: string
  pairAddress: string
  priceUsd: string
  liquidity?: { usd: number }
  volume?: { h24: number }
  baseToken: { address: string; symbol: string }
  quoteToken: { address: string; symbol: string }
  fdv?: number
}

async function fetchDexScreenerPools(contractAddress: string, chain: string): Promise<DSPair[]> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return []
  const json = await res.json() as { pairs?: DSPair[] }
  const chainId = DS_CHAIN[chain] ?? chain
  return (json.pairs ?? []).filter(p => p.chainId === chainId)
}

// ─── GeckoTerminal (fallback) ──────────────────────────────────

const GT_NETWORK: Record<string, string> = {
  ethereum: 'eth',
  bnb: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  solana: 'solana',
}

interface GTPair {
  id: string
  attributes: {
    address: string
    name: string
    reserve_in_usd: string
    volume_usd: { h24: string }
    base_token_price_in_usd: string
  }
}

async function fetchGeckoTerminalPools(contractAddress: string, chain: string): Promise<GTPair[]> {
  const network = GT_NETWORK[chain]
  if (!network) return []
  const res = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${contractAddress}/pools?page=1`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (!res.ok) return []
  const json = await res.json() as { data?: GTPair[] }
  return json.data ?? []
}

// ─── 主函数 ────────────────────────────────────────────────────

export async function fetchAllPoolInfo(): Promise<PoolInfo[]> {
  // 去重：同一 contractAddress+chain 只查一次
  const uniqueTokens = new Map<string, typeof TOKENS[0]>()
  for (const t of TOKENS) {
    const key = `${t.contractAddress.toLowerCase()}-${t.chain}`
    if (!uniqueTokens.has(key)) uniqueTokens.set(key, t)
  }

  const results: PoolInfo[] = []
  const entries = Array.from(uniqueTokens.values())
  const batchSize = 3

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize)

    await Promise.allSettled(batch.map(async (token) => {
      try {
        // 1. 先尝试 DexScreener
        const dsPairs = await fetchDexScreenerPools(token.contractAddress, token.chain)

        if (dsPairs.length > 0) {
          // 取流动性最高的池子
          const best = dsPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
          const tvl = best.liquidity?.usd ?? 0
          const vol = best.volume?.h24 ?? 0

          if (tvl > 0 || vol > 0) {
            results.push({
              ticker: token.ticker,
              issuer: token.issuer,
              chain: token.chain,
              chainId: token.chainId,
              tokenSymbol: token.tokenSymbol,
              contractAddress: token.contractAddress,
              poolAddress: best.pairAddress,
              feeTier: 0,
              tvlUsd: tvl,
              volume24hUsd: vol,
              fees24hUsd: 0,
              token0Symbol: best.baseToken.symbol,
              token1Symbol: best.quoteToken.symbol,
            })
            return
          }
        }

        // 2. DexScreener 没数据，尝试 GeckoTerminal
        const gtPairs = await fetchGeckoTerminalPools(token.contractAddress, token.chain)

        if (gtPairs.length > 0) {
          // 取 TVL 最高的
          const best = gtPairs.sort((a, b) =>
            parseFloat(b.attributes.reserve_in_usd || '0') - parseFloat(a.attributes.reserve_in_usd || '0')
          )[0]
          const tvl = parseFloat(best.attributes.reserve_in_usd || '0')
          const vol = parseFloat(best.attributes.volume_usd?.h24 || '0')

          if (tvl > 0 || vol > 0) {
            const nameTokens = best.attributes.name?.split(' / ') ?? ['?', '?']
            results.push({
              ticker: token.ticker,
              issuer: token.issuer,
              chain: token.chain,
              chainId: token.chainId,
              tokenSymbol: token.tokenSymbol,
              contractAddress: token.contractAddress,
              poolAddress: best.attributes.address,
              feeTier: 0,
              tvlUsd: tvl,
              volume24hUsd: vol,
              fees24hUsd: 0,
              token0Symbol: nameTokens[0],
              token1Symbol: nameTokens[1] ?? '?',
            })
          }
        }
      } catch (err) {
        console.warn(`[LPPools] ${token.tokenSymbol} on ${token.chain}:`, (err as Error).message)
      }
    }))

    // DexScreener 限流 60/min，GeckoTerminal 10/min，每批等 1.5s
    if (i + batchSize < entries.length) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  console.log(`[LPPools] Found ${results.length} pools via DexScreener + GeckoTerminal`)
  return results
}
