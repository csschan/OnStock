// Solana 常量和工具函数

export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'http://127.0.0.1:8899'
export const KAMINO_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export const XSTOCK_MINTS: Record<string, string> = {
  TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  NVDAx:  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  SPYx:   'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  QQQx:   'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
  AAPLx:  'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
  GOOGLx: 'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
  METAx:  'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
  COINx:  'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
  MSTRx:  'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
  CRCLx:  'XsCUZ6KU4QMcp6aHMNwHWcJu2rcaJNm6Hp8ZW5Xn6TM',
}

// Kamino reserve 地址（从 API 获取，这里存 asset→reserve 映射）
// 运行时动态获取，这里只是 fallback 缓存
export const KAMINO_RESERVES: Record<string, string> = {}

export function xTickerToTicker(xTicker: string): string {
  return xTicker.endsWith('x') ? xTicker.slice(0, -1) : xTicker
}

export function tickerToXTicker(ticker: string): string {
  return ticker.endsWith('x') ? ticker : `${ticker}x`
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1e9
}
