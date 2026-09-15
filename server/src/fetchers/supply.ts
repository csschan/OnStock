// ERC-20 totalSupply 批量查询（viem multicall）
// 每条链一次 multicall，避免 N 个串行 RPC 请求
// Solana: 使用 getTokenSupply RPC

import { parseAbi } from 'viem'
import { clientByChainId } from '../config/rpcClients.js'
import { TOKENS } from '../config/tokens.js'

const ERC20_ABI = parseAbi(['function totalSupply() view returns (uint256)'])
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

export interface SupplyResult {
  ticker: string
  issuer: string
  chain: string
  chainId: number
  contractAddress: string
  decimals: number
  totalSupply: number   // 已换算成 token 单位（非 wei）
}

async function fetchSolanaSupplies(): Promise<SupplyResult[]> {
  const solanaTokens = TOKENS.filter(t => t.chain === 'solana' && t.contractAddress)
  const results: SupplyResult[] = []

  await Promise.all(solanaTokens.map(async (t) => {
    try {
      const res = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTokenSupply',
          params: [t.contractAddress],
        }),
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json() as { result?: { value?: { uiAmount: number } } }
      const amount = json.result?.value?.uiAmount
      if (amount != null && amount > 0) {
        results.push({
          ticker: t.ticker,
          issuer: t.issuer,
          chain: 'solana',
          chainId: 0,
          contractAddress: t.contractAddress,
          decimals: t.decimals,
          totalSupply: amount,
        })
        console.log(`[Supply/Solana] ${t.tokenSymbol} = ${amount.toLocaleString()}`)
      }
    } catch (err: any) {
      console.warn(`[Supply/Solana] ${t.tokenSymbol}: ${err.message}`)
    }
  }))

  return results
}

export async function fetchAllSupplies(): Promise<SupplyResult[]> {
  // 只处理 EVM 链（Solana = chainId 0，Robinhood Chain = 4663 无 client）
  const evmTokens = TOKENS.filter(t => t.chainId !== 0 && clientByChainId[t.chainId])

  // 按 chainId 分组
  const byChain = new Map<number, typeof evmTokens>()
  for (const t of evmTokens) {
    if (!byChain.has(t.chainId)) byChain.set(t.chainId, [])
    byChain.get(t.chainId)!.push(t)
  }

  const results: SupplyResult[] = []

  await Promise.all(
    Array.from(byChain.entries()).map(async ([chainId, tokens]) => {
      const client = clientByChainId[chainId]
      try {
        const calls = tokens.map(t => ({
          address: t.contractAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'totalSupply' as const,
        }))

        const raw = await client.multicall({ contracts: calls, allowFailure: true })

        raw.forEach((result: { status: string; result?: bigint }, i: number) => {
          if (result.status === 'success' && result.result != null) {
            const t = tokens[i]
            const totalSupply = Number(result.result) / Math.pow(10, t.decimals)
            results.push({
              ticker: t.ticker,
              issuer: t.issuer,
              chain: t.chain,
              chainId: t.chainId,
              contractAddress: t.contractAddress,
              decimals: t.decimals,
              totalSupply,
            })
          }
        })
      } catch (err) {
        console.warn(`[Supply] Chain ${chainId} multicall failed:`, err)
      }
    })
  )

  // Solana SPL tokens
  const solanaResults = await fetchSolanaSupplies()
  results.push(...solanaResults)

  console.log(`[Supply] Fetched ${results.length} supply values across ${byChain.size + 1} chains (incl. Solana)`)
  return results
}
