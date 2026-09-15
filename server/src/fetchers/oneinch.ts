// 1inch API fetcher
// 用于获取 ETH / BNB 链上 DEX 实时报价
// 文档: https://portal.1inch.dev/documentation/swap/swagger

import axios from 'axios'
import { TOKENS, type TokenConfig } from '../config/tokens.js'

const BASE_URL = 'https://api.1inch.dev/swap/v6.0'
const PRICE_URL = 'https://api.1inch.dev/price/v1.1'

// 1 个 token 的 USDC 报价（用于获取价格）
const QUOTE_AMOUNT_USDC = '1000000000' // 1000 USDC (6 decimals)

export interface DexQuote {
  ticker: string
  issuer: string
  chain: string
  tokenSymbol: string
  contractAddress: string
  dexPrice: number       // 每个 token 多少 USDC
  liquidityUsd?: number | null
  source: string
  rawResponse?: unknown
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
    accept: 'application/json',
  }
}

// 获取单个 token 的 DEX 报价（sell 1 token, get USDC）
async function fetchTokenPrice(token: TokenConfig): Promise<DexQuote | null> {
  if (!token.contractAddress) {
    console.log(`[1inch] ${token.tokenSymbol} on ${token.chain}: no address, skipping`)
    return null
  }

  const chainId = token.chainId
  const url = `${BASE_URL}/${chainId}/quote`

  try {
    // 方向：卖出 1 个 token，获得 USDC/USDT
    const tokenAmount = BigInt(10 ** token.decimals).toString() // 1 token

    const response = await axios.get(url, {
      headers: getHeaders(),
      params: {
        src: token.contractAddress,
        dst: token.chain === 'bnb' ? '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' : '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: tokenAmount,
        includeProtocols: true,
        includeGas: true,
      },
      timeout: 10000,
    })

    const data = response.data
    const stableAmount = Number(data.dstAmount)
    // stablePair 是 USDC (6 decimals) 或 USDT (18 decimals on BNB)
    const stableDecimals = token.chain === 'bnb' ? 18 : 6
    const price = stableAmount / 10 ** stableDecimals

    console.log(`[1inch] ${token.tokenSymbol} on ${token.chain} = $${price.toFixed(2)}`)

    return {
      ticker: token.ticker,
      issuer: token.issuer,
      chain: token.chain,
      tokenSymbol: token.tokenSymbol,
      contractAddress: token.contractAddress,
      dexPrice: price,
      source: '1inch',
      rawResponse: data,
    }
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error(`[1inch] ${token.tokenSymbol} on ${token.chain}: ${err.response?.status} ${err.response?.data?.description || err.message}`)
    } else {
      console.error(`[1inch] ${token.tokenSymbol} on ${token.chain}:`, err)
    }
    return null
  }
}

// 抓取所有 EVM 链上的 token 报价
export async function fetchAllEvmQuotes(): Promise<DexQuote[]> {
  const evmTokens = TOKENS.filter(t => t.chain !== 'solana' && t.contractAddress)

  // 分批并发，避免 API rate limit
  const results: DexQuote[] = []
  const batchSize = 3

  for (let i = 0; i < evmTokens.length; i += batchSize) {
    const batch = evmTokens.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map(t => fetchTokenPrice(t)))

    batchResults.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      }
    })

    // 避免 rate limit
    if (i + batchSize < evmTokens.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
}

// 检测路由质量：用户用 fromToken 买 toToken，是否有更好路径
export async function checkRouteQuality(
  chainId: number,
  fromToken: string,    // 用户支付的 token 地址
  toToken: string,      // 想买的 token 地址
  fromAmount: string,   // 支付数量（原始单位）
  intermediary?: string // 中间代币地址（如 USDC）
): Promise<{
  directPrice: number | null
  bestPrice: number | null
  bestRoute: string
  warningLevel: 'safe' | 'caution' | 'danger'
  warningMessage: string | null
}> {
  const url = `${BASE_URL}/${chainId}/quote`
  const headers = getHeaders()

  try {
    // 直接路由
    const directRes = await axios.get(url, {
      headers,
      params: { src: fromToken, dst: toToken, amount: fromAmount },
      timeout: 10000,
    })
    const directOut = Number(directRes.data.dstAmount)

    let bestOut = directOut
    let bestRoute = 'direct'

    // 如果有中间代币，试试两跳路由
    if (intermediary) {
      try {
        const hop1 = await axios.get(url, {
          headers,
          params: { src: fromToken, dst: intermediary, amount: fromAmount },
          timeout: 10000,
        })
        const hop1Amount = hop1.data.dstAmount

        const hop2 = await axios.get(url, {
          headers,
          params: { src: intermediary, dst: toToken, amount: hop1Amount },
          timeout: 10000,
        })
        const hop2Out = Number(hop2.data.dstAmount)

        if (hop2Out > bestOut * 1.001) { // 至少好 0.1% 才推荐
          bestOut = hop2Out
          bestRoute = 'two-hop via stablecoin'
        }
      } catch {
        // 两跳路由失败，忽略
      }
    }

    const improvement = (bestOut - directOut) / directOut * 100
    const directPrice = directOut / bestOut // 相对比值

    let warningLevel: 'safe' | 'caution' | 'danger' = 'safe'
    let warningMessage: string | null = null

    if (improvement > 5) {
      warningLevel = 'danger'
      warningMessage = `直接交易损失 ${improvement.toFixed(1)}%，建议先换成稳定币再购买`
    } else if (improvement > 1) {
      warningLevel = 'caution'
      warningMessage = `通过稳定币中转可节省 ${improvement.toFixed(1)}%`
    }

    return {
      directPrice,
      bestPrice: bestOut / directOut,
      bestRoute,
      warningLevel,
      warningMessage,
    }
  } catch {
    return {
      directPrice: null,
      bestPrice: null,
      bestRoute: 'unknown',
      warningLevel: 'danger',
      warningMessage: '无法获取报价，流动性可能极低',
    }
  }
}
