'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSendTransaction, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits, erc20Abi, type Hex } from 'viem'

/* ────────────────────────────────────────────
 *  多聚合器智能路由：Odos → KyberSwap API
 *  优先级：Odos（零手续费）→ KyberSwap（免费 API）
 *  所有第三方 API 调用走 /api/dex-proxy 代理，避免 CORS
 * ──────────────────────────────────────────── */

const KYBER_CHAIN_SLUG: Record<number, string> = {
  1: 'ethereum', 56: 'bsc', 8453: 'base', 42161: 'arbitrum',
}

// 代理 GET 请求
function proxyGet(url: string, opts?: { signal?: AbortSignal }) {
  return fetch(`/api/dex-proxy?url=${encodeURIComponent(url)}`, {
    signal: opts?.signal,
  })
}

// 代理 POST 请求
function proxyPost(url: string, body: any, opts?: { signal?: AbortSignal }) {
  return fetch(`/api/dex-proxy?url=${encodeURIComponent(url)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
}

const CHAIN_LABEL: Record<number, { name: string; color: string }> = {
  1:     { name: 'Ethereum', color: '#627EEA' },
  56:    { name: 'BNB Chain', color: '#F0B90B' },
  8453:  { name: 'Base', color: '#0052FF' },
  42161: { name: 'Arbitrum', color: '#28A0F0' },
}

interface DirectSwapWidgetProps {
  tokenIn: string
  tokenOut: string
  tokenInSymbol: string
  tokenOutSymbol: string
  tokenInDecimals: number
  tokenOutDecimals: number
  chainId: number
  action: 'buy' | 'sell'
}

// 统一报价格式
interface SwapQuote {
  provider: 'odos' | 'kyber' | 'uniswap'
  amountOut: string        // raw bigint string
  priceImpact?: number
  // Odos 专用
  pathId?: string
  // KyberSwap 专用
  routeSummary?: any
  routerAddress?: string
  // Uniswap Smart Router 专用
  uniTx?: { to: string; data: string; value: string }
}

// ─── Odos ───
async function fetchOdosQuote(
  chainId: number, tokenIn: string, tokenOut: string,
  amountRaw: string, userAddr: string,
): Promise<SwapQuote | null> {
  try {
    const res = await proxyPost('https://api.odos.xyz/sor/quote/v2', {
        chainId,
        inputTokens: [{ tokenAddress: tokenIn, amount: amountRaw }],
        outputTokens: [{ tokenAddress: tokenOut, proportion: 1 }],
        slippageLimitPercent: 0.5,
        userAddr: userAddr,
        referralCode: 0,
        disableRFQs: true,
        compact: true,
      }, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.outAmounts?.[0] || !json.pathId) return null
    return {
      provider: 'odos',
      amountOut: json.outAmounts[0],
      priceImpact: json.priceImpact,
      pathId: json.pathId,
    }
  } catch {
    return null
  }
}

// ─── KyberSwap API ───
async function fetchKyberQuote(
  chainId: number, tokenIn: string, tokenOut: string,
  amountRaw: string, _userAddr: string,
): Promise<SwapQuote | null> {
  const slug = KYBER_CHAIN_SLUG[chainId]
  if (!slug) return null
  try {
    const kyberUrl = `https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountRaw}`
    const res = await proxyGet(kyberUrl, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    const summary = json?.data?.routeSummary
    if (!summary?.amountOut || summary.amountOut === '0') return null
    // 验证输出不是垃圾路由：至少 1e12 wei（0.000001 token）
    if (BigInt(summary.amountOut) < 1000000000000n) return null
    return {
      provider: 'kyber',
      amountOut: summary.amountOut,
      routeSummary: summary,
      routerAddress: summary.routerAddress || json?.data?.routerAddress,
    }
  } catch {
    return null
  }
}

// ─── Uniswap Smart Order Router（服务端 API，支持 V2/V3/V4）───
async function fetchUniswapQuote(
  chainId: number, tokenIn: string, tokenOut: string,
  amountRaw: string, userAddr: string,
  decimalsIn: number, decimalsOut: number,
): Promise<SwapQuote | null> {
  try {
    const params = new URLSearchParams({
      chainId: String(chainId),
      tokenIn, tokenOut,
      amount: amountRaw,
      decimalsIn: String(decimalsIn),
      decimalsOut: String(decimalsOut),
      recipient: userAddr,
    })
    const res = await fetch(`/api/swap-quote?${params}`, {
      signal: AbortSignal.timeout(30000), // Smart Router needs time
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.amountOutRaw || json.amountOutRaw === '0') return null
    // 验证非垃圾路由
    if (BigInt(json.amountOutRaw) < 1000000000000n) return null
    return {
      provider: 'uniswap',
      amountOut: json.amountOutRaw,
      uniTx: json.tx,
    }
  } catch {
    return null
  }
}

async function assembleOdosTx(userAddr: string, pathId: string) {
  const res = await proxyPost('https://api.odos.xyz/sor/assemble', {
    userAddr, pathId, simulate: false,
  }, { signal: AbortSignal.timeout(10000) })
  const json = await res.json()
  if (!json.transaction) throw new Error(json.detail || 'Odos assemble failed')
  return json.transaction as { to: string; data: string; value: string; gas: number }
}

async function assembleKyberTx(
  chainId: number, routeSummary: any, userAddr: string, slippage: number,
) {
  const slug = KYBER_CHAIN_SLUG[chainId]
  const kyberBuildUrl = `https://aggregator-api.kyberswap.com/${slug}/api/v1/route/build`
  const res = await proxyPost(kyberBuildUrl, {
    routeSummary,
    sender: userAddr,
    recipient: userAddr,
    slippageTolerance: slippage,
  }, { signal: AbortSignal.timeout(10000) })
  const json = await res.json()
  if (!json?.data?.data) throw new Error(json?.message || 'KyberSwap build failed')
  return {
    to: json.data.routerAddress,
    data: json.data.data,
    value: json.data.value || '0',
    gas: json.data.gas ? Number(json.data.gas) : 500000,
  }
}

// ─── 并行获取最优报价 ───
async function fetchBestQuote(
  chainId: number, tokenIn: string, tokenOut: string,
  amountRaw: string, userAddr: string,
  decimalsIn: number = 6, decimalsOut: number = 18,
): Promise<SwapQuote | null> {
  const [odos, kyber, uniswap] = await Promise.all([
    fetchOdosQuote(chainId, tokenIn, tokenOut, amountRaw, userAddr),
    fetchKyberQuote(chainId, tokenIn, tokenOut, amountRaw, userAddr),
    fetchUniswapQuote(chainId, tokenIn, tokenOut, amountRaw, userAddr, decimalsIn, decimalsOut),
  ])

  // 过滤掉输出量为 0 的垃圾路由
  const valid = [odos, kyber, uniswap].filter((q): q is SwapQuote =>
    q != null && BigInt(q.amountOut) > 1000000000000n
  )
  if (valid.length === 0) return null
  // 选输出量最大的
  return valid.reduce((a, b) => BigInt(a.amountOut) >= BigInt(b.amountOut) ? a : b)
}

export default function DirectSwapWidget({
  tokenIn, tokenOut, tokenInSymbol, tokenOutSymbol,
  tokenInDecimals, tokenOutDecimals, chainId, action,
}: DirectSwapWidgetProps) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [step, setStep] = useState<'input' | 'approve' | 'swap' | 'done'>('input')
  const [txHash, setTxHash] = useState<Hex | undefined>()

  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const { isLoading: txPending, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const chainInfo = CHAIN_LABEL[chainId]
  // Skip precheck — let user input amount and see real quote result
  // Precheck was too aggressive, blocking valid routes due to CORS/timeout
  const precheck = 'ok' as const

  const fetchQuote = useCallback(async (inputAmount: string) => {
    if (!inputAmount || !address || Number(inputAmount) <= 0) {
      setQuote(null)
      return
    }
    setQuoteLoading(true)
    setQuoteError('')
    try {
      const amountRaw = parseUnits(inputAmount, tokenInDecimals).toString()
      const best = await fetchBestQuote(chainId, tokenIn, tokenOut, amountRaw, address, tokenInDecimals, tokenOutDecimals)
      if (best) {
        setQuote(best)
      } else {
        setQuoteError('No swap route available. Try a smaller amount or different chain.')
        setQuote(null)
      }
    } catch {
      setQuoteError('Failed to fetch quote')
      setQuote(null)
    } finally {
      setQuoteLoading(false)
    }
  }, [address, chainId, tokenIn, tokenOut, tokenInDecimals])

  // debounce 500ms
  useEffect(() => {
    if (!amount) return
    const timer = setTimeout(() => { fetchQuote(amount) }, 500)
    return () => clearTimeout(timer)
  }, [amount, fetchQuote])

  const handleSwap = async () => {
    if (!address || !quote || !publicClient) return
    try {
      const amountRaw = parseUnits(amount, tokenInDecimals)

      // 确定 router 地址（approve 目标）
      let routerAddr: `0x${string}`
      if (quote.provider === 'odos') {
        const routers: Record<number, `0x${string}`> = {
          1:     '0xCf5540fFFCdC3d510B18bFcA6d2b9987b0772559',
          56:    '0x89b8AA89FDd0507a99d334CBe3C808fAFC7d850E',
          8453:  '0x19cEeAd7105607Cd444F5ad10dd51356436095a1',
          42161: '0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13',
        }
        routerAddr = routers[chainId]
      } else if (quote.provider === 'uniswap') {
        routerAddr = (quote.uniTx?.to || '0x') as `0x${string}`
      } else {
        routerAddr = (quote.routerAddress || quote.routeSummary?.routerAddress) as `0x${string}`
      }

      // 1. 检查 allowance
      const allowance = await publicClient.readContract({
        address: tokenIn as `0x${string}`,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, routerAddr],
      })

      // 2. Approve
      if (allowance < amountRaw) {
        setStep('approve')
        const approveTx = await writeContractAsync({
          address: tokenIn as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [routerAddr, amountRaw],
        })
        setTxHash(approveTx)
        await publicClient.waitForTransactionReceipt({ hash: approveTx })
      }

      // 3. Build swap tx
      setStep('swap')
      let tx: { to: string; data: string; value: string; gas?: number }
      if (quote.provider === 'odos') {
        tx = await assembleOdosTx(address, quote.pathId!)
      } else if (quote.provider === 'uniswap') {
        // Uniswap Smart Router calldata 已在 quote 中
        if (!quote.uniTx) throw new Error('Missing Uniswap tx data')
        tx = quote.uniTx
      } else {
        tx = await assembleKyberTx(chainId, quote.routeSummary, address, 50)
      }

      // 4. 执行
      const swapTx = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as Hex,
        value: BigInt(tx.value || '0'),
        ...(tx.gas ? { gas: BigInt(Math.ceil(tx.gas * 1.25)) } : {}),
      })
      setTxHash(swapTx)
      setStep('done')
    } catch (err: any) {
      setQuoteError(err?.shortMessage || err?.message || 'Transaction failed')
      setStep('input')
    }
  }

  const outputAmount = quote
    ? formatUnits(BigInt(quote.amountOut), tokenOutDecimals)
    : ''

  // 预检中
  if (precheck === 'checking') {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[#94A3B8]">
        <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Checking DEX liquidity…</span>
      </div>
    )
  }

  // 无任何 DEX 路由
  if (precheck === 'none') {
    return (
      <div className="py-8 px-4 text-center">
        <div className="w-12 h-12 bg-[#FEF3C7] rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="text-xl">⚠️</span>
        </div>
        <p className="font-semibold text-[#92400E] mb-1">No DEX Liquidity</p>
        <p className="text-sm text-[#94A3B8] max-w-xs mx-auto">
          {tokenOutSymbol} does not have a valid swap route on {chainInfo?.name ?? 'this chain'}.
          Try a different chain or issuer.
        </p>
      </div>
    )
  }

  return (
    <div className="py-3 px-1">
      {/* Chain badge + provider */}
      {chainInfo && (
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
            style={{ color: chainInfo.color, borderColor: `${chainInfo.color}40`, background: `${chainInfo.color}10` }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: chainInfo.color }} />
            {chainInfo.name}
          </span>
          <span className="text-xs text-[#94A3B8]">
            {quote ? `via ${quote.provider === 'odos' ? 'Odos' : 'KyberSwap'}` : 'Smart Route'}
          </span>
        </div>
      )}

      {/* Input */}
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#64748B]">You pay</span>
          <span className="text-xs font-medium text-[#0F172A] bg-white border border-[#E2E8F0] px-2 py-0.5 rounded-md">
            {tokenInSymbol}
          </span>
        </div>
        <input
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={e => { setAmount(e.target.value); setStep('input'); setQuoteError('') }}
          className="w-full bg-transparent text-2xl font-semibold text-[#0F172A] outline-none placeholder:text-[#CBD5E1]"
          min="0"
          step="any"
        />
      </div>

      {/* Arrow */}
      <div className="flex justify-center -my-1 relative z-10">
        <div className="w-8 h-8 bg-white border border-[#E2E8F0] rounded-lg flex items-center justify-center text-[#64748B]">
          ↓
        </div>
      </div>

      {/* Output */}
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 mt-2 mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#64748B]">You receive</span>
          <span className="text-xs font-medium text-[#0F172A] bg-white border border-[#E2E8F0] px-2 py-0.5 rounded-md">
            {tokenOutSymbol}
          </span>
        </div>
        <div className="text-2xl font-semibold text-[#0F172A]">
          {quoteLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
              <span className="text-[#94A3B8] text-lg">Scanning DEXs…</span>
            </div>
          ) : outputAmount ? (
            Number(outputAmount).toFixed(6)
          ) : (
            <span className="text-[#CBD5E1]">0.00</span>
          )}
        </div>
        {quote?.priceImpact != null && (
          <p className={`text-xs mt-1 ${Math.abs(quote.priceImpact) > 3 ? 'text-[#DC2626]' : 'text-[#64748B]'}`}>
            Price Impact: {quote.priceImpact.toFixed(2)}%
          </p>
        )}
      </div>

      {/* Error */}
      {quoteError && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2 mb-3 text-xs text-[#DC2626]">
          {quoteError}
        </div>
      )}

      {/* Action Button */}
      {!address ? (
        <button disabled className="w-full bg-[#94A3B8] text-white font-semibold py-3.5 rounded-xl text-sm cursor-not-allowed">
          Connect Wallet
        </button>
      ) : step === 'done' && txSuccess ? (
        <div className="text-center py-3">
          <div className="text-[#16A34A] font-semibold mb-1">Swap Successful</div>
          <p className="text-xs text-[#94A3B8]">Transaction confirmed</p>
        </div>
      ) : (
        <button
          onClick={handleSwap}
          disabled={!quote || quoteLoading || txPending}
          className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#94A3B8] text-white font-semibold py-3.5 rounded-xl transition-colors text-sm disabled:cursor-not-allowed"
        >
          {txPending
            ? (step === 'approve' ? 'Approving…' : 'Swapping…')
            : !quote && quoteError
              ? 'No Route Available'
              : !quote
                ? 'Enter amount'
                : `${action === 'buy' ? 'Buy' : 'Sell'} ${tokenOutSymbol}`
          }
        </button>
      )}
    </div>
  )
}
