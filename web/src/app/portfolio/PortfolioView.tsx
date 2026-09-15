'use client'

import { useAccount, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { useMemo, useState, useEffect } from 'react'
import { Wallet, TrendingUp, TrendingDown, ArrowUpRight, Vault } from 'lucide-react'
import type { FlatInstrument } from '@/lib/api'
type TrackedInstrument = FlatInstrument
import BuyFlow from '@/components/BuyFlow'
import { usePhantom } from '@/components/PhantomProvider'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

interface VaultPos {
  asset: string
  vaultPda: string
  receiptMint: string
  userShares: number
  depositedAmount: number
  currentValue: number
  nav: number
  pnl: number
  depositedAt: string | null
}

function useVaultPositions(solanaWallet: string | null) {
  const [positions, setPositions] = useState<VaultPos[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!solanaWallet) { setPositions([]); return }
    setLoading(true)
    fetch(`${API_BASE}/earn/vault/positions?wallet=${solanaWallet}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setPositions(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [solanaWallet])

  return { positions, loading }
}

const CHAIN_COLORS: Record<number, string> = {
  1: '#627EEA',
  56: '#F0B90B',
  8453: '#0052FF',
  42161: '#28A0F0',
  4663: '#00C805',
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  56: 'BNB Chain',
  8453: 'Base',
  42161: 'Arbitrum',
  4663: 'Robinhood',
}

interface HoldingRow {
  instrument: TrackedInstrument
  balance: number       // token units
  valueUsd: number      // balance × price
  pnlPct: number | null // vs oracle price
}

export default function PortfolioView({ instruments }: { instruments: TrackedInstrument[] }) {
  const { address, isConnected } = useAccount()
  const [selling, setSelling] = useState<TrackedInstrument | null>(null)
  const [buying, setBuying] = useState<TrackedInstrument | null>(null)
  const { publicKey: solanaPubkey } = usePhantom()
  const solanaWallet = solanaPubkey?.toBase58() ?? null
  const { positions: vaultPositions, loading: vaultLoading } = useVaultPositions(solanaWallet)

  // Build multicall contracts list — balanceOf(address) for every instrument
  const contracts = useMemo(() => {
    if (!address) return []
    return instruments.map(inst => ({
      address: inst.contractAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address] as const,
      chainId: inst.chainId,
    }))
  }, [address, instruments])

  const { data: balances, isLoading } = useReadContracts({
    contracts,
    query: { enabled: !!address },
  })

  // Compute holdings where balance > 0
  const holdings: HoldingRow[] = useMemo(() => {
    if (!balances) return []
    const rows: HoldingRow[] = []
    for (let i = 0; i < instruments.length; i++) {
      const result = balances[i]
      if (result?.status !== 'success' || !result.result) continue
      const rawBalance = result.result as bigint
      if (rawBalance === 0n) continue

      const inst = instruments[i]
      const balance = Number(formatUnits(rawBalance, inst.decimals))
      if (balance < 0.000001) continue

      const price = inst.price ?? inst.marketPrice ?? 0
      const valueUsd = balance * price

      const pnlPct = inst.premiumPct  // positive = we're holding at premium

      rows.push({ instrument: inst, balance, valueUsd, pnlPct })
    }
    // Sort by USD value descending
    return rows.sort((a, b) => b.valueUsd - a.valueUsd)
  }, [balances, instruments])

  // Group by canonical asset
  const grouped = useMemo(() => {
    const map = new Map<string, HoldingRow[]>()
    for (const h of holdings) {
      const key = h.instrument.assetTicker
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    }
    return map
  }, [holdings])

  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0)

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-[#F1F5F9] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-8 h-8 text-[#94A3B8]" />
        </div>
        <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Portfolio</h1>
        <p className="text-[#64748B] mb-6">Connect your wallet to see your tokenized stock holdings.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Portfolio</h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            {address?.slice(0, 6)}…{address?.slice(-4)} · {holdings.length} positions
          </p>
        </div>
        {totalValueUsd > 0 && (
          <div className="text-right">
            <p className="text-xs text-[#94A3B8] mb-0.5">Total Value</p>
            <p className="text-2xl font-bold text-[#0F172A] font-price">
              ${totalValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-[#94A3B8]">
          <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Reading balances across chains…</span>
        </div>
      )}

      {/* No holdings */}
      {!isLoading && holdings.length === 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl py-20 text-center">
          <div className="w-14 h-14 bg-[#F1F5F9] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-7 h-7 text-[#CBD5E1]" />
          </div>
          <p className="font-medium text-[#0F172A] mb-1">No tokenized stock holdings found</p>
          <p className="text-sm text-[#94A3B8] mb-6">Buy your first position to see it here.</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 bg-[#2563EB] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#1D4ED8] transition-colors"
          >
            Browse Markets
          </a>
        </div>
      )}

      {/* Holdings grouped by asset */}
      {!isLoading && holdings.length > 0 && (
        <div className="space-y-4">
          {[...grouped.entries()].map(([assetTicker, rows]) => {
            const totalAssetValue = rows.reduce((s, r) => s + r.valueUsd, 0)
            const assetName = rows[0].instrument.assetName
            const marketPrice = rows[0].instrument.marketPrice

            return (
              <div key={assetTicker} className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
                {/* Asset header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F5F9]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EFF6FF] rounded-xl flex items-center justify-center">
                      <span className="font-bold text-sm text-[#2563EB]">{assetTicker}</span>
                    </div>
                    <div>
                      <a href={`/asset/${assetTicker}`} className="font-semibold text-[#0F172A] hover:text-[#2563EB] flex items-center gap-1 text-sm">
                        {assetName} <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                      {marketPrice && (
                        <p className="text-xs text-[#94A3B8]">Market ${marketPrice.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[#0F172A]">
                      ${totalAssetValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-[#94A3B8]">{rows.length} position{rows.length > 1 ? 's' : ''}</p>
                  </div>
                </div>

                {/* Individual instrument rows */}
                {rows.map((h) => {
                  const inst = h.instrument
                  const chainColor = CHAIN_COLORS[inst.chainId] ?? '#94A3B8'
                  const canTrade = inst.liquidity.status === 'tradeable' || inst.liquidity.status === 'low_liquidity'

                  return (
                    <div key={inst.id} className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-[#F8FAFC]">
                      {/* Left: chain + issuer */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-2 h-8 rounded-full flex-shrink-0"
                          style={{ background: chainColor }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-[#0F172A]">{inst.issuerName}</span>
                            <span className="text-xs text-[#94A3B8]">{CHAIN_NAMES[inst.chainId] ?? inst.chain}</span>
                          </div>
                          <p className="text-xs text-[#94A3B8]">
                            {h.balance.toFixed(4)} {inst.tokenSymbol}
                          </p>
                        </div>
                      </div>

                      {/* Right: value + pnl + actions */}
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[#0F172A]">
                            ${h.valueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          {h.pnlPct != null && (
                            <span className={`text-xs font-medium flex items-center gap-0.5 justify-end ${h.pnlPct >= 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                              {h.pnlPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {h.pnlPct >= 0 ? '+' : ''}{h.pnlPct.toFixed(2)}% vs market
                            </span>
                          )}
                        </div>

                        {canTrade && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setBuying(inst)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
                            >
                              Buy
                            </button>
                            <button
                              onClick={() => setSelling(inst)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] transition-colors"
                            >
                              Sell
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Vault Positions (Solana) */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Vault className="w-4 h-4 text-[#14F195]" />
          <h2 className="text-base font-semibold text-[#0F172A]">Vault Positions</h2>
          <span className="text-xs text-[#94A3B8]">OnStock · Solana</span>
        </div>

        {!solanaWallet ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">Connect your Solana wallet to view vault positions.</p>
          </div>
        ) : vaultLoading ? (
          <div className="flex items-center gap-2 py-6 text-[#94A3B8]">
            <div className="w-4 h-4 border-2 border-[#14F195] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Reading vault positions…</span>
          </div>
        ) : vaultPositions.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">No vault positions found for this wallet.</p>
            <a
              href="/portfolio-builder"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#14F195] hover:underline"
            >
              Build a portfolio <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {vaultPositions.map(pos => (
              <div key={pos.asset} className="bg-white border border-[#E2E8F0] rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F0FDF4] rounded-xl flex items-center justify-center">
                    <span className="font-bold text-sm text-[#16A34A]">{pos.asset.replace('x', '')}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">{pos.asset}</p>
                    <p className="text-xs text-[#94A3B8]">
                      {pos.userShares.toFixed(6)} shares · NAV {pos.nav.toFixed(4)}
                      {pos.depositedAt && (
                        <> · deposited {new Date(pos.depositedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#0F172A]">
                      {pos.currentValue.toFixed(4)} <span className="text-xs font-normal text-[#94A3B8]">{pos.asset.replace('x', '')}</span>
                    </p>
                    <span className={`text-xs font-medium flex items-center gap-0.5 justify-end ${pos.pnl >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      {pos.pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(4)} PnL
                    </span>
                  </div>

                  <a
                    href={`/earn?asset=${pos.asset}`}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F0FDF4] text-[#16A34A] hover:bg-[#DCFCE7] transition-colors whitespace-nowrap"
                  >
                    Redeem
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {buying && (
        <BuyFlow ticker={buying.assetTicker} instrument={buying} onClose={() => setBuying(null)} action="buy" />
      )}
      {selling && (
        <BuyFlow ticker={selling.assetTicker} instrument={selling} onClose={() => setSelling(null)} action="sell" />
      )}
    </div>
  )
}
