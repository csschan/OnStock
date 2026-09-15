"use client";

import { useState } from "react";
import { ChevronDown, ArrowDown, AlertTriangle, Info, ExternalLink, ChevronRight } from "lucide-react";
import { RepresentationRow } from "./AllMarketsTable";
import { CHAIN_ID, USDC_BY_CHAIN } from "@/lib/chains";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConvertQuoteProps {
  ticker: string;
  oraclePrice: number;
  representations: RepresentationRow[];
}

type RouteType = "dex" | "bridge" | "cross-issuer";

interface QuoteResult {
  routeType: RouteType;
  amountIn: number;
  received: number;
  dexFee: number | null;
  bridgeFee: number | null;
  redeemFee: number | null;
  mintFee: number | null;
  slippage: number | null;
  gasUsd: number;
  priceDiffPct: number;
  totalCostPct: number;
  settlement: string;
  requiresEligibility: boolean;
  needsUsdcBridge: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRouteType(from: RepresentationRow, to: RepresentationRow): RouteType {
  if (from.chain === to.chain) return "dex";
  if (from.issuer === to.issuer) return "bridge";
  return "cross-issuer";
}

function issuerBridgeUrl(issuer: string): { label: string; url: string; time: string } {
  if (issuer === "ondo") return { label: "Ondo Bridge (LayerZero)", url: "https://app.ondo.finance/bridge", time: "~15 min" };
  if (issuer === "backed") return { label: "Backed Bridge (CCIP)", url: "https://ccip.chain.link", time: "~20 min" };
  return { label: "Issuer Bridge", url: "#", time: "~30 min" };
}

function gasUsdForChain(chain: string): number {
  if (chain === "ethereum") return 3;
  if (chain === "solana") return 0.001;
  return 0.5;
}

function chainLabel(chain: string): string {
  const map: Record<string, string> = {
    ethereum: "Ethereum", bnb: "BNB Chain", solana: "Solana",
    base: "Base", arbitrum: "Arbitrum", "robinhood-chain": "Robinhood",
  };
  return map[chain] ?? chain;
}

function chainSlug(chain: string): string | null {
  const map: Record<string, string> = {
    ethereum: "ethereum", bnb: "bnb", base: "base", arbitrum: "arbitrum",
  };
  return map[chain] ?? null;
}

function buildKyberUrl(chain: string, fromAddr: string, toAddr: string): string | null {
  const slug = chainSlug(chain);
  if (!slug || !fromAddr || !toAddr) return null;
  return `https://kyberswap.com/swap/${slug}?inputCurrency=${fromAddr}&outputCurrency=${toAddr}`;
}

function computeQuote(
  from: RepresentationRow,
  to: RepresentationRow,
  amount: number
): QuoteResult {
  const routeType = getRouteType(from, to);
  const priceDiffPct = ((from.dexPrice - to.dexPrice) / to.dexPrice) * 100;

  if (routeType === "dex") {
    const dexFee = 0.003;
    const slippage = 0.001;
    const gasUsd = from.chain === "ethereum" ? 0.5 : from.chain === "bnb" ? 0.05 : 0.001;
    const priceRatio = from.dexPrice / to.dexPrice;
    const received = amount * priceRatio * (1 - dexFee) * (1 - slippage) - gasUsd / to.dexPrice;
    const totalCostPct = ((amount - received) / amount) * 100;
    return {
      routeType, amountIn: amount, received: Math.max(0, received),
      dexFee, bridgeFee: null, redeemFee: null, mintFee: null,
      slippage, gasUsd, priceDiffPct, totalCostPct,
      settlement: "~1-3 min", requiresEligibility: false, needsUsdcBridge: false,
    };
  }

  if (routeType === "bridge") {
    const bridgeFee = 0.001;
    const gasUsd = gasUsdForChain(from.chain) + 2;
    const priceRatio = from.dexPrice / to.dexPrice;
    const received = amount * priceRatio * (1 - bridgeFee) - gasUsd / to.dexPrice;
    const totalCostPct = ((amount - received) / amount) * 100;
    return {
      routeType, amountIn: amount, received: Math.max(0, received),
      dexFee: null, bridgeFee, redeemFee: null, mintFee: null,
      slippage: null, gasUsd, priceDiffPct, totalCostPct,
      settlement: "~15-20 min", requiresEligibility: false, needsUsdcBridge: false,
    };
  }

  // cross-issuer: sell FROM→USDC on DEX, bridge USDC if different chains, buy USDC→TO on DEX
  const sameChain = from.chain === to.chain;
  const dexFeeFrom = 0.003;
  const dexFeeTo = 0.003;
  const slippage = 0.001;
  const usdcBridgeFee = sameChain ? 0 : 0.001;
  const gasUsd = gasUsdForChain(from.chain) + gasUsdForChain(to.chain) + (sameChain ? 0 : 3);
  const priceRatio = from.dexPrice / to.dexPrice;
  const received =
    amount *
    priceRatio *
    (1 - dexFeeFrom) * (1 - slippage) *
    (1 - usdcBridgeFee) *
    (1 - dexFeeTo) * (1 - slippage) -
    gasUsd / to.dexPrice;
  const totalCostPct = ((amount - received) / amount) * 100;
  return {
    routeType, amountIn: amount, received: Math.max(0, received),
    dexFee: dexFeeFrom + dexFeeTo,
    bridgeFee: sameChain ? null : usdcBridgeFee,
    redeemFee: null, mintFee: null,
    slippage, gasUsd, priceDiffPct, totalCostPct,
    settlement: sameChain ? "~2-5 min" : "~15-30 min (USDC bridge)",
    requiresEligibility: false,
    needsUsdcBridge: !sameChain,
  };
}

function routeLabel(r: RouteType): string {
  if (r === "dex") return "DEX Swap (Same Chain)";
  if (r === "bridge") return "Bridge (Same Issuer)";
  return "Cross-Issuer (2 DEX Swaps)";
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function fmtAmount(v: number): string {
  return v.toFixed(4);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RowItem({ label, pct, usdVal, color }: {
  label: string; pct: string; usdVal: string; color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-[#64748B]">{label}</span>
      <div className="flex items-center gap-4 tabular-nums">
        <span className={`font-price text-xs w-16 text-right ${color ?? "text-[#0F172A]"}`}>{pct}</span>
        <span className={`font-price text-xs w-20 text-right ${color ?? "text-[#64748B]"}`}>{usdVal}</span>
      </div>
    </div>
  );
}

// ─── Execution UI ────────────────────────────────────────────────────────────

function ExecutionPanel({
  quote, fromRow, toRow, ticker,
}: {
  quote: QuoteResult;
  fromRow: RepresentationRow;
  toRow: RepresentationRow;
  ticker: string;
}) {
  const [step, setStep] = useState<number>(1);

  // ── DEX (same chain): direct swap ─────────────────────────────────────────
  if (quote.routeType === "dex") {
    const url = buildKyberUrl(
      fromRow.chain,
      fromRow.contractAddress ?? "",
      toRow.contractAddress ?? ""
    );
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white transition-colors"
      >
        Swap on KyberSwap <ExternalLink className="w-4 h-4" />
      </a>
    ) : (
      <p className="text-xs text-center text-[#94A3B8] py-2">
        Contract addresses required to build swap link
      </p>
    );
  }

  // ── Bridge (same issuer, cross-chain) ─────────────────────────────────────
  if (quote.routeType === "bridge") {
    const bridge = issuerBridgeUrl(fromRow.issuer);
    return (
      <div className="space-y-2">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3 text-xs text-[#64748B] space-y-1">
          <div className="flex justify-between">
            <span>Bridge</span>
            <span className="font-medium text-[#0F172A]">{bridge.label}</span>
          </div>
          <div className="flex justify-between">
            <span>From → To</span>
            <span className="font-medium text-[#0F172A]">{chainLabel(fromRow.chain)} → {chainLabel(toRow.chain)}</span>
          </div>
          <div className="flex justify-between">
            <span>Est. time</span>
            <span className="font-medium text-[#0F172A]">{bridge.time}</span>
          </div>
        </div>
        <a
          href={bridge.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white transition-colors"
        >
          {bridge.label} <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    );
  }

  // ── Cross-issuer: 2-3 step DEX execution ─────────────────────────────────
  const fromChainId = CHAIN_ID[fromRow.chain];
  const toChainId = CHAIN_ID[toRow.chain];
  const fromUsdc = fromChainId ? USDC_BY_CHAIN[fromChainId] : null;
  const toUsdc = toChainId ? USDC_BY_CHAIN[toChainId] : null;

  const step1Url = buildKyberUrl(fromRow.chain, fromRow.contractAddress ?? "", fromUsdc ?? "");
  const step2Url = "https://stargate.finance/transfer"; // USDC bridge
  const step3Url = buildKyberUrl(toRow.chain, toUsdc ?? "", toRow.contractAddress ?? "");

  const totalSteps = quote.needsUsdcBridge ? 3 : 2;

  const stepDefs = [
    {
      label: `Sell ${fromRow.tokenSymbol} → USDC`,
      desc: `On ${chainLabel(fromRow.chain)} · KyberSwap`,
      url: step1Url,
      color: "bg-[#DC2626] hover:bg-[#B91C1C]",
    },
    ...(quote.needsUsdcBridge ? [{
      label: `Bridge USDC → ${chainLabel(toRow.chain)}`,
      desc: "Via Stargate Finance",
      url: step2Url,
      color: "bg-[#D97706] hover:bg-[#B45309]",
    }] : []),
    {
      label: `Buy ${toRow.tokenSymbol} with USDC`,
      desc: `On ${chainLabel(toRow.chain)} · KyberSwap`,
      url: step3Url,
      color: "bg-[#16A34A] hover:bg-[#15803D]",
    },
  ];

  return (
    <div className="space-y-2">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-1">
        {stepDefs.map((_, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
              i + 1 === step ? "bg-[#2563EB] text-white" :
              i + 1 < step ? "bg-[#16A34A] text-white" : "bg-[#E2E8F0] text-[#94A3B8]"
            }`}>
              {i + 1 < step ? "✓" : i + 1}
            </div>
            {i < stepDefs.length - 1 && (
              <ChevronRight className="w-3 h-3 text-[#CBD5E1]" />
            )}
          </div>
        ))}
        <span className="text-xs text-[#94A3B8] ml-1">Step {step} of {totalSteps}</span>
      </div>

      {/* Current step action */}
      {(() => {
        const cur = stepDefs[step - 1];
        if (!cur) return null;
        return (
          <div>
            <p className="text-xs text-[#64748B] mb-1.5">{cur.desc}</p>
            {cur.url ? (
              <a
                href={cur.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => step < totalSteps && setStep(step + 1)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${cur.color}`}
              >
                {cur.label} <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <p className="text-xs text-center text-[#94A3B8] py-2">
                Contract address required
              </p>
            )}
            {step < totalSteps && (
              <button
                onClick={() => setStep(step + 1)}
                className="w-full mt-2 text-xs text-[#64748B] hover:text-[#2563EB] transition-colors flex items-center justify-center gap-1"
              >
                Skip to step {step + 1} <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ConvertQuote({ ticker, oraclePrice, representations }: ConvertQuoteProps) {
  const [fromIndex, setFromIndex] = useState<number>(0);
  const [toIndex, setToIndex] = useState<number>(representations.length > 1 ? 1 : 0);
  const [amountStr, setAmountStr] = useState<string>("100");
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const fromRow = representations[fromIndex];
  const toRow = representations[toIndex];

  const handleGetQuote = () => {
    if (!fromRow || !toRow || fromIndex === toIndex || amount <= 0) return;
    setQuote(computeQuote(fromRow, toRow, amount));
  };

  const sameSelection = fromIndex === toIndex;
  const canQuote = !sameSelection && amount > 0 && representations.length >= 2;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#E2E8F0]">
        <h2 className="font-semibold text-base">Convert</h2>
        <p className="text-xs text-[#94A3B8] mt-0.5">
          Quote between {ticker} representations
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* FROM */}
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5 uppercase tracking-wider">From</label>
          <div className="relative">
            <select
              className="w-full appearance-none bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm text-[#0F172A] pr-8 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              value={fromIndex}
              onChange={(e) => { setFromIndex(Number(e.target.value)); setQuote(null); }}
            >
              {representations.map((r, i) => (
                <option key={`from-${i}`} value={i}>
                  {r.issuer.charAt(0).toUpperCase() + r.issuer.slice(1)} · {r.tokenSymbol} · {chainLabel(r.chain)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-[#94A3B8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <div className="mt-2 flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
            <span className="text-xs text-[#94A3B8] flex-shrink-0">Amount</span>
            <input
              type="number" min="0" step="1" value={amountStr}
              onChange={(e) => { setAmountStr(e.target.value); setQuote(null); }}
              className="font-price flex-1 bg-transparent outline-none text-sm text-[#0F172A] min-w-0"
            />
            <span className="text-xs text-[#94A3B8] flex-shrink-0">{ticker}</span>
          </div>
        </div>

        {/* Arrow divider */}
        <div className="flex items-center justify-center">
          <div className="w-8 h-8 bg-[#F1F5F9] rounded-full flex items-center justify-center">
            <ArrowDown className="w-4 h-4 text-[#64748B]" />
          </div>
        </div>

        {/* TO */}
        <div>
          <label className="block text-xs font-medium text-[#64748B] mb-1.5 uppercase tracking-wider">To</label>
          <div className="relative">
            <select
              className="w-full appearance-none bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm text-[#0F172A] pr-8 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              value={toIndex}
              onChange={(e) => { setToIndex(Number(e.target.value)); setQuote(null); }}
            >
              {representations.map((r, i) => (
                <option key={`to-${i}`} value={i}>
                  {r.issuer.charAt(0).toUpperCase() + r.issuer.slice(1)} · {r.tokenSymbol} · {chainLabel(r.chain)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-[#94A3B8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {sameSelection && (
          <p className="text-xs text-[#D97706] flex items-center gap-1">
            <Info className="w-3 h-3" />
            Select different source and destination
          </p>
        )}

        <button
          onClick={handleGetQuote}
          disabled={!canQuote}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
        >
          Get Quote
        </button>
      </div>

      {/* Quote Result */}
      {quote && fromRow && toRow && (
        <div className="border-t border-[#E2E8F0] px-5 py-4">
          {/* Route type + cross-issuer note */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-[#64748B]">Route</span>
            <span className="text-xs font-semibold text-[#0F172A]">{routeLabel(quote.routeType)}</span>
          </div>

          {quote.routeType === "cross-issuer" && (
            <div className="mb-3 flex items-start gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#15803D]">
                Two independent DEX swaps via USDC. No issuer KYC required.
              </p>
            </div>
          )}

          {/* Breakdown */}
          <div className="bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] px-4 py-2 mb-3">
            <div className="flex items-center justify-between pb-1.5 mb-0.5 border-b border-[#E2E8F0]">
              <span className="text-xs font-medium text-[#94A3B8]">You send</span>
              <span className="font-price text-sm font-semibold text-[#0F172A]">
                {fmtAmount(quote.amountIn)} {ticker}
              </span>
            </div>

            {quote.dexFee !== null && (
              <RowItem
                label={quote.routeType === "cross-issuer" ? "DEX fees (buy + sell, 0.3% each)" : "DEX fee (0.3%)"}
                pct={fmtPct(-quote.dexFee)}
                usdVal={`-${fmtAmount(quote.amountIn * quote.dexFee)}`}
                color="text-[#DC2626]"
              />
            )}
            {quote.slippage !== null && (
              <RowItem
                label={quote.routeType === "cross-issuer" ? "Slippage est. (0.1% × 2)" : "Slippage est. (0.1%)"}
                pct={fmtPct(quote.routeType === "cross-issuer" ? -quote.slippage * 2 : -quote.slippage)}
                usdVal={`-${fmtAmount(quote.amountIn * (quote.routeType === "cross-issuer" ? quote.slippage * 2 : quote.slippage))}`}
                color="text-[#DC2626]"
              />
            )}
            {quote.bridgeFee !== null && (
              <RowItem
                label={quote.routeType === "cross-issuer" ? "USDC bridge fee (0.1%)" : "Bridge fee (0.1%)"}
                pct={fmtPct(-quote.bridgeFee)}
                usdVal={`-${fmtAmount(quote.amountIn * quote.bridgeFee)}`}
                color="text-[#DC2626]"
              />
            )}
            {quote.redeemFee !== null && (
              <RowItem
                label={`Redeem fee (${(quote.redeemFee * 100).toFixed(2)}%)`}
                pct={fmtPct(-quote.redeemFee)}
                usdVal={`-${fmtAmount(quote.amountIn * quote.redeemFee)}`}
                color="text-[#DC2626]"
              />
            )}
            {quote.mintFee !== null && (
              <RowItem
                label={`Mint fee (${(quote.mintFee * 100).toFixed(2)}%)`}
                pct={fmtPct(-quote.mintFee)}
                usdVal={`-${fmtAmount(quote.amountIn * quote.mintFee)}`}
                color="text-[#DC2626]"
              />
            )}
            <RowItem
              label="Gas est."
              pct={`-$${quote.gasUsd.toFixed(2)}`}
              usdVal={`-${fmtAmount(quote.gasUsd / (toRow.dexPrice || 1))}`}
              color="text-[#DC2626]"
            />
            <RowItem
              label="Price diff"
              pct={`${quote.priceDiffPct >= 0 ? "+" : ""}${quote.priceDiffPct.toFixed(2)}%`}
              usdVal={`${quote.priceDiffPct >= 0 ? "+" : ""}${fmtAmount((quote.priceDiffPct / 100) * quote.amountIn)}`}
              color={quote.priceDiffPct >= 0 ? "text-[#DC2626]" : "text-[#16A34A]"}
            />

            <div className="border-t border-[#E2E8F0] my-2" />
            <div className="flex items-center justify-between py-1">
              <span className="text-sm font-semibold text-[#0F172A]">You receive</span>
              <span className="font-price text-sm font-bold text-[#16A34A]">
                {fmtAmount(quote.received)} {ticker}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-[#64748B]">Total cost</span>
              <span className="font-price text-xs font-semibold text-[#DC2626]">
                {quote.totalCostPct.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-[#64748B]">Settlement</span>
              <span className="text-xs text-[#0F172A]">{quote.settlement}</span>
            </div>
          </div>

          {/* Execution */}
          <ExecutionPanel quote={quote} fromRow={fromRow} toRow={toRow} ticker={ticker} />
        </div>
      )}
    </div>
  );
}
