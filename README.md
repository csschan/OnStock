# OnStock

**The Execution Layer for Tokenized Stocks**

One search, best route, one-click execution — across all chains, issuers, and protocols.

## Overview

OnStock is an intelligent routing and execution engine for tokenized stocks (RWA equities). Users think in stocks ("buy TSLA"), and the system resolves the best token version, best chain, best route, and earns yield — all in one click.

### Live Stats
- **20 stocks** tracked across all issuers
- **67 tradeable routes** across 6 chains
- **$1.28B+ total AUM** monitored
- **7 data sources** aggregated in real-time

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Aggregation & Intelligence            │
│  Real-time prices from 7 sources (Yahoo,        │
│  Chainlink, DEX, CEX, Hyperliquid, Robinhood)   │
│  Premium/discount detection + arbitrage signals  │
├─────────────────────────────────────────────────┤
│  Layer 2: Intent Router & Execution Engine      │
│  User intent → dynamic route generation based   │
│  on live premium, momentum, APY, risk tolerance  │
│  One-click: Swap + Vault Deposit                │
├─────────────────────────────────────────────────┤
│  Layer 3: Yield & Portfolio Management          │
│  OnStock Vault (Solana program) for auto-yield  │
│  Multi-asset Portfolio Builder with batch exec  │
│  Receipt tokens — redeem anytime                │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
OnStock/
├── server/                    # Backend API server
│   ├── src/
│   │   ├── api/routes.ts      # All API endpoints
│   │   ├── intent/            # Dynamic intent router
│   │   ├── assets/            # Asset graph & scoring
│   │   ├── fetchers/          # Price fetchers (14 sources)
│   │   └── aggregator.ts      # Price aggregation engine
│   └── prisma/                # Database schema
│
├── web/                       # Next.js frontend
│   └── src/
│       ├── app/               # Pages (dashboard, markets, intent, portfolio, earn)
│       ├── components/        # UI components
│       ├── hooks/             # Custom hooks (intent execution, wallet)
│       └── lib/               # API client, web3 config
│
├── onstock-vault/             # Solana program (Anchor)
│   ├── programs/
│   │   └── onstock-vault/
│   │       └── src/lib.rs     # Vault program (deposit, withdraw, receipt tokens)
│   └── tests/                 # Integration tests
│
├── research/                  # Market research & analysis
├── design/                    # Product design docs
└── technical/                 # Technical architecture docs
```

## Key Features

### Intent Router
Dynamic routing engine that generates optimal execution paths based on 5 real-time market signals:

| Signal | Source | Impact |
|--------|--------|--------|
| On-chain Premium | DEX price vs Oracle | High premium → wait / DCA |
| 24h Momentum | Price history | Strong trend → leverage routes |
| Vault APY | OnStock protocol | Higher yield → vault deposit |
| Kamino APY | Kamino lending | Split strategies |
| Risk Tolerance | User input | Low → defensive, High → leverage |

Generates 4 route types: **Best Entry**, **Max Yield**, **Leveraged**, **Defensive**

### Portfolio Builder
Multi-asset xStock portfolio construction with one-click execution:
- Select assets and set allocation weights
- Server builds all transactions (mint + deposit)
- Single Phantom signature prompt for all deposits
- Server relays with aggressive re-broadcast until confirmed
- Receipt tokens earned with projected APY

### Market Dashboard
- Real-time prices across all issuers and chains
- Premium/discount heatmap
- Arbitrage opportunity scanner
- Price divergence monitoring (spot vs perpetual)
- Solana xStocks ecosystem overview

### Vault (Solana Program)
- Anchor-based vault program on Solana devnet
- Deposit xStock tokens → receive receipt tokens
- NAV-based share calculation
- Withdraw anytime by burning receipt tokens
- Program ID: `Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx`

## Supported Issuers & Chains

| Issuer | Chain | Token Standard |
|--------|-------|---------------|
| Backed Finance (xStocks) | Solana | SPL Token |
| Ondo Finance | Ethereum | ERC-20 |
| Dinari | Arbitrum, Ethereum | ERC-20 |
| Robinhood | Robinhood Chain | ERC-20 |
| Binance bStocks | BNB Chain | BEP-20 |
| Hyperliquid | Hyperliquid L1 | Perpetuals |

## Data Sources

- **Oracle**: Yahoo Finance, Chainlink
- **DEX**: Jupiter, Raydium, Uniswap V3, PancakeSwap V3, KyberSwap
- **CEX**: Binance, Robinhood
- **DeFi**: Kamino (lending APY), DexScreener (liquidity)
- **Derivatives**: Hyperliquid (perpetual contracts)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React, TailwindCSS |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite (Prisma ORM) |
| Solana | Anchor, @solana/web3.js, SPL Token |
| EVM | Wagmi, Viem, ethers.js |
| Wallet | Phantom (Solana), MetaMask/WalletConnect (EVM) |

## Getting Started

### Prerequisites
- Node.js 20+
- Solana CLI (for vault program)
- Phantom wallet (browser extension)

### Server
```bash
cd server
npm install
npx prisma generate
npx prisma db push
cp .env.example .env  # Configure RPC URLs
npx tsx watch src/index.ts
```

### Web
```bash
cd web
npm install
cp .env.example .env  # Set NEXT_PUBLIC_API_URL
npm run dev
```

### Vault Program
```bash
cd onstock-vault
anchor build
anchor deploy --provider.cluster devnet
```

## API Endpoints

### Core
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prices/:ticker` | Latest prices for a stock |
| GET | `/api/prices/:ticker/sources` | Prices by source/issuer |
| GET | `/api/market/stats` | Market summary statistics |
| GET | `/api/market/overview` | Full market overview |

### Intent & Execution
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/intent/route` | Generate optimal routes |
| POST | `/api/intent/execute-entry` | Build swap + deposit txs |
| POST | `/api/portfolio/build-batch` | Build multi-asset portfolio txs |
| POST | `/api/tx/send-confirm` | Relay & confirm signed tx |

### Vault
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/earn/vault/positions` | User vault positions |
| POST | `/api/earn/vault/build-deposit` | Build deposit tx |
| POST | `/api/earn/vault/build-withdraw` | Build withdraw tx |

### Devnet
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/devnet/faucet` | Airdrop test tokens |
| POST | `/api/devnet/mint-xstock-batch` | Mint xStock to wallet |

## License

MIT
