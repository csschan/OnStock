import PriceChart from "@/components/PriceChart";
import AllMarketsTable from "@/components/AllMarketsTable";
import ConvertQuote from "@/components/ConvertQuote";
import { POPULAR_STOCKS } from "@/lib/mock-data";
import { fetchStockPrices, fetchPriceSources } from "@/lib/api";
import { formatPrice, formatPercent } from "@/lib/utils";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import type { RepresentationRow } from "@/components/AllMarketsTable";
import { CHAIN_ID } from "@/lib/chains";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function StockPage({ params }: PageProps) {
  const { ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  // Fetch live prices and per-DEX sources in parallel
  const [{ oraclePrice, buyQuotes }, priceSources] = await Promise.all([
    fetchStockPrices(upperTicker),
    fetchPriceSources(upperTicker),
  ]);

  // Company metadata from mock (can be replaced with real data source later)
  const meta = POPULAR_STOCKS.find((s) => s.ticker === upperTicker);

  const displayPrice = oraclePrice ?? meta?.basePrice ?? 0;

  // Build RepresentationRow list from buyQuotes (already sorted cheapest-first)
  // buyQuotes come from RawPriceSource via toQuote(); reconstruct the raw shape
  const representations: RepresentationRow[] = buyQuotes.map((q) => ({
    issuer: q.provider.toLowerCase(),
    chain: q.chain
      .toLowerCase()
      .replace(" chain", "")
      .replace("bnb chain", "bnb")
      .replace("robinhood chain", "robinhood-chain"),
    tokenSymbol: q.tokenName,
    contractAddress: q.tokenAddress,
    dexPrice: q.price,
    premiumPct: q.premiumPercent !== 0 ? q.premiumPercent : null,
    liquidityUsd: q.liquidityUsd ?? null,
    chainId: q.chainId ?? (q.chain ? CHAIN_ID[q.chain.toLowerCase().replace(" chain", "").replace("bnb chain", "bnb")] : undefined),
  }));

  // Fallback mock representations if no live data
  const fallbackRepresentations: RepresentationRow[] =
    meta
      ? [
          {
            issuer: "ondo",
            chain: "ethereum",
            tokenSymbol: `${upperTicker}on`,
            dexPrice: meta.basePrice * 1.0001,
            premiumPct: 0.01,
            liquidityUsd: 2_100_000,
            chainId: CHAIN_ID.ethereum,
          },
          {
            issuer: "ondo",
            chain: "bnb",
            tokenSymbol: `${upperTicker}on`,
            dexPrice: meta.basePrice * 0.9793,
            premiumPct: -2.07,
            liquidityUsd: 487_000,
            chainId: CHAIN_ID.bnb,
          },
          {
            issuer: "backed",
            chain: "ethereum",
            tokenSymbol: `${upperTicker}x`,
            dexPrice: meta.basePrice * 1.0007,
            premiumPct: 0.07,
            liquidityUsd: 650_000,
            chainId: CHAIN_ID.ethereum,
          },
          {
            issuer: "dinari",
            chain: "base",
            tokenSymbol: `d${upperTicker}`,
            dexPrice: meta.basePrice * 0.9989,
            premiumPct: -0.11,
            liquidityUsd: 320_000,
            chainId: CHAIN_ID.base,
          },
        ]
      : [];

  const finalRepresentations =
    representations.length > 0 ? representations : fallbackRepresentations;

  if (!meta && buyQuotes.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <p className="text-[#64748B]">
          Stock &quot;{upperTicker}&quot; not found.
        </p>
        <a
          href="/"
          className="text-[#2563EB] hover:underline mt-4 inline-block"
        >
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Back */}
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0F172A] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to markets
      </a>

      {/* Stock header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-[#F1F5F9] rounded-xl flex items-center justify-center">
              <span className="font-bold text-lg text-[#334155]">
                {upperTicker}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {upperTicker} &middot; {meta?.company ?? upperTicker}
              </h1>
              <p className="text-sm text-[#94A3B8]">
                {meta?.sector ?? "—"} &middot; {meta?.marketCap ?? "—"} market
                cap
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 md:mt-0 text-left md:text-right">
          <p className="font-price text-3xl font-bold">
            ${formatPrice(displayPrice)}
          </p>
          <p className="text-xs text-[#94A3B8] mt-0.5">Market Price</p>
          {meta && (
            <span
              className={`inline-flex items-center gap-1 text-sm font-medium mt-1 ${
                meta.change24h >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"
              }`}
            >
              {meta.change24h >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {formatPercent(meta.change24h)} (24h)
            </span>
          )}
        </div>
      </div>

      {/* Price Chart — full width */}
      <div className="mb-6">
        <PriceChart ticker={upperTicker} oraclePrice={displayPrice} />
      </div>

      {/* Main layout: 2/3 table + 1/3 convert */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AllMarketsTable
            ticker={upperTicker}
            oraclePrice={displayPrice}
            representations={finalRepresentations}
            priceSources={priceSources}
          />
        </div>
        <div className="lg:col-span-1">
          <ConvertQuote
            ticker={upperTicker}
            oraclePrice={displayPrice}
            representations={finalRepresentations}
          />
        </div>
      </div>
    </div>
  );
}
