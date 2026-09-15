'use client'

import { useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import type { InstrumentData } from '@/lib/api'
import { USDC_BY_CHAIN } from '@/lib/chains'
import DirectSwapWidget from './DirectSwapWidget'
import JupiterSwapWidget from './JupiterSwapWidget'

interface BuyFlowProps {
  ticker: string
  instrument: InstrumentData
  onClose: () => void
  action?: 'buy' | 'sell'
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627EEA',
  bnb: '#F0B90B',
  base: '#0052FF',
  arbitrum: '#28A0F0',
  solana: '#9945FF',
  'rh-chain': '#00C805',
}

export default function BuyFlow({ ticker, instrument, onClose, action = 'buy' }: BuyFlowProps) {
  const usdcIn = USDC_BY_CHAIN[instrument.chainId]
  const isEvm = !!usdcIn && instrument.chainId !== 0
  const isSell = action === 'sell'
  const isSolana = instrument.chainId === 0
  const isRobinhood = instrument.chainId === 4663

  const premiumColor = instrument.premiumPct == null
    ? '#64748B'
    : instrument.premiumPct <= 0
      ? '#16A34A'
      : '#DC2626'

  const chainColor = CHAIN_COLORS[instrument.chain] ?? '#94A3B8'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-semibold text-lg">{isSell ? 'Sell' : 'Buy'} {ticker}</h3>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full border"
                style={{ color: chainColor, borderColor: `${chainColor}40`, background: `${chainColor}10` }}
              >
                {instrument.chain}
              </span>
            </div>
            <p className="text-sm text-[#64748B]">
              {instrument.issuerName} · {instrument.tokenSymbol}
              {instrument.premiumPct != null && (
                <span className="ml-2 font-medium" style={{ color: premiumColor }}>
                  {instrument.premiumPct >= 0 ? '+' : ''}{instrument.premiumPct.toFixed(2)}% vs market
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#0F172A] transition-colors mt-0.5 ml-4"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Score + route info */}
        {instrument.score != null && (
          <div className="px-5 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center gap-4 text-xs text-[#64748B]">
            <span>
              Score: <span className="font-semibold text-[#0F172A]">{instrument.score}/100</span>
            </span>
            {instrument.liquidity.routes.length > 0 && (
              <span>
                via <span className="font-medium text-[#0F172A]">{instrument.liquidity.routes.join(', ')}</span>
              </span>
            )}
            {instrument.liquidity.slippage1k != null && (
              <span>
                ~{instrument.liquidity.slippage1k.toFixed(1)}% slippage/1k
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div className="px-5 py-4">
          {isSolana ? (
            <JupiterSwapWidget
              outputMint={instrument.contractAddress}
              tokenSymbol={instrument.tokenSymbol}
              action={action}
            />
          ) : isRobinhood ? (
            <div className="py-8 text-center">
              <div className="text-3xl mb-3">🟢</div>
              <p className="font-medium text-[#0F172A] mb-1">Robinhood Chain</p>
              <p className="text-sm text-[#64748B] mb-4">
                Trade {ticker} directly on Robinhood with no commission.
              </p>
              <a
                href={`https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${instrument.contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#00C805] text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-[#00A804] transition-colors"
              >
                Swap on Robinhood Chain <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : isEvm ? (
            <DirectSwapWidget
              tokenIn={isSell ? instrument.contractAddress : usdcIn}
              tokenOut={isSell ? usdcIn : instrument.contractAddress}
              tokenInSymbol={isSell ? instrument.tokenSymbol : 'USDC'}
              tokenOutSymbol={isSell ? 'USDC' : instrument.tokenSymbol}
              tokenInDecimals={isSell ? instrument.decimals : (instrument.chainId === 56 ? 18 : 6)}
              tokenOutDecimals={isSell ? (instrument.chainId === 56 ? 18 : 6) : instrument.decimals}
              chainId={instrument.chainId}
              action={action}
            />
          ) : (
            <div className="py-8 text-center text-sm text-[#64748B]">
              This chain is not yet supported for in-app trading.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
