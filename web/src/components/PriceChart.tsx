"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchPricePoints, type PricePoint } from "@/lib/api";

interface Props {
  ticker: string;
  oraclePrice: number;
}

function chainColor(chain: string, issuer: string): string {
  if (issuer === "robinhood") return "#10B981";
  const map: Record<string, string> = {
    ethereum: "#627EEA",
    bnb: "#F3BA2F",
    base: "#0052FF",
    arbitrum: "#28A0F0",
    solana: "#9945FF",
  };
  return map[chain] ?? "#94A3B8";
}

export default function PriceChart({ ticker, oraclePrice }: Props) {
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchPricePoints(ticker, 24).then(data => {
      setPoints(data);
      setLoading(false);
    });
  }, [ticker]);

  // Group by chain+issuer for multiple lines
  const series = useMemo(() => {
    const groups = new Map<string, PricePoint[]>();
    for (const p of points) {
      const key = `${p.chain}:${p.issuer}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return [...groups.entries()].map(([key, pts]) => {
      const [chain, issuer] = key.split(":");
      return { key, chain, issuer, pts: pts.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)) };
    });
  }, [points]);

  if (loading) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
        <div className="h-[180px] flex items-center justify-center text-[#94A3B8] text-sm">
          Loading chart...
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
        <p className="text-xs text-[#94A3B8] font-medium mb-3">24h Price History</p>
        <div className="h-[140px] flex items-center justify-center text-[#CBD5E1] text-sm">
          No history data yet
        </div>
      </div>
    );
  }

  // Chart dimensions
  const W = 500;
  const H = 140;
  const PAD = { top: 10, right: 16, bottom: 28, left: 52 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Price range (all series + oracle)
  const allPrices = points.map(p => p.dexPrice).concat(oraclePrice);
  const minPrice = Math.min(...allPrices) * 0.999;
  const maxPrice = Math.max(...allPrices) * 1.001;
  const priceRange = maxPrice - minPrice;

  // Time range
  const times = points.map(p => new Date(p.capturedAt).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;

  function toX(t: string) {
    return ((new Date(t).getTime() - minTime) / timeRange) * chartW + PAD.left;
  }
  function toY(price: number) {
    return PAD.top + chartH - ((price - minPrice) / priceRange) * chartH;
  }

  function seriesPath(pts: PricePoint[]) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.capturedAt).toFixed(1)},${toY(p.dexPrice).toFixed(1)}`).join(" ");
  }

  // Oracle reference line (horizontal)
  const oracleY = toY(oraclePrice).toFixed(1);

  // Time labels — generate evenly spaced ticks across the time range
  const crossDay = new Date(minTime).getUTCDate() !== new Date(maxTime).getUTCDate();
  function fmtTime(d: Date) {
    const hm = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (crossDay) {
      const md = d.toLocaleDateString("en", { month: "short", day: "numeric" });
      return `${md} ${hm}`;
    }
    return hm;
  }
  // Generate 5 evenly spaced tick positions
  const TICK_COUNT = 5;
  const timeTicks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const t = minTime + (timeRange * i) / (TICK_COUNT - 1);
    return { time: new Date(t), x: PAD.left + (chartW * i) / (TICK_COUNT - 1) };
  });

  // Hovered point
  const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#64748B] font-medium">24h Price History</p>
        <div className="flex flex-wrap gap-2">
          {series.map(s => (
            <div key={s.key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: chainColor(s.chain, s.issuer) }} />
              <span className="text-xs text-[#64748B]">{s.issuer}/{s.chain.slice(0, 3).toUpperCase()}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#94A3B8]" style={{ border: "1px dashed #94A3B8", background: "transparent" }} />
            <span className="text-xs text-[#94A3B8]">Market</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 160 }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = PAD.top + f * chartH;
            const price = maxPrice - f * priceRange;
            return (
              <g key={f}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#F1F5F9" strokeWidth="1" />
                <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#94A3B8">
                  {price.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Oracle reference line */}
          <line
            x1={PAD.left} y1={oracleY} x2={W - PAD.right} y2={oracleY}
            stroke="#94A3B8" strokeWidth="1" strokeDasharray="4 3"
          />

          {/* Series lines */}
          {series.map(s => (
            <path
              key={s.key}
              d={seriesPath(s.pts)}
              fill="none"
              stroke={chainColor(s.chain, s.issuer)}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Invisible hit area for hover */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={toX(p.capturedAt)}
              cy={toY(p.dexPrice)}
              r={6}
              fill="transparent"
              onMouseEnter={() => setHoveredIdx(i)}
            />
          ))}

          {/* Hovered dot */}
          {hovered && (
            <circle
              cx={toX(hovered.capturedAt)}
              cy={toY(hovered.dexPrice)}
              r={3}
              fill={chainColor(hovered.chain, hovered.issuer)}
              stroke="white"
              strokeWidth="1.5"
            />
          )}

          {/* X-axis labels */}
          {timeTicks.map((tick, i) => (
            <text
              key={i}
              x={tick.x}
              y={H - 4}
              textAnchor={i === 0 ? "start" : i === TICK_COUNT - 1 ? "end" : "middle"}
              fontSize="9"
              fill="#94A3B8"
            >
              {fmtTime(tick.time)}
            </text>
          ))}
        </svg>

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute top-0 right-0 bg-white border border-[#E2E8F0] rounded-lg shadow-sm px-2.5 py-1.5 text-xs pointer-events-none">
            <p className="font-price font-semibold">${hovered.dexPrice.toFixed(2)}</p>
            <p className="text-[#64748B]">{hovered.issuer} · {hovered.chain}</p>
            {hovered.premiumPct != null && (
              <p className={hovered.premiumPct <= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}>
                {hovered.premiumPct >= 0 ? "+" : ""}{hovered.premiumPct.toFixed(2)}%
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
