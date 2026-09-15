'use client'

// In-app swap for Robinhood Chain (chainId 4663)
// Uses Uniswap v3 SwapRouter02 directly via wagmi + viem
// Platform collects 0.1% fee on each trade
//
// Why v3 not v4: Robinhood Chain's UniversalRouter v4 has a custom
// `minHopPriceX36` field in the swap struct — stock Uniswap SDK calldata reverts.
// Uniswap v3 SwapRouter02 uses the standard ABI and works without modification.

import { useState, useEffect, useCallback } from 'react'
import { parseUnits, formatUnits, parseAbi, maxUint256, type Abi } from 'viem'
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from 'wagmi'
import { USDC_BY_CHAIN, UNISWAP_V3_ROUTER, UNISWAP_V3_QUOTER, PLATFORM_FEE_BPS } from '@/lib/chains'

const CHAIN_ID = 4663
const USDG = USDC_BY_CHAIN[CHAIN_ID] as `0x${string}`
const ROUTER = UNISWAP_V3_ROUTER as `0x${string}`
const QUOTER  = UNISWAP_V3_QUOTER as `0x${string}`
// Platform fee wallet — disabled if not configured
const PLATFORM_FEE_WALLET = (process.env.NEXT_PUBLIC_PLATFORM_FEE_WALLET || '') as `0x${string}`
const HAS_FEE_WALLET = PLATFORM_FEE_WALLET.length === 42 && PLATFORM_FEE_WALLET.startsWith('0x')

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]) satisfies Abi

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]) satisfies Abi

const ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
]) satisfies Abi

const STOCK_DECIMALS = 18
const USDG_DECIMALS  = 6
const FEE_TIERS = [3000, 10000]

type Stage = 'idle' | 'quoting' | 'approving' | 'fee' | 'swapping' | 'success' | 'error'

interface Props {
  tokenAddress: string
  tokenSymbol: string
  action: 'buy' | 'sell'
  basePrice?: number  // oracle/dex price used as fallback when QuoterV2 is unavailable
}

export default function RobinhoodSwapWidget({ tokenAddress, tokenSymbol, action, basePrice }: Props) {
  const { address, chainId: walletChainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { switchChain } = useSwitchChain()

  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState<string | null>(null)
  const [bestFeeTier, setBestFeeTier] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [isApproved, setIsApproved] = useState(false)

  const needsChainSwitch = walletChainId !== CHAIN_ID
  const tokenIn  = (action === 'buy' ? USDG : tokenAddress) as `0x${string}`
  const tokenOut = (action === 'buy' ? tokenAddress : USDG) as `0x${string}`
  const inDecimals  = action === 'buy' ? USDG_DECIMALS : STOCK_DECIMALS
  const outDecimals = action === 'buy' ? STOCK_DECIMALS : USDG_DECIMALS

  const feeAmt = amountIn ? (parseFloat(amountIn) * PLATFORM_FEE_BPS / 10000) : 0
  const netAmountIn = amountIn
    ? Math.max(0, parseFloat(amountIn) - feeAmt).toFixed(6)
    : ''

  // Fallback: estimate output from oracle/dex price when QuoterV2 is unavailable
  const applyPriceFallback = useCallback((inputStr: string) => {
    if (!basePrice || !inputStr || parseFloat(inputStr) <= 0) return
    const qty = parseFloat(inputStr)
    const estimated = action === 'buy'
      ? qty / basePrice   // USDG → stock: USDG amount / price = stock qty
      : qty * basePrice   // stock → USDG: stock qty * price = USDG amount
    setAmountOut(`~${estimated.toFixed(4)}`)
  }, [basePrice, action])

  // Get best quote across fee tiers
  const fetchQuote = useCallback(async (inputStr: string) => {
    if (!publicClient || !inputStr || parseFloat(inputStr) <= 0) {
      setAmountOut(null); return
    }
    setStage('quoting')
    try {
      const amountInWei = parseUnits(inputStr, inDecimals)
      let best: { out: bigint; fee: number } | null = null

      for (const fee of FEE_TIERS) {
        try {
          const { result } = await publicClient.simulateContract({
            address: QUOTER,
            abi: QUOTER_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{ tokenIn, tokenOut, amountIn: amountInWei, fee, sqrtPriceLimitX96: 0n }],
          })
          const out = result[0] as bigint
          if (!best || out > best.out) best = { out, fee }
        } catch { /* fee tier not available */ }
      }

      if (best) {
        setAmountOut(parseFloat(formatUnits(best.out, outDecimals)).toFixed(4))
        setBestFeeTier(best.fee)
      } else {
        // On-chain QuoterV2 unavailable — fall back to oracle price estimate
        applyPriceFallback(inputStr)
        setBestFeeTier(FEE_TIERS[0]) // assume 0.3% pool
      }
    } catch {
      applyPriceFallback(inputStr)
      setBestFeeTier(FEE_TIERS[0])
    }
    setStage('idle')
  }, [publicClient, tokenIn, tokenOut, inDecimals, outDecimals])

  const checkAllowance = useCallback(async () => {
    if (!publicClient || !address || !netAmountIn) return
    const allowance = await publicClient.readContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, ROUTER],
    }) as bigint
    setIsApproved(allowance >= parseUnits(netAmountIn, inDecimals))
  }, [publicClient, address, tokenIn, netAmountIn, inDecimals])

  useEffect(() => {
    // Show price estimate immediately, then refine with on-chain quote
    if (netAmountIn && parseFloat(netAmountIn) > 0) applyPriceFallback(netAmountIn)
    const t = setTimeout(() => fetchQuote(netAmountIn), 600)
    return () => clearTimeout(t)
  }, [netAmountIn, fetchQuote, applyPriceFallback])

  useEffect(() => { checkAllowance() }, [checkAllowance])

  async function handleApprove() {
    if (!address) return
    setStage('approving'); setError(null)
    try {
      const hash = await writeContractAsync({
        chainId: CHAIN_ID,
        address: tokenIn,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [ROUTER, maxUint256],
      })
      await publicClient!.waitForTransactionReceipt({ hash })
      setIsApproved(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 120) : 'Approval failed')
    }
    setStage('idle')
  }

  async function handleSwap() {
    if (!address || !amountOut || !bestFeeTier) return
    setStage('swapping'); setError(null)
    try {
      const amountInWei = parseUnits(netAmountIn, inDecimals)
      const minOut = parseUnits(amountOut, outDecimals) * 995n / 1000n

      // Platform fee: transfer 0.1% to fee wallet before swap
      if (feeAmt > 0 && HAS_FEE_WALLET) {
        setStage('fee')
        const feeWei = parseUnits(feeAmt.toFixed(6), inDecimals)
        const feeHash = await writeContractAsync({
          chainId: CHAIN_ID,
          address: tokenIn,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [PLATFORM_FEE_WALLET, feeWei],
        })
        await publicClient!.waitForTransactionReceipt({ hash: feeHash })
        setStage('swapping')
      }

      const hash = await writeContractAsync({
        chainId: CHAIN_ID,
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn,
          tokenOut,
          fee: bestFeeTier,
          recipient: address,
          amountIn: amountInWei,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        }],
      })
      await publicClient!.waitForTransactionReceipt({ hash })
      setTxHash(hash)
      setStage('success')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 120) : 'Swap failed')
      setStage('error')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div className="text-center py-6 text-sm text-[#64748B]">
        Connect your wallet to trade on Robinhood Chain.
      </div>
    )
  }

  if (needsChainSwitch) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-[#64748B] mb-3">Switch to Robinhood Chain to trade in-app.</p>
        <button
          onClick={() => switchChain({ chainId: CHAIN_ID })}
          className="text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-4 py-2 rounded-lg transition-colors"
        >
          Switch to Robinhood Chain
        </button>
      </div>
    )
  }

  if (stage === 'success' && txHash) {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 bg-[#F0FDF4] rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">✓</div>
        <p className="font-semibold text-[#15803D] mb-1">Swap confirmed!</p>
        <a
          href={`https://robinhoodchain.blockscout.com/tx/${txHash}`}
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-[#2563EB] hover:underline"
        >
          View on Blockscout →
        </a>
        <button onClick={() => { setStage('idle'); setAmountIn(''); setAmountOut(null); setTxHash(null) }}
          className="block mx-auto mt-4 text-xs text-[#64748B] hover:underline">
          New swap
        </button>
      </div>
    )
  }

  const isLoading = ['quoting', 'approving', 'fee', 'swapping'].includes(stage)
  const stageLabel: Record<Stage, string> = {
    idle: action === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`,
    quoting: 'Getting quote…',
    approving: 'Approving…',
    fee: 'Sending fee…',
    swapping: 'Swapping…',
    success: 'Done!',
    error: action === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`,
  }

  return (
    <div className="space-y-3">
      {/* Input */}
      <div>
        <label className="block text-xs text-[#64748B] mb-1.5">
          {action === 'buy' ? 'USDG you pay' : `${tokenSymbol} you sell`}
        </label>
        <input
          type="number"
          min="0"
          step="any"
          value={amountIn}
          onChange={e => setAmountIn(e.target.value)}
          placeholder="0.00"
          className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-price focus:outline-none focus:border-[#2563EB] transition-colors"
        />
      </div>

      {/* Quote output */}
      {netAmountIn && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2.5">
          <p className="text-xs text-[#94A3B8] mb-0.5">
            {action === 'buy' ? `${tokenSymbol} you receive` : 'USDG you receive'}
          </p>
          <p className="font-price text-sm font-semibold">
            {stage === 'quoting' ? '…' : (amountOut ?? '—')}
          </p>
        </div>
      )}

      {/* Fee breakdown */}
      {amountIn && parseFloat(amountIn) > 0 && (
        <div className="text-xs text-[#94A3B8] space-y-0.5 px-0.5">
          <div className="flex justify-between">
            <span>Platform fee (0.1%)</span>
            <span>{feeAmt.toFixed(4)} {action === 'buy' ? 'USDG' : tokenSymbol}</span>
          </div>
          <div className="flex justify-between">
            <span>Slippage tolerance</span>
            <span>0.5%</span>
          </div>
          {bestFeeTier && (
            <div className="flex justify-between">
              <span>Pool fee</span>
              <span>{(bestFeeTier / 10000).toFixed(2)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Approve + Swap buttons */}
      <div className="space-y-2">
        {!isApproved && netAmountIn && parseFloat(netAmountIn) > 0 && (
          <button
            onClick={handleApprove}
            disabled={isLoading}
            className="w-full text-sm font-medium text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {stage === 'approving' ? 'Approving…' : `Approve ${action === 'buy' ? 'USDG' : tokenSymbol}`}
          </button>
        )}
        <button
          onClick={handleSwap}
          disabled={isLoading || !amountOut || !isApproved}
          className="w-full text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-4 py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {stageLabel[stage]}
        </button>
      </div>

      <p className="text-xs text-[#94A3B8] text-center">
        Uniswap v3 · Robinhood Chain · 0.1% platform fee
      </p>
    </div>
  )
}
