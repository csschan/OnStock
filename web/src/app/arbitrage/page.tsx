import ArbitrageList from "@/components/ArbitrageList";
import { Zap, Info } from "lucide-react";

export default function ArbitragePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-6 h-6 text-[#D97706]" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Cross-Chain Arbitrage
          </h1>
        </div>
        <p className="text-[#64748B] max-w-2xl">
          Real-time price spreads on tokenized stocks across chains. Execute both
          legs directly from your wallet — no intermediary, no KYC for on-chain swaps.
        </p>
      </div>

      {/* Route type explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-[#16A34A] bg-[#DCFCE7] px-1.5 py-0.5 rounded-full">Type A</span>
            <span className="text-sm font-semibold">Same Chain</span>
          </div>
          <p className="text-xs text-[#64748B]">
            Two DEX swaps on the same chain. Fastest — no bridge needed. Any issuers.
          </p>
        </div>
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-[#2563EB] bg-[#DBEAFE] px-1.5 py-0.5 rounded-full">Type B</span>
            <span className="text-sm font-semibold">Same Issuer · Bridge</span>
          </div>
          <p className="text-xs text-[#64748B]">
            Buy on chain A, bridge via issuer&apos;s native bridge (same token), sell on chain B.
          </p>
        </div>
        <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-[#D97706] bg-[#FEF9C3] px-1.5 py-0.5 rounded-full">Type C</span>
            <span className="text-sm font-semibold">Cross-Issuer · 2 DEX</span>
          </div>
          <p className="text-xs text-[#64748B]">
            Two independent DEX swaps on different issuers. No bridge. No KYC.
            Prices converge through market pressure.
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 mb-8 text-xs text-[#64748B]">
        <Info className="w-4 h-4 text-[#94A3B8] flex-shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold text-[#0F172A]">Net spread</span> estimates
          subtract slippage and bridge/gas fees based on pool depth. A positive net spread
          does not guarantee profit — prices can move before your transaction confirms.
          Always verify on-chain before executing large positions.
        </p>
      </div>

      {/* Arbitrage list */}
      <ArbitrageList />
    </div>
  );
}
