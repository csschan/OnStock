'use client'

import { useState, useEffect } from 'react'
import { ShoppingCart, AlertTriangle, XCircle, Star } from 'lucide-react'
import type { InstrumentData } from '@/lib/api'
import BuyFlow from '@/components/BuyFlow'

interface AssetInstrumentsProps {
  ticker: string
  instruments: InstrumentData[]
  bestBuyId: string | null
  bestScoreId: string | null
  autoBuyIssuer?: string
  autoBuyChain?: string
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627EEA',
  bnb: '#F0B90B',
  base: '#0052FF',
  arbitrum: '#28A0F0',
  solana: '#9945FF',
  'rh-chain': '#00C805',
}

const STATUS_ICON = {
  tradeable: null,
  low_liquidity: <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />,
  no_route: <XCircle className="w-3.5 h-3.5 text-[#94A3B8]" />,
  unknown: null,
}

const STATUS_LABEL = {
  tradeable: null,
  low_liquidity: 'Low Liquidity',
  no_route: 'No DEX Route',
  unknown: null,
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null
  const color = score >= 80 ? '#16A34A' : score >= 60 ? '#D97706' : '#DC2626'
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color, background: `${color}15` }}
    >
      <Star className="w-3 h-3" />
      {score}
    </span>
  )
}

function PremiumBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[#94A3B8] text-sm">—</span>
  const color = pct <= 0 ? '#16A34A' : '#DC2626'
  return (
    <span className="text-sm font-medium" style={{ color }}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

export default function AssetInstruments({
  ticker, instruments, bestBuyId, bestScoreId, autoBuyIssuer, autoBuyChain,
}: AssetInstrumentsProps) {
  const [buying, setBuying] = useState<InstrumentData | null>(null)
  const [selling, setSelling] = useState<InstrumentData | null>(null)

  // Auto-open buy modal when coming from divergence panel
  useEffect(() => {
    if (autoBuyIssuer) {
      const target = instruments.find(
        i => i.issuer === autoBuyIssuer
          && (!autoBuyChain || i.chain === autoBuyChain)
          && (i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity')
      )
      if (target) setBuying(target)
    }
  }, [autoBuyIssuer, autoBuyChain, instruments])

  const tradeable = instruments.filter(
    i => i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity'
  )
  const noRoute = instruments.filter(i => i.liquidity.status === 'no_route')

  return (
    <>
      {/* Best route highlight */}
      {tradeable.length > 0 && (() => {
        const best = instruments.find(i => i.id === bestBuyId) ?? tradeable[0]
        return (
          <div className="bg-gradient-to-r from-[#EFF6FF] to-[#F0FDF4] border border-[#BFDBFE] rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#2563EB] mb-1 uppercase tracking-wide">Best Route</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lg text-[#0F172A]">{best.issuerName}</span>
                  <span className="text-[#64748B]">·</span>
                  <span
                    className="text-sm font-medium px-2 py-0.5 rounded-full border"
                    style={{
                      color: CHAIN_COLORS[best.chain] ?? '#64748B',
                      borderColor: `${CHAIN_COLORS[best.chain] ?? '#94A3B8'}40`,
                      background: `${CHAIN_COLORS[best.chain] ?? '#94A3B8'}10`,
                    }}
                  >
                    {best.chain}
                  </span>
                  <ScoreBadge score={best.score} />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  {best.price && (
                    <span className="font-semibold text-[#0F172A]">
                      ${best.price.toFixed(2)}
                    </span>
                  )}
                  <PremiumBadge pct={best.premiumPct} />
                  {best.liquidity.slippage1k != null && (
                    <span className="text-xs text-[#64748B]">
                      ~{best.liquidity.slippage1k.toFixed(1)}% slippage/$1k
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setBuying(best)}
                className="flex-shrink-0 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 text-sm"
              >
                <ShoppingCart className="w-4 h-4" />
                Buy {ticker}
              </button>
            </div>
          </div>
        )
      })()}

      {/* All instruments */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
          <h2 className="font-semibold text-[#0F172A]">All Routes</h2>
          <span className="text-xs text-[#94A3B8]">{instruments.length} total · {tradeable.length} tradeable</span>
        </div>

        <div className="divide-y divide-[#F1F5F9]">
          {instruments.map(inst => {
            const isBestBuy = inst.id === bestBuyId
            const isBestScore = inst.id === bestScoreId
            const canTrade = inst.liquidity.status === 'tradeable' || inst.liquidity.status === 'low_liquidity'
            const chainColor = CHAIN_COLORS[inst.chain] ?? '#94A3B8'

            return (
              <div
                key={inst.id}
                className={`flex items-center justify-between gap-3 px-5 py-4 ${isBestBuy ? 'bg-[#F0FDF4]' : ''}`}
              >
                {/* Left: issuer + chain + badges */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[#0F172A] text-sm truncate">
                        {inst.issuerName}
                      </span>
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0"
                        style={{ color: chainColor, borderColor: `${chainColor}40`, background: `${chainColor}10` }}
                      >
                        {inst.chain}
                      </span>
                      {isBestBuy && (
                        <span className="text-xs bg-[#DCFCE7] text-[#16A34A] px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                          Best Buy
                        </span>
                      )}
                      {isBestScore && !isBestBuy && (
                        <span className="text-xs bg-[#EFF6FF] text-[#2563EB] px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                          Best Score
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[#94A3B8]">{inst.tokenSymbol}</span>
                      {STATUS_ICON[inst.liquidity.status] && (
                        <span className="flex items-center gap-1 text-xs text-[#D97706]">
                          {STATUS_ICON[inst.liquidity.status]}
                          {STATUS_LABEL[inst.liquidity.status]}
                        </span>
                      )}
                      {inst.liquidity.status === 'no_route' && (
                        <span className="flex items-center gap-1 text-xs text-[#94A3B8]">
                          {STATUS_ICON.no_route}
                          {STATUS_LABEL.no_route}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: price + premium + score + button */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      {inst.price ? (
                        <span className="font-semibold text-sm text-[#0F172A]">
                          ${inst.price.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-sm text-[#94A3B8]">—</span>
                      )}
                      <PremiumBadge pct={inst.premiumPct} />
                    </div>
                    <div className="flex items-center gap-2 justify-end mt-0.5">
                      <ScoreBadge score={inst.score} />
                      {inst.liquidity.routes.length > 0 && (
                        <span className="text-xs text-[#94A3B8]">
                          {inst.liquidity.routes.join('+')}
                        </span>
                      )}
                    </div>
                  </div>

                  {canTrade ? (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => setBuying(inst)}
                        className={`text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors ${
                          inst.liquidity.status === 'low_liquidity'
                            ? 'bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]'
                            : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                        }`}
                      >
                        Buy
                      </button>
                      <button
                        onClick={() => setSelling(inst)}
                        className="text-sm font-semibold px-3.5 py-2 rounded-xl bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] transition-colors"
                      >
                        Sell
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[#CBD5E1] w-20 text-center flex-shrink-0">
                      Unavailable
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Buy modal */}
      {buying && (
        <BuyFlow
          ticker={ticker}
          instrument={buying}
          onClose={() => setBuying(null)}
          action="buy"
        />
      )}

      {/* Sell modal */}
      {selling && (
        <BuyFlow
          ticker={ticker}
          instrument={selling}
          onClose={() => setSelling(null)}
          action="sell"
        />
      )}
    </>
  )
}
