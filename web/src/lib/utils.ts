export function formatPrice(price: number): string {
  return (price ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number): string {
  const v = value ?? 0;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function getProviderColor(type: "issuer" | "dex" | "cex"): string {
  switch (type) {
    case "issuer":
      return "bg-blue-50 text-blue-700";
    case "dex":
      return "bg-purple-50 text-purple-700";
    case "cex":
      return "bg-amber-50 text-amber-700";
  }
}

export function getChainIcon(chain: string): string {
  const lower = chain.toLowerCase();
  if (lower.includes("eth")) return "ETH";
  if (lower.includes("sol")) return "SOL";
  if (lower.includes("base")) return "BASE";
  if (lower.includes("bnb")) return "BNB";
  if (lower.includes("arb")) return "ARB";
  return chain.slice(0, 3).toUpperCase();
}
