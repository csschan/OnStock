import { fetchAsset } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import AssetInstruments from './AssetInstruments'
import PriceChart from '@/components/PriceChart'
import LivePriceBadge from '@/components/LivePriceBadge'

interface PageProps {
  params: Promise<{ ticker: string }>
  searchParams: Promise<{ buy?: string; chain?: string }>
}

export default async function AssetPage({ params, searchParams }: PageProps) {
  const { ticker } = await params
  const { buy: autoBuyIssuer, chain: autoBuyChain } = await searchParams
  const upper = ticker.toUpperCase()
  const asset = await fetchAsset(upper)

  if (!asset) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-[#64748B] mb-4">Asset &quot;{upper}&quot; not found.</p>
        <a href="/" className="text-[#2563EB] hover:underline text-sm">Back to markets</a>
      </div>
    )
  }

  const best = asset.instruments.find(i => i.id === asset.bestBuy)
  const bestScore = asset.instruments.find(i => i.id === asset.bestScore)

  // Sort instruments: tradeable first, then by score desc
  const sorted = [...asset.instruments].sort((a, b) => {
    const statusOrder = { tradeable: 0, low_liquidity: 1, no_route: 2, unknown: 3 }
    const sa = statusOrder[a.liquidity.status] ?? 3
    const sb = statusOrder[b.liquidity.status] ?? 3
    if (sa !== sb) return sa - sb
    return (b.score ?? 0) - (a.score ?? 0)
  })

  const tradeableCount = asset.instruments.filter(
    i => i.liquidity.status === 'tradeable' || i.liquidity.status === 'low_liquidity'
  ).length

  const bestOnchain = best?.price ?? bestScore?.price ?? null
  const onchainPremium = bestOnchain && asset.marketPrice
    ? ((bestOnchain - asset.marketPrice) / asset.marketPrice) * 100
    : null

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back */}
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0F172A] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to markets
      </a>

      {/* Stock header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#F1F5F9] rounded-2xl flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-base text-[#334155]">{upper}</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0F172A]">
              {upper} · {asset.name}
            </h1>
            <p className="text-sm text-[#94A3B8] mt-0.5">
              {asset.sector} · {asset.type.toUpperCase()} · {tradeableCount} tradeable routes
            </p>
            <div className="mt-1.5">
              <LivePriceBadge ticker={upper} initialPrice={asset.marketPrice} />
            </div>
          </div>
        </div>

        <div className="sm:text-right">
          <div className="flex sm:flex-col gap-4 sm:gap-1">
            <div>
              <p className="text-xs text-[#94A3B8] mb-0.5">Market Price</p>
              <p className="font-bold text-2xl text-[#0F172A] font-price">
                {asset.marketPrice ? `$${formatPrice(asset.marketPrice)}` : '—'}
              </p>
              {asset.change24h != null && (
                <span className={`inline-flex items-center gap-1 text-sm font-medium ${asset.change24h >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                  {asset.change24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                </span>
              )}
            </div>
            {bestOnchain && (
              <div>
                <p className="text-xs text-[#94A3B8] mb-0.5">Best Onchain</p>
                <p className="font-semibold text-lg text-[#0F172A] font-price">
                  ${formatPrice(bestOnchain)}
                </p>
                {onchainPremium != null && (
                  <span className={`text-xs font-medium ${onchainPremium <= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                    {onchainPremium >= 0 ? '+' : ''}{onchainPremium.toFixed(2)}% vs market
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Price chart */}
      {asset.marketPrice && (
        <div className="mb-6">
          <PriceChart ticker={upper} oraclePrice={asset.marketPrice} />
        </div>
      )}

      {/* Instruments table with buy flow */}
      <AssetInstruments
        ticker={upper}
        instruments={sorted}
        bestBuyId={asset.bestBuy}
        bestScoreId={asset.bestScore}
        autoBuyIssuer={autoBuyIssuer}
        autoBuyChain={autoBuyChain}
      />
    </div>
  )
}
