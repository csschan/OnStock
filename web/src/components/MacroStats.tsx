"use client";

import { useEffect, useState } from "react";
import { fetchAllAssets, fetchArbitrage } from "@/lib/api";
import { TrendingUp, BarChart3, Layers, Zap } from "lucide-react";

interface Stats {
  totalAssets: number;
  tradeableRoutes: number;
  avgPremiumPct: number | null;
  arbCount: number;
  bestArbSpread: number | null;
  bestArbTicker: string | null;
}

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent ?? "bg-[#F1F5F9]"}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-[#94A3B8] uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-price text-2xl font-bold text-[#0F172A]">{value}</p>
      {sub && <p className="text-xs text-[#64748B] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MacroStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    Promise.all([fetchAllAssets(), fetchArbitrage()]).then(([assets, arbs]) => {
      const tradeableRoutes = assets.reduce((s, a) => s + a.tradeableCount, 0);

      // avg premium across all assets that have a bestBuy with a price
      const premiums = assets
        .map(a => a.bestBuy?.premiumPct)
        .filter((p): p is number => p != null);
      const avgPremiumPct = premiums.length > 0
        ? premiums.reduce((a, b) => a + b, 0) / premiums.length
        : null;

      const bestArb = arbs.length > 0
        ? arbs.reduce((best, a) => a.spreadPct > best.spreadPct ? a : best)
        : null;

      setStats({
        totalAssets: assets.length,
        tradeableRoutes,
        avgPremiumPct,
        arbCount: arbs.length,
        bestArbSpread: bestArb?.spreadPct ?? null,
        bestArbTicker: bestArb?.ticker ?? null,
      });
    });
  }, []);

  if (!stats) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 animate-pulse">
          <div className="h-8 w-8 bg-[#F1F5F9] rounded-lg mb-2" />
          <div className="h-7 w-16 bg-[#F1F5F9] rounded mb-1" />
          <div className="h-3 w-24 bg-[#F1F5F9] rounded" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={<Layers className="w-4 h-4 text-[#2563EB]" />}
        accent="bg-[#EFF6FF]"
        label="Tracked Assets"
        value={String(stats.totalAssets)}
        sub={`${stats.tradeableRoutes} tradeable routes`}
      />
      <StatCard
        icon={<TrendingUp className="w-4 h-4 text-[#16A34A]" />}
        accent="bg-[#F0FDF4]"
        label="Avg Premium"
        value={
          stats.avgPremiumPct != null
            ? `${stats.avgPremiumPct >= 0 ? "+" : ""}${stats.avgPremiumPct.toFixed(2)}%`
            : "—"
        }
        sub="DEX vs oracle price"
      />
      <StatCard
        icon={<Zap className="w-4 h-4 text-[#D97706]" />}
        accent="bg-[#FEF3C7]"
        label="Arbitrage Opps"
        value={String(stats.arbCount)}
        sub="Active opportunities"
      />
      <StatCard
        icon={<BarChart3 className="w-4 h-4 text-[#7C3AED]" />}
        accent="bg-[#F5F3FF]"
        label="Best Spread"
        value={stats.bestArbSpread != null ? `+${stats.bestArbSpread.toFixed(2)}%` : "—"}
        sub={stats.bestArbTicker ? `${stats.bestArbTicker} cross-chain` : undefined}
      />
    </div>
  );
}
