import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import {
  AlphaRouter,
  SwapType,
  SwapOptionsSwapRouter02,
} from '@uniswap/smart-order-router'
import { Token, CurrencyAmount, TradeType, Percent } from '@uniswap/sdk-core'

const RPC_URL: Record<number, string> = {
  1:     'https://eth.llamarpc.com',
  56:    'https://bsc-rpc.publicnode.com',
  8453:  'https://base.llamarpc.com',
  42161: 'https://arbitrum.llamarpc.com',
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const chainId = Number(searchParams.get('chainId'))
  const tokenIn = searchParams.get('tokenIn')
  const tokenOut = searchParams.get('tokenOut')
  const amount = searchParams.get('amount')       // raw amount string (wei/smallest unit)
  const decimalsIn = Number(searchParams.get('decimalsIn') || '6')
  const decimalsOut = Number(searchParams.get('decimalsOut') || '18')
  const recipient = searchParams.get('recipient') || '0x0000000000000000000000000000000000000001'

  if (!chainId || !tokenIn || !tokenOut || !amount) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const rpc = RPC_URL[chainId]
  if (!rpc) {
    return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 })
  }

  try {
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc, chainId)
    const router = new AlphaRouter({ chainId, provider: provider as any })

    const tokenA = new Token(chainId, tokenIn, decimalsIn)
    const tokenB = new Token(chainId, tokenOut, decimalsOut)
    const amountIn = CurrencyAmount.fromRawAmount(tokenA, amount)

    const swapOptions: SwapOptionsSwapRouter02 = {
      recipient,
      slippageTolerance: new Percent(50, 10000), // 0.5%
      deadline: Math.floor(Date.now() / 1000 + 1800),
      type: SwapType.SWAP_ROUTER_02,
    }

    const route = await router.route(amountIn, tokenB, TradeType.EXACT_INPUT, swapOptions)

    if (!route || !route.quote) {
      return NextResponse.json({ error: 'No route found' }, { status: 404 })
    }

    return NextResponse.json({
      amountOut: route.quote.toExact(),
      amountOutRaw: route.quote.quotient.toString(),
      gasPriceWei: route.gasPriceWei?.toString(),
      estimatedGasUsed: route.estimatedGasUsed?.toString(),
      routeString: (route as any).routeString ?? null,
      // calldata for execution
      tx: route.methodParameters ? {
        to: route.methodParameters.to,
        data: route.methodParameters.calldata,
        value: route.methodParameters.value,
      } : null,
    })
  } catch (err: any) {
    console.error('[swap-quote]', err.message || err)
    return NextResponse.json({ error: err.message || 'Quote failed' }, { status: 500 })
  }
}
