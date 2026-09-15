export interface Stock {
  ticker: string;
  company: string;
  sector: string;
  basePrice: number;
  change24h: number;
  volume24h: string;
  marketCap: string;
}

export interface Quote {
  provider: string;
  type: "issuer" | "dex" | "cex";
  tokenName: string;
  chain: string;
  price: number;
  premiumPercent: number;
  protocolFee: number;
  estimatedGas: number;
  canTradeInPlatform: boolean;
  tradeUrl: string;
  requiresKYC: boolean;
  hasDividends: boolean;
  // On-chain swap fields (only available from real API data)
  tokenAddress?: string;
  chainId?: number;
  liquidityUsd?: number | null;
}

export const POPULAR_STOCKS: Stock[] = [
  { ticker: "NVDA", company: "NVIDIA Corporation", sector: "Technology", basePrice: 135.20, change24h: 2.34, volume24h: "$12.3M", marketCap: "$3.3T" },
  { ticker: "TSLA", company: "Tesla, Inc.", sector: "Automotive", basePrice: 248.50, change24h: -1.12, volume24h: "$8.7M", marketCap: "$795B" },
  { ticker: "AAPL", company: "Apple Inc.", sector: "Technology", basePrice: 223.10, change24h: 0.87, volume24h: "$4.1M", marketCap: "$3.4T" },
  { ticker: "SPY", company: "SPDR S&P 500 ETF", sector: "Index", basePrice: 562.30, change24h: 0.45, volume24h: "$6.2M", marketCap: "-" },
  { ticker: "MSFT", company: "Microsoft Corporation", sector: "Technology", basePrice: 441.80, change24h: 1.56, volume24h: "$3.5M", marketCap: "$3.3T" },
  { ticker: "GOOG", company: "Alphabet Inc.", sector: "Technology", basePrice: 178.90, change24h: -0.34, volume24h: "$2.8M", marketCap: "$2.2T" },
  { ticker: "META", company: "Meta Platforms, Inc.", sector: "Technology", basePrice: 510.20, change24h: 0.92, volume24h: "$2.1M", marketCap: "$1.3T" },
  { ticker: "AMZN", company: "Amazon.com, Inc.", sector: "Technology", basePrice: 192.40, change24h: 1.23, volume24h: "$1.9M", marketCap: "$2.0T" },
  { ticker: "QQQ", company: "Invesco QQQ Trust", sector: "Index", basePrice: 487.60, change24h: 0.67, volume24h: "$3.8M", marketCap: "-" },
  { ticker: "AMD", company: "Advanced Micro Devices", sector: "Technology", basePrice: 158.30, change24h: 3.12, volume24h: "$1.5M", marketCap: "$256B" },
];

export function getBuyQuotes(ticker: string, basePrice: number): Quote[] {
  return [
    {
      provider: "Dinari",
      type: "issuer",
      tokenName: `d${ticker}`,
      chain: "Base",
      price: basePrice * 0.9989,
      premiumPercent: -0.11,
      protocolFee: 0.05,
      estimatedGas: 0.02,
      canTradeInPlatform: true,
      tradeUrl: "https://app.dinari.com",
      requiresKYC: true,
      hasDividends: true,
    },
    {
      provider: "Raydium",
      type: "dex",
      tokenName: `${ticker}x`,
      chain: "Solana",
      price: basePrice * 0.9996,
      premiumPercent: -0.04,
      protocolFee: 0.20,
      estimatedGas: 0.001,
      canTradeInPlatform: true,
      tradeUrl: "https://raydium.io",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Kraken",
      type: "cex",
      tokenName: `x${ticker}`,
      chain: "Solana/ETH",
      price: basePrice * 0.9999,
      premiumPercent: -0.01,
      protocolFee: 0.10,
      estimatedGas: 0,
      canTradeInPlatform: false,
      tradeUrl: "https://kraken.com",
      requiresKYC: true,
      hasDividends: true,
    },
    {
      provider: "Ondo",
      type: "issuer",
      tokenName: `${ticker}on`,
      chain: "ETH/BNB/SOL",
      price: basePrice * 1.0001,
      premiumPercent: 0.01,
      protocolFee: 0.10,
      estimatedGas: 0.50,
      canTradeInPlatform: true,
      tradeUrl: "https://ondo.finance",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Uniswap",
      type: "dex",
      tokenName: `${ticker}on`,
      chain: "Ethereum",
      price: basePrice * 1.0007,
      premiumPercent: 0.07,
      protocolFee: 0.30,
      estimatedGas: 0.50,
      canTradeInPlatform: true,
      tradeUrl: "https://app.uniswap.org",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Binance",
      type: "cex",
      tokenName: `b${ticker}`,
      chain: "BNB",
      price: basePrice * 1.0004,
      premiumPercent: 0.04,
      protocolFee: 0.10,
      estimatedGas: 0.05,
      canTradeInPlatform: false,
      tradeUrl: "https://binance.com",
      requiresKYC: true,
      hasDividends: true,
    },
  ];
}

export function getSellQuotes(ticker: string, basePrice: number): Quote[] {
  return [
    {
      provider: "Ondo Redeem",
      type: "issuer",
      tokenName: `${ticker}on`,
      chain: "ETH/BNB/SOL",
      price: basePrice,
      premiumPercent: 0,
      protocolFee: 0.10,
      estimatedGas: 0.50,
      canTradeInPlatform: true,
      tradeUrl: "https://ondo.finance",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Uniswap",
      type: "dex",
      tokenName: `${ticker}on`,
      chain: "Ethereum",
      price: basePrice * 1.0007,
      premiumPercent: 0.07,
      protocolFee: 0.30,
      estimatedGas: 0.50,
      canTradeInPlatform: true,
      tradeUrl: "https://app.uniswap.org",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Raydium",
      type: "dex",
      tokenName: `${ticker}x`,
      chain: "Solana",
      price: basePrice * 0.9996,
      premiumPercent: -0.04,
      protocolFee: 0.20,
      estimatedGas: 0.001,
      canTradeInPlatform: true,
      tradeUrl: "https://raydium.io",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "PancakeSwap",
      type: "dex",
      tokenName: `${ticker}on`,
      chain: "BNB Chain",
      price: basePrice * 0.9998,
      premiumPercent: -0.02,
      protocolFee: 0.25,
      estimatedGas: 0.05,
      canTradeInPlatform: true,
      tradeUrl: "https://pancakeswap.finance",
      requiresKYC: false,
      hasDividends: true,
    },
    {
      provider: "Kraken",
      type: "cex",
      tokenName: `x${ticker}`,
      chain: "N/A",
      price: basePrice * 0.9999,
      premiumPercent: -0.01,
      protocolFee: 0.10,
      estimatedGas: 0,
      canTradeInPlatform: false,
      tradeUrl: "https://kraken.com",
      requiresKYC: true,
      hasDividends: true,
    },
  ];
}

export interface ArbitrageOpportunity {
  ticker: string;
  buyProvider: string;
  buyPrice: number;
  buyChain: string;
  sellProvider: string;
  sellPrice: number;
  sellChain: string;
  spreadPercent: number;
}

export const ARBITRAGE_OPPORTUNITIES: ArbitrageOpportunity[] = [
  { ticker: "NVDA", buyProvider: "Dinari", buyPrice: 135.05, buyChain: "Base", sellProvider: "Uniswap", sellPrice: 135.30, sellChain: "Ethereum", spreadPercent: 0.18 },
  { ticker: "TSLA", buyProvider: "Raydium", buyPrice: 248.10, buyChain: "Solana", sellProvider: "Binance", sellPrice: 248.80, sellChain: "BNB", spreadPercent: 0.28 },
  { ticker: "SPY", buyProvider: "Backed", buyPrice: 562.00, buyChain: "Ethereum", sellProvider: "Kraken", sellPrice: 563.50, sellChain: "Solana", spreadPercent: 0.27 },
];

// Mock arbitrage data matching RawArbitrage shape (used when backend has no data yet)
// Based on real Ondo Finance cross-chain structural discount: BNB trades ~1-2% below ETH
export const MOCK_ARBITRAGE_OPPORTUNITIES = [
  {
    id: 1,
    ticker: "AAPL",
    buyChain: "bnb",
    buyIssuer: "ondo",
    buyPrice: 196.72,
    buyLiquidityUsd: 487000,
    buyContractAddress: "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4",
    sellChain: "ethereum",
    sellIssuer: "ondo",
    sellPrice: 200.79,
    sellLiquidityUsd: 2100000,
    sellContractAddress: "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c",
    spreadPct: 2.07,
    estimatedProfit: 20.7,
    detectedAt: new Date().toISOString(),
  },
  {
    id: 2,
    ticker: "TSLA",
    buyChain: "bnb",
    buyIssuer: "ondo",
    buyPrice: 219.12,
    buyLiquidityUsd: 312000,
    buyContractAddress: "0x2494b603319d4D9F9715c9f4496d9E0364B59d93",
    sellChain: "ethereum",
    sellIssuer: "ondo",
    sellPrice: 223.55,
    sellLiquidityUsd: 980000,
    sellContractAddress: "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f",
    spreadPct: 2.02,
    estimatedProfit: 20.2,
    detectedAt: new Date().toISOString(),
  },
  {
    id: 3,
    ticker: "NVDA",
    buyChain: "bnb",
    buyIssuer: "ondo",
    buyPrice: 119.33,
    buyLiquidityUsd: 891000,
    buyContractAddress: "0xA9eE28C80f960B889dFbd1902055218cBa016F75",
    sellChain: "ethereum",
    sellIssuer: "ondo",
    sellPrice: 121.72,
    sellLiquidityUsd: 3400000,
    sellContractAddress: "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE",
    spreadPct: 2.0,
    estimatedProfit: 20.0,
    detectedAt: new Date().toISOString(),
  },
  {
    id: 4,
    ticker: "MSFT",
    buyChain: "bnb",
    buyIssuer: "ondo",
    buyPrice: 389.78,
    buyLiquidityUsd: 245000,
    buyContractAddress: "0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3",
    sellChain: "ethereum",
    sellIssuer: "ondo",
    sellPrice: 397.57,
    sellLiquidityUsd: 1560000,
    sellContractAddress: "0xB812837b81a3a6b81d7CD74CfB19A7f2784555E5",
    spreadPct: 2.0,
    estimatedProfit: 20.0,
    detectedAt: new Date().toISOString(),
  },
  {
    id: 5,
    ticker: "SPY",
    buyChain: "bnb",
    buyIssuer: "ondo",
    buyPrice: 495.62,
    buyLiquidityUsd: 178000,
    buyContractAddress: "0x6a708EAD771238919D85930b5a0f10454E1C331a",
    sellChain: "ethereum",
    sellIssuer: "ondo",
    sellPrice: 505.53,
    sellLiquidityUsd: 4200000,
    sellContractAddress: "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08",
    spreadPct: 2.0,
    estimatedProfit: 20.0,
    detectedAt: new Date().toISOString(),
  },
];

export const DISCOUNT_STOCKS = [
  { ticker: "TSLA", discount: -0.35 },
  { ticker: "MSFT", discount: -0.28 },
  { ticker: "GOOG", discount: -0.22 },
  { ticker: "META", discount: -0.18 },
  { ticker: "AMZN", discount: -0.15 },
];
