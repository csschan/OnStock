import { IssuerInfo } from './types'

/**
 * Issuer 元数据 — 帮助用户判断"买的是哪个版本的 AAPL"
 * tradingModel: 'dex' = 可在 DEX 自由交易, 'orderbook' = 通过平台订单簿 mint/redeem
 */

export const ISSUERS: Record<string, IssuerInfo> = {
  ondo: {
    name: 'Ondo Finance',
    slug: 'ondo',
    redemption: true,
    kyc: 'required',
    backing: '1:1 US equity, custodied at Ankura Trust',
    website: 'https://ondo.finance',
    tradingModel: 'dex',
    tradingMethod: 'DEX Swap (USDC → token)',
    tradingDesc: '在 KyberSwap/Uniswap 上用 USDC 兑换，需要 EVM 钱包',
  },
  backed: {
    name: 'Backed Finance (xStocks)',
    slug: 'backed',
    redemption: true,
    kyc: 'required',
    backing: '1:1 physical equity, Swiss regulated (FINMA)',
    website: 'https://backed.fi',
    tradingModel: 'dex',
    tradingMethod: 'DEX Swap (USDC → token)',
    tradingDesc: 'Solana 上用 Jupiter/Raydium swap，EVM 上用 KyberSwap',
  },
  dinari: {
    name: 'Dinari',
    slug: 'dinari',
    redemption: true,
    kyc: 'required',
    backing: '1:1 US equity, held at regulated broker-dealer',
    website: 'https://dinari.com',
    tradingModel: 'orderbook',
    tradingMethod: '平台订单簿 Mint/Redeem',
    tradingDesc: '在 Dinari 平台用 USDC mint 代币，需要 KYC',
  },
  robinhood: {
    name: 'Robinhood',
    slug: 'robinhood',
    redemption: false,
    kyc: 'required',
    backing: '1:1 US equity, held by Robinhood Securities',
    website: 'https://robinhood.com',
    tradingModel: 'dex',
    tradingMethod: 'Robinhood 平台交易',
    tradingDesc: '在 Robinhood App 内买卖，需要美国账户 + KYC',
  },
  binance: {
    name: 'Binance bStocks',
    slug: 'binance',
    redemption: true,
    kyc: 'required',
    backing: '1:1 US equity, held by regulated custodian (BTech Holdings, ADGM)',
    website: 'https://www.binance.com',
    tradingModel: 'dex',
    tradingMethod: 'CEX 交易 + DEX Swap',
    tradingDesc: '币安交易所直接买卖 (推荐) 或 BNB Chain DEX swap',
  },
  hyperliquid: {
    name: 'Hyperliquid Perp',
    slug: 'hyperliquid',
    redemption: false,
    kyc: 'none',
    backing: '永续合约，无底层资产',
    website: 'https://app.hyperliquid.xyz',
    tradingModel: 'orderbook',
    tradingMethod: '永续合约做多/做空',
    tradingDesc: '用 USDC 做保证金，最高 5x 杠杆，无需 KYC',
  },
  'binance-cex': {
    name: 'Binance CEX',
    slug: 'binance-cex',
    redemption: true,
    kyc: 'required',
    backing: '1:1 US equity, held by regulated custodian (BTech Holdings, ADGM)',
    website: 'https://www.binance.com',
    tradingModel: 'orderbook',
    tradingMethod: 'CEX 订单簿交易',
    tradingDesc: '在币安交易所用 USDT 直接买卖，流动性最好，需要币安 KYC 账号',
  },
  prestocks: {
    name: 'PreStocks',
    slug: 'prestocks',
    redemption: false,
    kyc: 'none',
    backing: 'Economic exposure to pre-IPO companies, tokenized on Solana',
    website: 'https://prestocks.com',
    tradingModel: 'dex',
    tradingMethod: 'DEX Swap (USDC → token)',
    tradingDesc: 'Buy pre-IPO exposure on Solana via Jupiter swap. No KYC required.',
  },
}

/**
 * 生成跳转交易链接
 */
export function getTradeUrl(
  issuer: string,
  chain: string,
  ticker: string,
  tokenSymbol: string,
  contractAddress: string,
): string | null {
  switch (issuer) {
    case 'ondo':
      if (chain === 'ethereum') {
        return `https://kyberswap.com/swap/ethereum/usdc-to-${tokenSymbol.toLowerCase()}`
      }
      if (chain === 'bnb') {
        return `https://kyberswap.com/swap/bsc/usdc-to-${tokenSymbol.toLowerCase()}`
      }
      return null

    case 'backed':
      if (chain === 'solana') {
        return `https://jup.ag/swap/USDC-${contractAddress}`
      }
      if (chain === 'ethereum') {
        return `https://kyberswap.com/swap/ethereum/usdc-to-${tokenSymbol.toLowerCase()}`
      }
      if (chain === 'bnb') {
        return `https://kyberswap.com/swap/bsc/usdc-to-${tokenSymbol.toLowerCase()}`
      }
      return null

    case 'dinari':
      return `https://app.dinari.com/tokens/${ticker}`

    case 'robinhood':
      return `https://robinhood.com/stocks/${ticker}`

    case 'binance':
      // BNB Chain DEX swap
      return `https://kyberswap.com/swap/bsc/usdc-to-${tokenSymbol.toLowerCase()}`

    case 'binance-cex':
      // CEX 交易页面
      return `https://www.binance.com/en/trade/${tokenSymbol}_USDT`

    case 'hyperliquid':
      return `https://app.hyperliquid.xyz/trade/${ticker}`

    case 'prestocks':
      return `https://jup.ag/swap/USDC-${contractAddress}`

    default:
      return null
  }
}
