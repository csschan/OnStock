// Robinhood Testnet deployment config

export const ROBINHOOD_CONFIG = {
  chainId: 46630,
  rpc: 'https://rpc.testnet.chain.robinhood.com',
  explorer: 'https://explorer.testnet.chain.robinhood.com',
  gasToken: 'ETH',
}

export function loadRobinhoodDeployment(): {
  gateway: string
  pool: string
  usdc: string
  osTokens: Record<string, string>
} | null {
  try {
    const fs = require('fs')
    const path = require('path')
    const paths = [
      path.resolve(process.cwd(), '../xlayer-contracts/deployment-robinhoodTestnet.json'),
      path.resolve(__dirname, '../../../xlayer-contracts/deployment-robinhoodTestnet.json'),
      path.resolve(__dirname, '../../../../xlayer-contracts/deployment-robinhoodTestnet.json'),
    ]
    for (const f of paths) {
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
    }
    return null
  } catch {
    return null
  }
}
