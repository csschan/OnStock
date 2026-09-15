'use client'

// LayerZero OFT Bridge — 在平台内直接 burn/mint 跨链
// 调用 Ondo token 合约的 send() 函数，不经过第三方 bridge
// BNB burn → ETH mint（或任意支持的链对）

import { useState, useCallback, useEffect } from 'react'
import { parseUnits, formatUnits, parseAbi, type Abi } from 'viem'
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from 'wagmi'
import { CHAIN_ID } from '@/lib/chains'

// LayerZero V2 Endpoint IDs
const LZ_EID: Record<string, number> = {
  ethereum:  30101,
  bnb:       30102,
  base:      30184,
  arbitrum:  30110,
  hyperevm:  30350,
}

// 各 issuer 支持的 OFT 跨链链对（与后端白名单保持一致）
const OFT_SUPPORTED: Record<string, Set<string>> = {
  ondo:   new Set(['ethereum', 'bnb', 'hyperevm']),
  dinari: new Set(['ethereum', 'arbitrum', 'base', 'hyperevm']),
}

function isSupported(issuer: string, fromChain: string, toChain: string): boolean {
  const chains = OFT_SUPPORTED[issuer]
  if (!chains) return false
  return chains.has(fromChain) && chains.has(toChain)
}

// OFT V2 ABI — send() + quoteSend()
const OFT_ABI = parseAbi([
  // 估算 LayerZero 手续费（view，不消耗 gas）
  'function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)',
  // 执行跨链 burn（发送方）
  'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) receipt)',
  // 查询 token 精度
  'function decimals() external view returns (uint8)',
]) satisfies Abi

// LayerZero Scan 用于轮询状态
const LZ_SCAN_API = 'https://scan.layerzero-api.com/v1/messages/tx'

type Stage = 'idle' | 'quoting' | 'sending' | 'pending' | 'success' | 'error'

interface Props {
  tokenAddress: string   // 源链合约地址
  tokenSymbol: string
  issuer: string         // 'ondo' | 'dinari' 等
  fromChain: string      // 'bnb' | 'ethereum' | 'base' | 'arbitrum' | 'hyperevm'
  toChain: string
  amount?: string        // 预填金额（可选）
}

// 将 address 转成 LayerZero bytes32 格式
function addressToBytes32(addr: string): `0x${string}` {
  return `0x${addr.replace('0x', '').toLowerCase().padStart(64, '0')}`
}

export default function OFTBridgeWidget({ tokenAddress, tokenSymbol, issuer, fromChain, toChain, amount: initialAmount }: Props) {
  const { address, chainId: walletChainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID[fromChain] })
  const { switchChain } = useSwitchChain()

  const [amount, setAmount] = useState(initialAmount ?? '')
  const [lzFee, setLzFee] = useState<bigint | null>(null)
  const [minAmountOut, setMinAmountOut] = useState<bigint | null>(null)
  const [decimals, setDecimals] = useState<number>(18)
  const [stage, setStage] = useState<Stage>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [lzStatus, setLzStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fromChainId = CHAIN_ID[fromChain]
  const toEid = LZ_EID[toChain]
  const needsChainSwitch = walletChainId !== fromChainId
  const chainName = (c: string) => ({ ethereum: 'Ethereum', bnb: 'BNB Chain', base: 'Base', arbitrum: 'Arbitrum' } as Record<string, string>)[c] ?? c

  // 不在白名单内的 issuer/链对，直接提示不支持
  if (!isSupported(issuer, fromChain, toChain)) {
    return (
      <div className="py-6 text-center text-sm text-[#94A3B8]">
        <p className="font-medium text-[#0F172A] mb-1">Bridge not supported</p>
        <p>{issuer} does not support OFT bridge between {chainName(fromChain)} and {chainName(toChain)}.</p>
      </div>
    )
  }

  // 读取 token 精度
  useEffect(() => {
    if (!publicClient) return
    publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: OFT_ABI,
      functionName: 'decimals',
    }).then(d => setDecimals(d as number)).catch(() => setDecimals(18))
  }, [publicClient, tokenAddress])

  // quoteSend — 估算 LayerZero 手续费
  const fetchQuote = useCallback(async (amt: string) => {
    if (!publicClient || !address || !amt || parseFloat(amt) <= 0 || !toEid) return
    setStage('quoting'); setError(null)
    try {
      const amountLD = parseUnits(amt, decimals)
      const minAmount = amountLD * 995n / 1000n // 0.5% slippage

      const sendParam = {
        dstEid: toEid,
        to: addressToBytes32(address),
        amountLD,
        minAmountLD: minAmount,
        extraOptions: '0x' as `0x${string}`,
        composeMsg: '0x' as `0x${string}`,
        oftCmd: '0x' as `0x${string}`,
      }

      const result = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: OFT_ABI,
        functionName: 'quoteSend',
        args: [sendParam, false],
      }) as { nativeFee: bigint; lzTokenFee: bigint }

      setLzFee(result.nativeFee)
      setMinAmountOut(minAmount)
    } catch (e) {
      setError('Failed to estimate bridge fee. The token may not support OFT on this chain.')
    }
    setStage('idle')
  }, [publicClient, address, tokenAddress, toEid, decimals])

  useEffect(() => {
    const t = setTimeout(() => fetchQuote(amount), 600)
    return () => clearTimeout(t)
  }, [amount, fetchQuote])

  // 轮询 LayerZero Scan 查状态
  const pollLzStatus = useCallback(async (hash: string) => {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      try {
        const res = await fetch(`${LZ_SCAN_API}/${hash}`)
        const json = await res.json()
        const msg = json?.data?.[0]
        if (msg?.status?.name) {
          setLzStatus(msg.status.name)
          if (msg.status.name === 'DELIVERED') {
            setStage('success')
            clearInterval(interval)
          }
        }
      } catch { /* ignore */ }
      if (attempts > 60) clearInterval(interval) // 最多轮询 5 分钟
    }, 5000)
  }, [])

  async function handleBridge() {
    if (!address || !lzFee || !minAmountOut || !toEid) return
    setStage('sending'); setError(null)
    try {
      const amountLD = parseUnits(amount, decimals)
      const sendParam = {
        dstEid: toEid,
        to: addressToBytes32(address),
        amountLD,
        minAmountLD: minAmountOut,
        extraOptions: '0x' as `0x${string}`,
        composeMsg: '0x' as `0x${string}`,
        oftCmd: '0x' as `0x${string}`,
      }
      const fee = { nativeFee: lzFee, lzTokenFee: 0n }

      const hash = await writeContractAsync({
        chainId: fromChainId,
        address: tokenAddress as `0x${string}`,
        abi: OFT_ABI,
        functionName: 'send',
        args: [sendParam, fee, address],
        value: lzFee,
      })

      setTxHash(hash)
      setStage('pending')
      setLzStatus('INFLIGHT')
      pollLzStatus(hash)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 150) : 'Bridge failed')
      setStage('error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div className="text-center py-6 text-sm text-[#64748B]">
        Connect your wallet to bridge {tokenSymbol}.
      </div>
    )
  }

  if (needsChainSwitch) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-[#64748B] mb-3">Switch to {chainName(fromChain)} to bridge.</p>
        <button
          onClick={() => switchChain({ chainId: fromChainId })}
          className="text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-4 py-2 rounded-lg transition-colors"
        >
          Switch to {chainName(fromChain)}
        </button>
      </div>
    )
  }

  if (stage === 'success') {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 bg-[#F0FDF4] rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">✓</div>
        <p className="font-semibold text-[#15803D] mb-1">Bridge complete!</p>
        <p className="text-xs text-[#64748B] mb-2">
          {tokenSymbol} arrived on {chainName(toChain)}
        </p>
        {txHash && (
          <a href={`https://layerzeroscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-[#2563EB] hover:underline">
            View on LayerZero Scan →
          </a>
        )}
        <button onClick={() => { setStage('idle'); setAmount(''); setTxHash(null); setLzStatus(null) }}
          className="block mx-auto mt-4 text-xs text-[#64748B] hover:underline">
          New bridge
        </button>
      </div>
    )
  }

  if (stage === 'pending') {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 bg-[#EFF6FF] rounded-full flex items-center justify-center mx-auto mb-3">
          <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="font-semibold text-[#1E40AF] mb-1">Bridging in progress…</p>
        <p className="text-xs text-[#64748B] mb-1">LayerZero status: <span className="font-medium">{lzStatus ?? 'INFLIGHT'}</span></p>
        <p className="text-xs text-[#94A3B8]">Usually takes 10–20 minutes</p>
        {txHash && (
          <a href={`https://layerzeroscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="block mt-3 text-xs text-[#2563EB] hover:underline">
            Track on LayerZero Scan →
          </a>
        )}
      </div>
    )
  }

  const isLoading = stage === 'quoting' || stage === 'sending'

  return (
    <div className="space-y-3">
      {/* Route display */}
      <div className="flex items-center gap-2 text-xs text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
        <span className="font-medium text-[#0F172A]">{chainName(fromChain)}</span>
        <span>→</span>
        <span className="font-medium text-[#0F172A]">{chainName(toChain)}</span>
        <span className="ml-auto text-[#94A3B8]">via LayerZero OFT</span>
      </div>

      {/* Amount input */}
      <div>
        <label className="block text-xs text-[#64748B] mb-1.5">{tokenSymbol} amount to bridge</label>
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-price focus:outline-none focus:border-[#2563EB] transition-colors"
        />
      </div>

      {/* Fee estimate */}
      {lzFee != null && (
        <div className="text-xs text-[#94A3B8] space-y-0.5 px-0.5">
          <div className="flex justify-between">
            <span>LayerZero fee</span>
            <span>~{parseFloat(formatUnits(lzFee, 18)).toFixed(5)} {fromChain === 'bnb' ? 'BNB' : 'ETH'}</span>
          </div>
          <div className="flex justify-between">
            <span>Slippage tolerance</span>
            <span>0.5%</span>
          </div>
          <div className="flex justify-between">
            <span>Est. time</span>
            <span>10–20 min</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Bridge button */}
      <button
        onClick={handleBridge}
        disabled={isLoading || !lzFee || !amount || parseFloat(amount) <= 0}
        className="w-full text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-4 py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {stage === 'quoting' ? 'Estimating fee…' : stage === 'sending' ? 'Confirm in wallet…' : `Bridge ${tokenSymbol} to ${chainName(toChain)}`}
      </button>

      <p className="text-xs text-[#94A3B8] text-center">
        LayerZero OFT · burn on {chainName(fromChain)}, mint on {chainName(toChain)}
      </p>
    </div>
  )
}
