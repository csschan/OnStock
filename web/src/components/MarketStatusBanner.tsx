"use client";

import { useEffect, useState } from "react";
import { Clock, TrendingDown, TrendingUp } from "lucide-react";
import { fetchMarketStatus, type MarketStatusData, type MarketDeviation } from "@/lib/api";
import { CHAIN_ID, USDC_BY_CHAIN } from "@/lib/chains";
import SwapModal from "./SwapModal";
import type { Quote } from "@/lib/mock-data";

function deviationToQuote(d: MarketDeviation): Quote {
  const chainId = CHAIN_ID[d.dexChain];
  return {
    provider: d.dexIssuer.charAt(0).toUpperCase() + d.dexIssuer.slice(1),
    type: "issuer",
    tokenName: d.ticker,
    chain: chainLabel(d.dexChain),
    price: d.bestDexPrice,
    premiumPercent: d.deviationPct,
    protocolFee: 0,
    estimatedGas: d.dexChain === "ethereum" ? 0.5 : d.dexChain === "solana" ? 0.001 : 0.05,
    canTradeInPlatform: true,
    tradeUrl: "",
    requiresKYC: false,
    hasDividends: true,
    tokenAddress: d.contractAddress ?? undefined,
    chainId: chainId ?? undefined,
    liquidityUsd: d.liquidityUsd,
  };
}

function chainLabel(chain: string): string {
  const map: Record<string, string> = {
    ethereum: "Ethereum",
    bnb: "BNB Chain",
    solana: "Solana",
    base: "Base",
    arbitrum: "Arbitrum",
    "robinhood-chain": "Robinhood Chain",
  };
  return map[chain] ?? chain;
}

const STATUS_CONFIG = {
  open:         { dot: "bg-green-500", label: "text-green-700", pulse: true },
  "pre-market": { dot: "bg-blue-400",  label: "text-blue-700",  pulse: false },
  "after-hours":{ dot: "bg-amber-400", label: "text-amber-700", pulse: false },
  overnight:    { dot: "bg-slate-400", label: "text-slate-600", pulse: false },
  weekend:      { dot: "bg-purple-500",label: "text-purple-700",pulse: false },
};

export default function MarketStatusBanner() {
  const [data, setData] = useState<MarketStatusData | null>(null);
  const [modal, setModal] = useState<{ d: MarketDeviation; action: "buy" | "sell" } | null>(null);

  useEffect(() => {
    fetchMarketStatus()
      .then(d => { console.log('[MarketStatus] data:', d); setData(d); })
      .catch(e => console.error('[MarketStatus] fetch error:', e));
  }, []);

  if (!data) return (
    <div className="flex items-center gap-2 mb-6 px-1">
      <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
      <span className="text-sm text-[#94A3B8]">Loading market status...</span>
    </div>
  );

  const { market, oracleFreezeHours, deviations } = data;
  const cfg = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.overnight;
  const oracleStale = oracleFreezeHours != null && oracleFreezeHours > 1;

  // 市场开盘：只显示简单状态条
  if (market.isOpen) {
    return (
      <div className="flex items-center gap-2 mb-6 px-1">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} animate-pulse`} />
        <span className="text-sm text-[#16A34A] font-medium">Market Open</span>
        <span className="text-xs text-[#94A3B8]">· Stock prices updating live</span>
        {oracleStale && (
          <span className="text-xs text-[#D97706] bg-[#FEF3C7] px-2 py-0.5 rounded ml-2">
            Oracle {oracleFreezeHours.toFixed(0)}h stale
          </span>
        )}
      </div>
    );
  }

  // 有偏离机会的代币
  const discounts = deviations.filter(d => d.opportunity === "discount");
  const premiums  = deviations.filter(d => d.opportunity === "premium");

  return (
    <>
    <div className="mb-8">
      {/* 状态栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className={`text-sm font-semibold ${cfg.label}`}>{market.label}</span>
          <span className="text-xs text-[#94A3B8]">· {market.description.split(".")[0]}</span>
        </div>
        <div className="flex items-center gap-3">
          {oracleStale && (
            <span className="text-xs text-[#D97706] bg-[#FEF3C7] px-2 py-0.5 rounded font-medium">
              Oracle prices {oracleFreezeHours!.toFixed(0)}h old — DEX prices may diverge
            </span>
          )}
          {market.hoursUntilOpen !== null && (
            <div className="flex items-center gap-1 text-xs text-[#94A3B8]">
              <Clock className="w-3 h-3" />
              Opens in {market.hoursUntilOpen}h
            </div>
          )}
        </div>
      </div>

      {/* 无机会时 */}
      {discounts.length === 0 && premiums.length === 0 && (
        <p className="text-sm text-[#94A3B8]">No abnormal price deviations vs 7-day baseline.</p>
      )}

      {/* 机会标题 */}
      {(discounts.length > 0 || premiums.length > 0) && (
        <div className="flex items-center gap-3 mb-3">
          {discounts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-[#16A34A]" />
              <span className="text-sm font-semibold text-[#16A34A]">{discounts.length} trading below market</span>
            </div>
          )}
          {premiums.length > 0 && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#DC2626]" />
              <span className="text-sm font-semibold text-[#DC2626]">{premiums.length} trading above market</span>
            </div>
          )}
          <span className="text-xs text-[#94A3B8]">· Abnormal = exceeds 7-day baseline · Structural = persistent gap</span>
        </div>
      )}

      {/* 机会表格 */}
      {(discounts.length > 0 || premiums.length > 0) && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-[#94A3B8] uppercase tracking-wider border-b border-[#F1F5F9]">
                <th className="text-left px-4 py-2.5 font-medium">Token</th>
                <th className="text-right px-4 py-2.5 font-medium">Market Price</th>
                <th className="text-right px-4 py-2.5 font-medium">DEX Now</th>
                <th className="text-right px-4 py-2.5 font-medium">Deviation</th>
                <th className="text-right px-4 py-2.5 font-medium">7d Avg</th>
                <th className="text-right px-4 py-2.5 font-medium">Signal</th>
                <th className="text-right px-4 py-2.5 font-medium">Where</th>
                <th className="text-right px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {[...discounts, ...premiums].map(d => {
                const isDiscount = d.opportunity === "discount"
                const action = isDiscount ? "buy" : "sell"
                const hasHistory = (d.historySamples ?? 0) >= 3

                return (
                  <tr key={`${d.ticker}-${d.dexChain}-${d.dexIssuer}`} className="border-t border-[#F8FAFC] hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3">
                      <div>
                        <a href={`/asset/${d.ticker}`} className="font-semibold text-sm hover:text-[#2563EB]">
                          {d.ticker}
                        </a>
                        {!hasHistory && (
                          <span className="ml-1.5 text-[10px] text-[#94A3B8] bg-[#F1F5F9] px-1.5 py-0.5 rounded">
                            new
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-[#64748B]">
                      ${(d.lastOraclePrice ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">
                      ${(d.bestDexPrice ?? 0).toFixed(2)}
                    </td>
                    {/* 当前偏离 */}
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-medium ${isDiscount ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                        {(d.deviationPct ?? 0) >= 0 ? "+" : ""}{(d.deviationPct ?? 0).toFixed(2)}%
                      </span>
                    </td>
                    {/* 7天历史均值 */}
                    <td className="px-4 py-3 text-right">
                      {d.historicalAvgPct != null ? (
                        <span className="text-xs text-[#64748B]">
                          {d.historicalAvgPct >= 0 ? "+" : ""}{d.historicalAvgPct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-xs text-[#CBD5E1]">—</span>
                      )}
                    </td>
                    {/* 信号列：异常 or 结构性 */}
                    <td className="px-4 py-3 text-right">
                      {d.isAbnormal ? (
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                          isDiscount ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          Abnormal
                        </span>
                      ) : d.historySamples >= 3 ? (
                        <span className="text-xs text-[#94A3B8] px-1.5 py-0.5 rounded bg-[#F1F5F9]">
                          Structural
                        </span>
                      ) : (
                        <span className="text-xs text-[#CBD5E1]">New</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[#64748B]">
                      {d.dexIssuer} · {chainLabel(d.dexChain)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModal({ d, action })}
                        className={`text-xs font-medium text-white px-3 py-1.5 rounded-lg transition-colors ${
                          isDiscount
                            ? "bg-[#16A34A] hover:bg-[#15803D]"
                            : "bg-[#DC2626] hover:bg-[#B91C1C]"
                        }`}
                      >
                        {isDiscount ? "Buy" : "Sell"}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-[#F1F5F9] bg-[#F8FAFC]">
            <p className="text-xs text-[#94A3B8]">
              Signal = current deviation minus 7-day historical average. Only abnormal deviations shown.
            </p>
          </div>
        </div>
      )}
    </div>

      {modal && (
        <SwapModal
          isOpen={true}
          onClose={() => setModal(null)}
          action={modal.action}
          ticker={modal.d.ticker}
          quote={deviationToQuote(modal.d)}
          amount={0}
          basePrice={modal.d.lastOraclePrice}
        />
      )}
    </>
  );
}
