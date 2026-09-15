// Chainlink 价格预言机 fetcher
// 直接读链上合约，不需要 API key，免费

import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
// CHAINLINK_FEEDS removed from tokens config — define inline
const CHAINLINK_FEEDS: Record<string, string> = {}

const AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
])

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'),
})

export interface OraclePrice {
  ticker: string
  price: number
  updatedAt: Date
  source: 'chainlink'
}

export async function fetchChainlinkPrice(ticker: string): Promise<OraclePrice | null> {
  const feedAddress = CHAINLINK_FEEDS[ticker]
  if (!feedAddress) {
    console.log(`[Chainlink] No feed for ${ticker}, skipping`)
    return null
  }

  try {
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress as `0x${string}`,
        abi: AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      }),
      client.readContract({
        address: feedAddress as `0x${string}`,
        abi: AGGREGATOR_ABI,
        functionName: 'decimals',
      }),
    ])

    const [, answer, , updatedAt] = roundData
    const price = Number(answer) / 10 ** Number(decimals)

    console.log(`[Chainlink] ${ticker} = $${price.toFixed(2)}`)

    return {
      ticker,
      price,
      updatedAt: new Date(Number(updatedAt) * 1000),
      source: 'chainlink',
    }
  } catch (err) {
    console.error(`[Chainlink] Failed to fetch ${ticker}:`, err)
    return null
  }
}

export async function fetchAllOraclePrices(): Promise<Map<string, number>> {
  const tickers = Object.keys(CHAINLINK_FEEDS).filter(t => CHAINLINK_FEEDS[t] !== '')
  const results = await Promise.allSettled(tickers.map(t => fetchChainlinkPrice(t)))

  const priceMap = new Map<string, number>()
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      priceMap.set(tickers[i], result.value.price)
    }
  })

  return priceMap
}
