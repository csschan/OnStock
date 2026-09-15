'use client'

import { useState, useEffect } from 'react'
import { Widget } from '@kyberswap/widgets'
import { useAccount } from 'wagmi'
import { USDC_BY_CHAIN, KYBER_SUPPORTED_CHAINS } from '@/lib/web3'
import RobinhoodSwapWidget from './RobinhoodSwapWidget'
import DirectSwapWidget from './DirectSwapWidget'

interface SwapWidgetProps {
  tokenAddress: string
  tokenSymbol: string
  action: 'buy' | 'sell'
  chainId: number
  basePrice?: number
}

// 路由检测结果：kyber=KyberSwap 有效路由, odos=fallback 走 Odos 聚合, none=无流动性
type RouteResult = 'kyber' | 'odos' | 'none' | null

// 代理 GET 请求，避免 CORS
function proxyGet(url: string, opts?: { signal?: AbortSignal }) {
  return fetch(`/api/dex-proxy?url=${encodeURIComponent(url)}`, {
    signal: opts?.signal,
  })
}

const USDC_LOGO = 'https://assets.coingecko.com/coins/images/6319/small/usdc.png'

const USDC_META: Record<number, { name: string; logoURI: string }> = {
  1:     { name: 'USD Coin', logoURI: USDC_LOGO },
  56:    { name: 'USD Coin', logoURI: USDC_LOGO },
  8453:  { name: 'USD Coin', logoURI: USDC_LOGO },
  42161: { name: 'USD Coin', logoURI: USDC_LOGO },
}

const RPC_URL: Record<number, string> = {
  1:     'https://rpc.ankr.com/eth',
  56:    'https://rpc.ankr.com/bsc',
  8453:  'https://rpc.ankr.com/base',
  42161: 'https://rpc.ankr.com/arbitrum',
}

const CHAIN_LABEL: Record<number, { name: string; color: string }> = {
  1:     { name: 'Ethereum', color: '#627EEA' },
  56:    { name: 'BNB Chain', color: '#F0B90B' },
  8453:  { name: 'Base', color: '#0052FF' },
  42161: { name: 'Arbitrum', color: '#28A0F0' },
}

const KYBER_CHAIN_SLUG: Record<number, string> = {
  1: 'ethereum', 56: 'bsc', 8453: 'base', 42161: 'arbitrum',
}

// 检查 KyberSwap 路由：100 USDC → token，输出价值需在合理范围内
async function checkKyberRoute(
  chainId: number,
  usdc: string,
  tokenAddress: string,
  basePrice: number,
): Promise<boolean> {
  const slug = KYBER_CHAIN_SLUG[chainId]
  if (!slug) return false
  try {
    const amountIn = (100 * 1e6).toFixed(0) // 100 USDC (decimals=6)
    const kyberUrl = `https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${usdc}&tokenOut=${tokenAddress}&amountIn=${amountIn}`
    const res = await proxyGet(kyberUrl, { signal: AbortSignal.timeout(8000) })
    const json = await res.json()
    const amountOut = json?.data?.routeSummary?.amountOut
    if (!amountOut) return false
    const tokenAmount = Number(amountOut) / 1e18
    const usdValue = tokenAmount * basePrice
    // 100 USDC 换出价值在 $40–$500 之间视为有效（允许较大波动）
    return usdValue > 40 && usdValue < 500
  } catch {
    return false
  }
}

// 检查 Paraswap 路由（聚合 Uniswap/PancakeSwap/Curve 等）
async function checkParaswapRoute(
  chainId: number,
  usdc: string,
  tokenAddress: string,
  basePrice: number,
): Promise<boolean> {
  try {
    const amountIn = (100 * 1e6).toFixed(0)
    const paraUrl = `https://apiv5.paraswap.io/prices?srcToken=${usdc}&destToken=${tokenAddress}&srcDecimals=6&destDecimals=18&amount=${amountIn}&network=${chainId}&side=SELL`
    const res = await proxyGet(paraUrl, { signal: AbortSignal.timeout(8000) })
    const json = await res.json()
    const destAmount = json?.priceRoute?.destAmount
    if (!destAmount) return false
    const tokenAmount = Number(destAmount) / 1e18
    const usdValue = tokenAmount * basePrice
    return usdValue > 40 && usdValue < 500
  } catch {
    return false
  }
}

// 检查所有路由，返回最优选择
async function detectBestRoute(
  chainId: number,
  usdc: string,
  tokenAddress: string,
  basePrice: number,
): Promise<RouteResult> {
  const [kyberOk, paraswapOk] = await Promise.all([
    checkKyberRoute(chainId, usdc, tokenAddress, basePrice),
    checkParaswapRoute(chainId, usdc, tokenAddress, basePrice),
  ])

  if (kyberOk) return 'kyber'
  if (paraswapOk) return 'odos'
  // 都没有路由时也走 odos，让 DirectSwapWidget 内部的 Uniswap fallback 尝试
  return 'odos'
}

export default function SwapWidget({ tokenAddress, tokenSymbol, action, chainId, basePrice }: SwapWidgetProps) {
  const { address } = useAccount()
  const usdc = USDC_BY_CHAIN[chainId]
  const tokenIn  = action === 'buy' ? usdc : tokenAddress
  const tokenOut = action === 'buy' ? tokenAddress : usdc

  if (chainId === 4663) {
    return <RobinhoodSwapWidget tokenAddress={tokenAddress} tokenSymbol={tokenSymbol} action={action} basePrice={basePrice} />
  }

  if (!KYBER_SUPPORTED_CHAINS.has(chainId)) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-[#64748B]">This chain is not supported for in-app swaps.</p>
      </div>
    )
  }

  return (
    <SwapWidgetInner
      tokenAddress={tokenAddress}
      tokenSymbol={tokenSymbol}
      action={action}
      chainId={chainId}
      basePrice={basePrice}
      address={address}
      usdc={usdc}
      tokenIn={tokenIn}
      tokenOut={tokenOut}
    />
  )
}

function SwapWidgetInner({
  tokenAddress, tokenSymbol, action, chainId, basePrice,
  address, usdc, tokenIn, tokenOut,
}: {
  tokenAddress: string; tokenSymbol: string; action: 'buy' | 'sell'
  chainId: number; basePrice?: number; address?: string
  usdc: string; tokenIn: string; tokenOut: string
}) {
  const [route, setRoute] = useState<RouteResult>(null)

  useEffect(() => {
    if (!basePrice || basePrice <= 0) {
      // 没有 oracle 价格无法验证，默认尝试 KyberSwap
      setRoute('kyber')
      return
    }
    detectBestRoute(chainId, usdc, tokenAddress, basePrice).then(setRoute)
  }, [chainId, usdc, tokenAddress, basePrice])

  const chainInfo = CHAIN_LABEL[chainId]
  const usdcMeta = USDC_META[chainId]

  const kyberTokenList = [
    {
      name: tokenSymbol,
      symbol: tokenSymbol,
      address: tokenAddress,
      decimals: 18,
      logoURI: 'https://assets.coingecko.com/coins/images/26468/small/ondo.png',
      chainId,
      isImport: true,
    },
    ...(usdc && usdcMeta ? [{
      name: usdcMeta.name,
      symbol: 'USDC',
      address: usdc,
      decimals: 6,
      logoURI: USDC_LOGO,
      chainId,
    }] : []),
  ]

  // 检查中
  if (route === null) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[#94A3B8]">
        <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Finding best liquidity route…</span>
      </div>
    )
  }

  // 没有任何路由
  if (route === 'none') {
    return (
      <div className="py-8 px-4 text-center">
        <div className="w-12 h-12 bg-[#FEF3C7] rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="text-xl">⚠️</span>
        </div>
        <p className="font-semibold text-[#92400E] mb-1">No On-Chain Liquidity Route</p>
        <p className="text-sm text-[#94A3B8] max-w-xs mx-auto">
          {tokenSymbol} does not have sufficient DEX liquidity on{' '}
          {chainInfo?.name ?? 'this chain'} at this time.
        </p>
      </div>
    )
  }

  // KyberSwap 无效 → Odos 智能路由（聚合 Uniswap v4/PancakeSwap 等）
  if (route === 'odos') {
    const inSymbol = action === 'buy' ? 'USDC' : tokenSymbol
    const outSymbol = action === 'buy' ? tokenSymbol : 'USDC'
    return (
      <DirectSwapWidget
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        tokenInSymbol={inSymbol}
        tokenOutSymbol={outSymbol}
        tokenInDecimals={action === 'buy' ? 6 : 18}
        tokenOutDecimals={action === 'buy' ? 18 : 6}
        chainId={chainId}
        action={action}
      />
    )
  }

  // KyberSwap widget（主路由）
  return (
    <div className="kyber-widget-wrapper">
      {chainInfo && (
        <div className="flex items-center gap-2 px-1 pb-2">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
            style={{ color: chainInfo.color, borderColor: `${chainInfo.color}40`, background: `${chainInfo.color}10` }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: chainInfo.color }} />
            {chainInfo.name}
          </span>
          <span className="text-xs text-[#94A3B8]">via KyberSwap</span>
        </div>
      )}
      <Widget
        client="onstock"
        rpcUrl={RPC_URL[chainId]}
        theme={{
          primary: '#FFFFFF',
          secondary: '#F8FAFC',
          dialog: '#FFFFFF',
          borderRadius: '12px',
          buttonRadius: '8px',
          stroke: '#CBD5E1',
          interactive: '#EFF6FF',
          accent: '#2563EB',
          success: '#16A34A',
          warning: '#D97706',
          error: '#DC2626',
          text: '#0F172A',
          subText: '#475569',
          fontFamily: 'Inter, sans-serif',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
        tokenList={kyberTokenList}
        defaultTokenIn={tokenIn}
        defaultTokenOut={tokenOut}
        chainId={chainId}
        connectedAccount={{ address: address ?? undefined, chainId }}
        onSubmitTx={async () => ''}
        width={480}
        enableRoute
      />
    </div>
  )
}
