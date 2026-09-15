"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Zap, X, ChevronRight, AlertTriangle } from "lucide-react";
import { fetchArbitrage, type RawArbitrage } from "@/lib/api";
import { CHAIN_ID, KYBER_SUPPORTED_CHAINS, USDC_BY_CHAIN } from "@/lib/chains";
import { MOCK_ARBITRAGE_OPPORTUNITIES } from "@/lib/mock-data";
import DirectSwapWidget from "./DirectSwapWidget";
import OFTBridgeWidget from "./OFTBridgeWidget";

// 系统自动选最优 DEX：
// - EVM (ETH/BNB/Base/ARB): KyberSwap 聚合器，内部路由 Uniswap/PancakeSwap 等
// - Robinhood Chain: Uniswap v4（Robinhood 官方 DEX，价格数据也来自这里）
// - Solana: Jupiter（聚合器）
function bestDexUrl(chain: string, contractAddress: string | null | undefined, usdc: string | null, action: "buy" | "sell"): string | null {
  if (!contractAddress) return null;

  if (chain === "solana") return null; // Jupiter handled separately

  // Robinhood Chain → Uniswap v4
  if (chain === "robinhood-chain") {
    // Uniswap v4 on Robinhood Chain; input/output without specifying quote token
    // lets user see the pool and select their preferred quote asset
    if (action === "buy") {
      return `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${contractAddress}`;
    } else {
      return `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${contractAddress}`;
    }
  }

  // EVM chains → KyberSwap aggregator
  if (!usdc) return null;
  const tokenIn = action === "buy" ? usdc : contractAddress;
  const tokenOut = action === "buy" ? contractAddress : usdc;

  const kyberChain: Record<string, string> = {
    ethereum: "ethereum", bnb: "bnb", base: "base", arbitrum: "arbitrum",
  };
  const slug = kyberChain[chain];
  if (!slug) return null;
  return `https://kyberswap.com/swap/${slug}?inputCurrency=${tokenIn}&outputCurrency=${tokenOut}`;
}

// ─── Net Spread Helpers ───────────────────────────────────────────────────────

function estimateSlippage(liquidityUsd: number | null): number {
  if (!liquidityUsd) return 0.20; // unknown → assume 0.20%
  if (liquidityUsd > 2_000_000) return 0.03;
  if (liquidityUsd > 500_000) return 0.08;
  if (liquidityUsd > 100_000) return 0.18;
  return 0.40;
}

function estimateNetSpreadPct(item: RawArbitrage): number {
  // cost model: bridge fee + slippage on both legs + gas
  const isCrossIssuer = item.buyIssuer !== item.sellIssuer;
  const bridgeFee = isCrossIssuer ? 0 : 0.10; // %, no bridge for cross-issuer
  const dexFee = isCrossIssuer ? 0.60 : 0; // 2 × 0.30% DEX fee for cross-issuer
  const sourceSlippage = estimateSlippage(item.buyLiquidityUsd);
  const destSlippage = estimateSlippage(item.sellLiquidityUsd);
  const gas = 0.05;
  const totalCost = bridgeFee + dexFee + sourceSlippage + destSlippage + gas;
  return item.spreadPct - totalCost; // in %
}

// Liquidity risk level
function liquidityRisk(item: RawArbitrage): "safe" | "caution" | "risky" {
  const buyLiq = item.buyLiquidityUsd;
  const sellLiq = item.sellLiquidityUsd;
  if ((buyLiq != null && buyLiq < 50_000) || (sellLiq != null && sellLiq < 50_000)) return "risky";
  if (buyLiq == null || sellLiq == null) return "caution";
  if (buyLiq < 200_000 || sellLiq < 200_000) return "caution";
  return "safe";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function chainLabel(chain: string) {
  const map: Record<string, string> = {
    ethereum: "Ethereum", bnb: "BNB Chain", solana: "Solana",
    base: "Base", arbitrum: "Arbitrum", "robinhood-chain": "Robinhood Chain",
  };
  return map[chain] ?? chain;
}

function chainShort(chain: string) {
  const map: Record<string, string> = {
    ethereum: "ETH", bnb: "BNB", solana: "SOL",
    base: "Base", arbitrum: "ARB", "robinhood-chain": "RH",
  };
  return map[chain] ?? chain.toUpperCase().slice(0, 3);
}

function fmtLiquidity(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function liquidityColor(v: number | null | undefined) {
  if (v == null) return "text-[#94A3B8]";
  if (v >= 500_000) return "text-[#16A34A]";
  if (v >= 100_000) return "text-[#D97706]";
  return "text-[#DC2626]";
}

function issuerBridgeInfo(issuer: string) {
  if (issuer === "ondo") return { label: "Ondo · LayerZero OFT" };
  if (issuer === "backed") return { label: "Backed · Chainlink CCIP" };
  return { label: "Native Bridge" };
}

// ─── Execute Modal ────────────────────────────────────────────────────────────

function DexPanel({
  label, price, issuer, chain, chainId, contractAddress, liquidityUsd, ticker, action, nextLabel, onNext,
}: {
  label: string; price: number; issuer: string; chain: string; chainId: number | undefined;
  contractAddress: string | null | undefined; liquidityUsd: number | null | undefined;
  ticker: string; action: "buy" | "sell"; nextLabel?: string; onNext?: () => void;
}) {
  const usdc = chainId ? USDC_BY_CHAIN[chainId] : null;
  const isRobinhoodChain = chainId === 4663;
  const canSwapInApp = contractAddress != null && (
    isRobinhoodChain ||
    (chainId != null && KYBER_SUPPORTED_CHAINS.has(chainId) && usdc != null)
  );
  const bgClass = action === "buy" ? "bg-[#EFF6FF] border-[#BFDBFE]" : "bg-[#F0FDF4] border-[#BBF7D0]";
  const priceClass = action === "buy" ? "text-[#1E40AF]" : "text-[#15803D]";
  const labelClass = action === "buy" ? "text-[#3B82F6]" : "text-[#16A34A]";

  // 系统自动选最优路由 URL
  const smartUrl = chain === "solana"
    ? (action === "buy" ? `https://jup.ag/swap/USDC-${ticker}` : `https://jup.ag/swap/${ticker}-USDC`)
    : bestDexUrl(chain, contractAddress, usdc, action);
  const routerName = chain === "solana" ? "Jupiter" : chain === "robinhood-chain" ? "Uniswap" : "KyberSwap";

  return (
    <div className="p-5">
      <div className={`border rounded-xl px-4 py-3 mb-4 flex items-center justify-between ${bgClass}`}>
        <div>
          <p className={`text-xs font-medium mb-0.5 ${labelClass}`}>{label}</p>
          <p className={`font-price text-xl font-bold ${priceClass}`}>${price.toFixed(2)}</p>
          <p className="text-xs text-[#64748B] mt-0.5">{ticker} ({issuer}) · {chainLabel(chain)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#64748B] mb-0.5">Pool depth</p>
          <p className={`text-sm font-semibold ${liquidityColor(liquidityUsd)}`}>{fmtLiquidity(liquidityUsd)}</p>
        </div>
      </div>

      {contractAddress && (
        <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 mb-4">
          <span className="text-xs text-[#64748B] flex-shrink-0">Token:</span>
          <code className="text-xs text-[#0F172A] font-mono truncate flex-1">{contractAddress}</code>
          <button onClick={() => navigator.clipboard.writeText(contractAddress)}
            className="text-xs text-[#2563EB] hover:underline flex-shrink-0">Copy</button>
        </div>
      )}

      {canSwapInApp && usdc ? (
        <DirectSwapWidget
          tokenIn={action === 'buy' ? usdc : contractAddress!}
          tokenOut={action === 'buy' ? contractAddress! : usdc}
          tokenInSymbol={action === 'buy' ? 'USDC' : ticker}
          tokenOutSymbol={action === 'buy' ? ticker : 'USDC'}
          tokenInDecimals={action === 'buy' ? (chainId === 56 ? 18 : 6) : 18}
          tokenOutDecimals={action === 'buy' ? 18 : (chainId === 56 ? 18 : 6)}
          chainId={chainId!}
          action={action}
        />
      ) : (
        <p className="text-xs text-[#94A3B8] text-center py-4">In-app swap not available for {chainLabel(chain)}</p>
      )}

      {nextLabel && onNext && (
        <button onClick={onNext}
          className="w-full mt-4 flex items-center justify-center gap-2 text-sm text-[#64748B] hover:text-[#2563EB] transition-colors">
          {nextLabel} <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ExecuteModal({ item, onClose }: { item: RawArbitrage; onClose: () => void }) {
  const isSameChain = item.buyChain === item.sellChain;
  const isSameIssuer = item.buyIssuer === item.sellIssuer;

  // Route classification:
  // Type A: same issuer, same chain → 2 DEX swaps
  // Type B: same issuer, cross-chain → DEX buy + bridge + DEX sell
  // Type C: cross issuer → 2 independent DEX swaps (no bridge)
  const routeType: "A" | "B" | "C" = !isSameIssuer ? "C" : isSameChain ? "A" : "B";

  // For Type B only: need 3 tabs (buy, bridge, sell); Type A/C: 2 tabs
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const buyChainId = CHAIN_ID[item.buyChain];
  const sellChainId = CHAIN_ID[item.sellChain];
  const bridge = issuerBridgeInfo(item.buyIssuer);
  const netPct = estimateNetSpreadPct(item);
  const netDollarPer1k = (netPct / 100) * 1000;
  const estProfit = `${netPct >= 0 ? "+" : ""}${netPct.toFixed(2)}% net · ~$${netDollarPer1k.toFixed(1)} per $1,000`;

  // Tab labels
  const tabs =
    routeType === "B"
      ? [`① Buy · ${chainShort(item.buyChain)}`, `② Bridge · ${item.buyIssuer}`, `③ Sell · ${chainShort(item.sellChain)}`]
      : [`① Buy · ${item.buyIssuer}/${chainShort(item.buyChain)}`, `② Sell · ${item.sellIssuer}/${chainShort(item.sellChain)}`];

  const routeBadge =
    routeType === "A"
      ? { label: "Same Chain · DEX", cls: "bg-[#F0FDF4] text-[#16A34A]" }
      : routeType === "B"
        ? { label: "Same Issuer · Bridge", cls: "bg-[#EFF6FF] text-[#2563EB]" }
        : { label: "Cross Issuer · 2×DEX", cls: "bg-[#FEF3C7] text-[#D97706]" };

  // Map tab index to step (Type A/C have 2 tabs, Type B has 3)
  const isTypeB = routeType === "B";

  function setTab(idx: number) {
    if (isTypeB) { setStep((idx + 1) as 1 | 2 | 3); }
    else { setStep(idx === 0 ? 1 : 3); }
  }

  const showBuy = step === 1;
  const showBridge = isTypeB && step === 2;
  const showSell = isTypeB ? step === 3 : step === 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-lg">{item.ticker} Arbitrage</h3>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${routeBadge.cls}`}>
                {routeBadge.label}
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">
              {item.buyIssuer}/{chainShort(item.buyChain)} → {item.sellIssuer}/{chainShort(item.sellChain)} · {estProfit}
            </p>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] ml-4 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type info banner */}
        {routeType === "A" && (
          <div className="px-5 pt-4 pb-0">
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-4 py-3 text-xs text-[#15803D]">
              <span className="font-semibold">Same chain, same issuer.</span>{" "}
              Buy the cheaper pool and sell into the more expensive pool — both swaps settle on-chain in ~1 min.
            </div>
          </div>
        )}
        {routeType === "C" && (
          <div className="px-5 pt-4 pb-0">
            <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 text-xs text-[#92400E]">
              <span className="font-semibold">Cross-issuer arbitrage.</span>{" "}
              Buy the cheaper issuer&apos;s token on one DEX, sell the more expensive issuer&apos;s token on another.
              Both are independent swaps — no bridge needed, but you need to hold both tokens.
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[#E2E8F0] mt-3">
          {tabs.map((label, idx) => (
            <button key={idx} onClick={() => setTab(idx)}
              className={`flex-1 py-3 text-xs font-medium transition-colors ${
                (isTypeB ? step - 1 : step === 1 ? 0 : 1) === idx
                  ? "text-[#2563EB] border-b-2 border-[#2563EB]"
                  : "text-[#94A3B8] hover:text-[#64748B]"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[65vh]">
          {/* Buy leg */}
          {showBuy && (
            <DexPanel
              label="Buy price"
              price={item.buyPrice}
              issuer={item.buyIssuer}
              chain={item.buyChain}
              chainId={buyChainId}
              contractAddress={item.buyContractAddress}
              liquidityUsd={item.buyLiquidityUsd}
              ticker={item.ticker}
              action="buy"
              nextLabel={isTypeB ? `Next: Bridge via ${item.buyIssuer}` : `Next: Sell on ${chainLabel(item.sellChain)}`}
              onNext={() => setStep(isTypeB ? 2 : 3)}
            />
          )}

          {/* Bridge leg — Type B only, OFT in-app */}
          {showBridge && (
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-[#EFF6FF] rounded-xl flex items-center justify-center flex-shrink-0 text-lg">🌉</div>
                <div>
                  <h4 className="font-semibold text-sm">Bridge via LayerZero OFT</h4>
                  <p className="text-xs text-[#94A3B8]">
                    Same issuer ({item.buyIssuer}) — burn on {chainLabel(item.buyChain)}, mint on {chainLabel(item.sellChain)}
                  </p>
                </div>
              </div>

              {item.buyContractAddress ? (
                <OFTBridgeWidget
                  tokenAddress={item.buyContractAddress}
                  tokenSymbol={item.ticker}
                  issuer={item.buyIssuer}
                  fromChain={item.buyChain}
                  toChain={item.sellChain}
                />
              ) : (
                <p className="text-xs text-[#94A3B8] text-center py-4">Contract address not available for bridge.</p>
              )}

              <button onClick={() => setStep(3)}
                className="w-full mt-4 flex items-center justify-center gap-2 text-sm text-[#64748B] hover:text-[#2563EB] transition-colors">
                Next: Sell on {chainLabel(item.sellChain)} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Sell leg */}
          {showSell && (
            <DexPanel
              label="Sell price"
              price={item.sellPrice}
              issuer={item.sellIssuer}
              chain={item.sellChain}
              chainId={sellChainId}
              contractAddress={item.sellContractAddress}
              liquidityUsd={item.sellLiquidityUsd}
              ticker={item.ticker}
              action="sell"
            />
          )}

          {/* Profit summary — always visible at sell step */}
          {showSell && (
            <div className="px-5 pb-5">
              <div className="p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl text-center">
                <p className="text-sm font-medium text-[#15803D]">Est. profit: {estProfit}</p>
                <p className="text-xs text-[#16A34A] mt-0.5">After fees &amp; slippage estimate</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Cross-Issuer Price Divergence Section ───────────────────────────────────

function CrossIssuerDivergence({ items }: { items: RawArbitrage[] }) {
  if (items.length === 0) return null;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden mt-6">
      <div className="px-6 py-4 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base">Cross-Issuer Price Divergence</h2>
          <span className="text-xs bg-[#F1F5F9] text-[#64748B] px-2 py-0.5 rounded-full font-medium">Info only</span>
        </div>
        <p className="text-xs text-[#94A3B8] mt-0.5">
          Same stock, different issuers — tokens cannot be directly swapped. Useful if you already hold both.
        </p>
      </div>

      <div className="divide-y divide-[#F1F5F9]">
        {items.map(item => {
          const net = estimateNetSpreadPct(item);
          return (
            <div key={item.id} className="px-6 py-4 flex items-center gap-4 flex-wrap">
              {/* Token */}
              <div className="w-24 flex-shrink-0">
                <p className="font-semibold text-sm">{item.ticker}</p>
                <p className="text-xs text-[#94A3B8]">Cross-issuer</p>
              </div>

              {/* Cheap side */}
              <div className="flex-1 min-w-[140px]">
                <p className="text-xs text-[#94A3B8] mb-0.5">Cheaper</p>
                <p className="text-sm font-medium">{item.buyIssuer} · {chainLabel(item.buyChain)}</p>
                <p className="font-price text-sm font-bold text-[#16A34A]">${item.buyPrice.toFixed(2)}</p>
              </div>

              <ArrowRight className="w-4 h-4 text-[#CBD5E1] flex-shrink-0" />

              {/* Expensive side */}
              <div className="flex-1 min-w-[140px]">
                <p className="text-xs text-[#94A3B8] mb-0.5">More expensive</p>
                <p className="text-sm font-medium">{item.sellIssuer} · {chainLabel(item.sellChain)}</p>
                <p className="font-price text-sm font-bold text-[#DC2626]">${item.sellPrice.toFixed(2)}</p>
              </div>

              {/* Spread */}
              <div className="text-right flex-shrink-0 w-24">
                <p className="text-xs text-[#94A3B8] mb-0.5">Spread</p>
                <p className="text-sm font-bold text-[#D97706]">+{item.spreadPct.toFixed(2)}%</p>
                <p className="text-xs text-[#94A3B8]">~${((net / 100) * 1000).toFixed(0)} / $1k</p>
              </div>

              {/* Info badge — no Execute button */}
              <div className="flex-shrink-0">
                <span className="text-xs text-[#94A3B8] bg-[#F8FAFC] border border-[#E2E8F0] px-2.5 py-1 rounded-lg">
                  Not directly tradeable
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ArbitrageList() {
  const [items, setItems] = useState<RawArbitrage[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<RawArbitrage | null>(null);

  useEffect(() => {
    fetchArbitrage()
      .then(data => {
        setItems(data.length > 0 ? data : (MOCK_ARBITRAGE_OPPORTUNITIES as RawArbitrage[]));
        setLoading(false);
      })
      .catch(() => {
        setItems(MOCK_ARBITRAGE_OPPORTUNITIES as RawArbitrage[]);
        setLoading(false);
      });
  }, []);

  // Sort by spread descending
  const sorted = [...items].sort((a, b) => b.spreadPct - a.spreadPct);

  return (
    <>
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#D97706]" />
              <h2 className="font-semibold text-base">Arbitrage Opportunities</h2>
              <span className="text-xs bg-[#FEF3C7] text-[#D97706] px-2 py-0.5 rounded-full font-medium">{items.length}</span>
            </div>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Price spreads across chains and issuers — buy cheap, sell high
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#94A3B8]">
            <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
            Live
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#94A3B8]">
            <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mr-2" />
            Scanning for opportunities...
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#94A3B8] text-sm">No active arbitrage opportunities</p>
            <p className="text-[#CBD5E1] text-xs mt-1">Prices are currently aligned across chains</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[#94A3B8] uppercase tracking-wider bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  <th className="text-left px-5 py-3 font-medium">Token</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Buy</th>
                  <th className="text-right px-4 py-3 font-medium">Price</th>
                  <th className="text-left px-4 py-3 font-medium"></th>
                  <th className="text-left px-4 py-3 font-medium">Sell</th>
                  <th className="text-right px-4 py-3 font-medium">Price</th>
                  <th className="text-right px-4 py-3 font-medium">Spread</th>
                  <th className="text-right px-4 py-3 font-medium">Net</th>
                  <th className="text-right px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(item => {
                  const isSameIssuer = item.buyIssuer === item.sellIssuer;
                  const net = estimateNetSpreadPct(item);
                  const risk = liquidityRisk(item);
                  const typeBadge = isSameIssuer
                    ? { label: "Bridge", cls: "bg-[#EFF6FF] text-[#2563EB]" }
                    : { label: "2×DEX", cls: "bg-[#FEF3C7] text-[#D97706]" };
                  return (
                    <tr key={item.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-[#2563EB]">{item.ticker.slice(0,4)}</span>
                          </div>
                          <p className="font-semibold text-sm">{item.ticker}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeBadge.cls}`}>
                          {typeBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-medium">{item.buyIssuer}</p>
                        <p className="text-xs text-[#94A3B8]">{chainLabel(item.buyChain)}</p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-price text-sm font-semibold text-[#16A34A]">${item.buyPrice.toFixed(2)}</span>
                      </td>
                      <td className="px-2 py-3.5 text-center">
                        <ArrowRight className="w-4 h-4 text-[#CBD5E1] inline-block" />
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-medium">{item.sellIssuer}</p>
                        <p className="text-xs text-[#94A3B8]">{chainLabel(item.sellChain)}</p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-price text-sm font-semibold text-[#DC2626]">${item.sellPrice.toFixed(2)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm font-semibold text-[#D97706]">
                          +{item.spreadPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {risk === "risky" && (
                            <span title="Low liquidity"><AlertTriangle className="w-3 h-3 text-[#D97706]" /></span>
                          )}
                          <span className={`text-sm font-bold ${net > 0.5 ? "text-[#16A34A]" : net <= 0 ? "text-[#DC2626]" : "text-[#D97706]"}`}>
                            {net >= 0 ? "+" : ""}{net.toFixed(2)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setExecuting(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Execute <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execute Modal */}
      {executing && (
        <ExecuteModal item={executing} onClose={() => setExecuting(null)} />
      )}
    </>
  );
}
