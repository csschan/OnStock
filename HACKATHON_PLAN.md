# OnStock - Hackathon Plan

## Product Vision

### One-liner
OnStock is the unified operations layer for on-chain RWA stock tokens — aggregate prices, route trades, and orchestrate DeFi strategies across all protocols. The Jupiter for tokenized equities.

### The Macro Thesis

Traditional finance built highways for Apple and Microsoft — unlimited liquidity, tight spreads, massive daily volume.

But for the next wave of high-attention, small-cap stocks, Nasdaq only offers a dirt road: small float, thin order books, 6.5 hours/day, global investors locked out.

Crypto built a new exchange next door — open 24/7, stablecoins as chips, funding rates pricing crowding, OI storing speculative demand, tokenized stock + lending + vault + DeFi legos stacked on top.

When a $100M market cap company's perpetual market generates nearly $100M in OI over a single weekend while Nasdaq hasn't even opened — this is no longer a sideshow. It's a new exchange without a closing bell.

### Core Problem

The new exchange exists, but it's fragmented:

```
Same stock, different tokens, different chains:
  TSLAx (Solana) / TSLAon (ETH) / TSLAB (BNB) / dTSLA (Arbitrum)

Same chain, different DeFi protocols:
  Kamino — xStocks as collateral, 82.6% lending share
  Jupiter Lend — SPYx/QQQx/NVDAx/TSLAx collateral
  NestUSD — xStocks → mint nUSD stablecoin, 6% APY
  Shift RWA — 2x/3x leveraged long/short tokens
  Backpack — real shares as perp margin
  Raydium/Orca — AMM swap pools

Problems:
  1. User has TSLAx → which protocol gives best yield? Nobody aggregates this.
  2. User wants to buy TSLA exposure → which chain/issuer is cheapest? Nobody routes this.
  3. 91% of tokenized stock supply sits idle in wallets → nobody activates this.
  4. Each protocol is isolated → no combined strategies across protocols.
```

### Solution: Unified Operations Layer

```
Jupiter didn't build a DEX. It aggregated all DEXes → became the default trading entry point.
1inch didn't build a DEX. It aggregated all EVM DEXes → became the default EVM entry point.

OnStock doesn't build a lending protocol.
It aggregates ALL RWA stock DeFi protocols → becomes the default entry point
for tokenized equities on Solana.
```

Three layers:

```
Layer 1 — AGGREGATE
  Prices across 6 chains, 5+ issuers (Live)
  + DeFi yields across Kamino, Jupiter Lend, NestUSD, Shift (Hackathon)
  = See ALL opportunities in one place

Layer 2 — ROUTE
  Trades to best price via Jupiter/Raydium (Live)
  + Deposits/borrows to best protocol (Hackathon)
  = Execute at optimal path, one click

Layer 3 — ORCHESTRATE
  Combine protocols into strategies no single protocol offers (Hackathon)
  = Looping, delta neutral, index baskets, auto-rebalance
  = The 91% idle supply gets activated
```

---

## Market Context

### Market Size (mid-2026)
- Tokenized equity market: ~$3 billion (1,400x growth in 12 months)
- Solana commands **97% of all on-chain tokenized equity volume**
- Q2 2026 tokenized stock DEX volume: **$5.77B** (+114% QoQ)
- RWA lending on Solana: **$1.2B** deposits
- **91% of tokenized stock supply sits idle** — not deployed in any DeFi protocol

### Existing Solana RWA Stock DeFi Landscape

| Protocol | What It Does | Share |
|---|---|---|
| **Kamino** | xStocks as collateral → borrow USDC | 82.6%, $31M |
| **Jupiter Lend** | SPYx/QQQx/NVDAx/TSLAx collateral, 75% LTV | #2, $20M+ |
| **NestUSD** | xStocks → mint nUSD (CDP), sNUSD 6% APY | Live June 2026 |
| **Shift RWA** | 2x/3x leveraged long/short tokens, no liquidation | On Jupiter |
| **Backpack** | Real shares as cross-margin collateral | Brokerage layer |
| **Save (Solend)** | xStocks Market V2 | Minor share |
| **Raydium/Orca** | AMM swap pools | Trading only |

### What Does NOT Exist (Gaps)

```
❌ No protocol aggregates yields across Kamino/Jupiter Lend/NestUSD
❌ No strategy router — user doesn't know which protocol is optimal
❌ No automated yield strategies (looping, delta neutral)
❌ No cross-stock index baskets as composable tokens
❌ 91% of supply idle — no activation layer
❌ No unified view of RWA stock DeFi positions across protocols
```

**OnStock fills every one of these gaps.**

---

## What OnStock Has Today

### Layer 1: Aggregate — Prices (Live)
```
Price Engine (production):
  Yahoo Finance / Robinhood / Pyth / Hyperliquid
  Binance bStocks / DexScreener / GeckoTerminal
  KyberSwap / Uniswap V3 / PancakeSwap V3
  Solana DEX pools (Raydium/Orca)

Coverage:
  20 assets, 111 instruments, 6 chains, 5+ issuers
  Real-time premium/discount
  Cross-chain arbitrage detection
  Issuer AUM, TVL, 24h volume
  Market status (open/closed/pre-market)

Frontend (running):
  Dashboard / Asset pages / Issuer comparison
  Arbitrage board / Premium heatmap
  Price divergence / Market signals
```

### Layer 2: Route — Trades (Live)
```
Solana: Jupiter Terminal V3 swap
EVM: KyberSwap / Uniswap V3 / PancakeSwap V3
Cross-chain: LayerZero OFT bridge
```

---

## Hackathon Deliverable: DeFi Aggregation + Strategy Layer

### Layer 1 Expansion: Aggregate DeFi Yields

```
Current: "TSLAx price is $360.52 on Raydium"

After hackathon: "TSLAx yields across protocols:"
  Kamino:       Collateral → borrow USDC @ 4.2% cost → net yield 2.1%
  Jupiter Lend: Collateral → borrow USDC @ 3.8% cost → net yield 2.5%
  NestUSD:      Deposit → mint nUSD → stake sNUSD → 6.0% APY
  Shift:        TSL2L (2x long) → no liquidation
  Loop strategy: Kamino deposit → borrow → rebuy → 12%+ APY (higher risk)

OnStock shows all options, ranked by:
  → Real yield (after fees)
  → Risk level
  → Liquidity depth
```

Data sources to integrate:
```
Kamino API:
  → Pool rates, utilization, LTV limits per xStock
  → docs.kamino.finance

Jupiter Lend:
  → Supply/borrow rates for xStocks
  → LTV caps, risk tiers

NestUSD:
  → nUSD mint rate (3% APR)
  → sNUSD staking APY (6%)
  → Collateral ratios per xStock

Shift RWA:
  → Leveraged token NAVs
  → Available tickers and leverage levels

Raydium:
  → LP pool APYs for xStock/USDC pairs
  → TVL and volume per pool
```

### Layer 2 Expansion: Route to Best Protocol

```
Current: "Swap TSLAx on Jupiter"

After hackathon:
  User: "I have $10,000 TSLAx, I want yield"
  
  OnStock compares all paths:
    A. Kamino supply → 2.1% APY (low risk)
    B. NestUSD mint nUSD → stake sNUSD → 6% APY (medium risk)
    C. Raydium TSLAx/USDC LP → 8% APY (IL risk)
    D. Loop: Kamino supply → borrow USDC → buy TSLAx → re-supply → 12% (high risk)
  
  → One-click execute best strategy
  → Transaction built and routed automatically
```

### Layer 3: Orchestrate — Combined Strategies

Strategies that no single protocol offers, but OnStock can build by combining them:

**Strategy 1: Auto-Loop (Leveraged Yield)**
```
TSLAx → deposit Kamino → borrow USDC → buy TSLAx → deposit again
→ Repeat N times based on risk tolerance
→ Amplified yield on xStocks
→ One click, OnStock manages the loop
```

**Strategy 2: Mint & Stake (NestUSD Yield)**
```
TSLAx → deposit NestUSD vault → mint nUSD → stake as sNUSD
→ 6% APY + TSLAx price exposure
→ One click through OnStock
```

**Strategy 3: Best-Rate Collateral Routing**
```
User wants to borrow $5000 USDC against TSLAx
→ OnStock checks:
  Kamino: 70% LTV, 4.2% borrow rate
  Jupiter Lend: 75% LTV, 3.8% borrow rate ← winner
→ Route to Jupiter Lend automatically
```

**Strategy 4: Index Basket (Future)**
```
"AI Tech Basket" = equal weight TSLAx + NVDAx + GOOGLx + METAx
→ One click, OnStock buys all four via Jupiter
→ Rebalance quarterly
→ Portfolio-level view in dashboard
```

**Strategy 5: Delta Neutral Yield (Future)**
```
Long TSLAx (spot) + Short TSLA perp (Backpack/Hyperliquid)
→ Net exposure = 0
→ Earn funding rate when shorts pay longs
→ OnStock monitors and rebalances
```

---

## Technical Architecture

### System Diagram

```
+--------------------------------------------------+
|            OnStock Frontend (Next.js)             |
|  Prices | Swap | DeFi Yields | Strategies | Portfolio |
+---------------------+----------------------------+
                      |
+---------------------+----------------------------+
|         OnStock Price Engine (LIVE)               |
|  Yahoo + Robinhood + Pyth + DexScreener           |
|  + Hyperliquid + Binance bStocks                  |
+---------------------+----------------------------+
                      |
+---------------------+----------------------------+
|      OnStock DeFi Aggregator (NEW)                |
|                                                    |
|  Kamino API → rates, LTV, utilization              |
|  Jupiter Lend → rates, risk tiers                  |
|  NestUSD → mint rate, sNUSD APY                    |
|  Shift RWA → leveraged token NAVs                  |
|  Raydium → LP APYs, TVL                            |
|                                                    |
|  → Compare all yields for each xStock              |
|  → Rank by real yield / risk / liquidity            |
|  → Build optimal strategy transactions             |
+---------------------+----------------------------+
                      |
+---------------------+----------------------------+
|        Strategy Executor (Solana TX Builder)       |
|                                                    |
|  Route to Kamino / Jupiter Lend / NestUSD          |
|  Build multi-step transactions:                    |
|    Loop: deposit → borrow → swap → re-deposit      |
|    Mint: deposit → mint nUSD → stake sNUSD          |
|    LP: split → deposit Raydium pool                 |
|                                                    |
|  Jupiter SDK for swap steps                        |
|  Kamino SDK for lending steps                      |
|  Anchor CPI for NestUSD steps                      |
+---------------------+----------------------------+
                      |
+---------------------+----------------------------+
|         Solana Protocols (Existing)                |
|  Kamino | Jupiter Lend | NestUSD | Raydium | Shift |
+--------------------------------------------------+
```

### Key Technical Decisions

```
1. No custom Anchor lending contract needed
   → Integrate existing protocols via their SDKs/CPIs
   → Faster to build, more liquidity from day one

2. Transaction builder composes multi-step Solana TXs
   → Versioned transactions with lookup tables
   → Multiple instructions in one TX where possible
   → Fallback to sequential TXs for complex strategies

3. DeFi data aggregation runs on existing backend
   → Same architecture as price engine
   → Poll protocol APIs every 30s
   → Cache in memory, serve via existing API

4. Frontend extends existing dashboard
   → New "Earn" tab alongside existing Prices/Swap/Arbitrage
   → Strategy cards with one-click execute
   → Position tracking across protocols
```

---

## User Experience

### Main Flow

```
User opens OnStock → sees dashboard with real-time prices (existing)

Clicks "Earn" tab (new):

┌─────────────────────────────────────────────────┐
│  Earn on Your Stock Tokens                       │
│                                                  │
│  Select asset: [TSLAx ▼]  Balance: 27.5 TSLAx   │
│                                                  │
│  ┌─ Best Yield ──────────────────────────────┐   │
│  │ NestUSD Mint & Stake           6.0% APY   │   │
│  │ Deposit TSLAx → mint nUSD → stake sNUSD   │   │
│  │ Risk: Medium | Liquidity: Good             │   │
│  │ [Earn Now]                                 │   │
│  └────────────────────────────────────────────┘   │
│                                                  │
│  Kamino Supply                    2.1% APY       │
│  Collateral yield, low risk                       │
│  [Deposit]                                        │
│                                                  │
│  Jupiter Lend                     2.5% APY       │
│  75% LTV, medium risk tier                        │
│  [Deposit]                                        │
│                                                  │
│  Raydium TSLAx/USDC LP           8.2% APY       │
│  IL risk, high volume pool                        │
│  [Add Liquidity]                                  │
│                                                  │
│  Loop Strategy (Advanced)        12.4% APY       │
│  3x loop via Kamino, high risk                    │
│  [Start Loop]                                     │
│                                                  │
│  ─────────────────────────────────────────────── │
│  Borrow Against TSLAx                             │
│                                                  │
│  Best rate: Jupiter Lend @ 3.8% APR (75% LTV)   │
│  Kamino: 4.2% APR (70% LTV)                      │
│  [Borrow USDC]                                    │
└─────────────────────────────────────────────────┘
```

### Position Tracking

```
┌─────────────────────────────────────────────────┐
│  My RWA Positions                                │
│                                                  │
│  Wallet Holdings          $24,500                │
│    TSLAx: 27.5 ($9,915)                          │
│    NVDAx: 22.0 ($4,829)                          │
│    SPYx:  12.7 ($9,756)                          │
│                                                  │
│  DeFi Positions           $15,200                │
│    Kamino: 10 SPYx supplied (2.1% APY)           │
│    NestUSD: 15 TSLAx → 4,800 nUSD staked (6%)   │
│    Jupiter Lend: 5 NVDAx collateral              │
│      → Borrowed 3,200 USDC (3.8%)               │
│                                                  │
│  Total Portfolio          $39,700                │
│  Total Yield              ~$1,100/year            │
└─────────────────────────────────────────────────┘
```

---

## Revenue Model (No Token)

```
1. Strategy routing fee: 0.1% per deposit/strategy execution
   Users route through OnStock to Kamino/NestUSD/etc.
   $1M monthly volume → $1,000/month

2. Swap routing fee: 0.05% per trade (existing)
   $500K daily volume → $250/day

3. Referral/integration fees from protocols
   Kamino/NestUSD may offer referral programs

4. Premium strategies (future)
   Advanced strategies (loop, delta neutral) for pro users

No token needed. Real cash flow from routing.
```

---

## Multi-Chain Expansion

```
Phase 1: Solana (Hackathon)
  Aggregate: Prices + DeFi yields across Kamino/Jupiter/NestUSD
  Route: Trades + DeFi deposits to optimal protocol
  Orchestrate: Loop strategies, mint & stake

Phase 2: Arc (Circle L1, mainnet Sept 16)
  Same model → aggregate Aave/Morpho/Curve yields for stock tokens
  EVM compatible → Solidity SDK integrations
  USDC native → natural stablecoin supply

Phase 3: Tempo (Stripe L1)
  Same model → aggregate Morpho yields
  Stablecoin-focused → supply side liquidity

Architecture advantage:
  Price engine already covers all chains
  DeFi aggregator pattern replicates per chain
  Frontend is chain-agnostic
  Each chain: Aggregate → Route → Orchestrate
```

---

## Hackathon Timeline (2 Weeks)

### Week 1: DeFi Aggregation Backend
```
Day 1-2: Protocol data integration
  Kamino API: rates, utilization, LTV per xStock
  Jupiter Lend: supply/borrow rates
  NestUSD: mint rate, sNUSD APY
  Raydium: LP pool APYs

Day 3-4: Yield comparison engine
  Normalize yields across protocols
  Risk scoring per strategy
  API endpoint: GET /api/earn/{ticker}

Day 5-7: Transaction builder
  Kamino SDK: deposit/withdraw/borrow transactions
  NestUSD: mint/stake transaction flow
  Jupiter: swap steps for loop strategies
  Multi-instruction Solana TX composition
```

### Week 2: Frontend + Demo
```
Day 8-9: "Earn" tab UI
  Strategy cards with APY comparison
  One-click execute buttons
  Connect wallet → sign → done

Day 10-11: Position tracking
  Read user positions from Kamino/Jupiter/NestUSD
  Unified portfolio view
  P&L tracking

Day 12-13: Polish + demo
  Error handling, loading states
  Mobile responsive
  Demo script rehearsal
  Backup video recording

Day 14: Submit
```

---

## Demo Script (3 Minutes)

### Minute 1: The Problem
```
"Solana has $535M in tokenized stocks.
 97% of all on-chain equity volume runs through Solana.
 
 But 91% of these tokens sit idle in wallets.
 
 The DeFi exists — Kamino, Jupiter Lend, NestUSD, Raydium.
 But users don't know which protocol offers the best yield.
 They don't know the risks. They can't compare.
 
 It's like having 10 banks but no way to compare interest rates."
```

### Minute 2: Live Demo
```
[Show OnStock dashboard — real prices, live data]

"OnStock already aggregates stock token prices across 6 chains.
 Today we're adding DeFi yield aggregation."

[Click 'Earn' tab → select TSLAx]

"My TSLAx can earn:
 2.1% on Kamino, 2.5% on Jupiter, 6% on NestUSD, 
 8% as Raydium LP, or 12% with a loop strategy."

[Click 'Earn Now' on NestUSD → sign transaction]

"One click. TSLAx deposited, nUSD minted, sNUSD staking.
 6% APY. My dead asset is now earning yield."

[Show position tracking]

"And I can see all my RWA positions — wallet + DeFi — in one view."
```

### Minute 3: The Vision
```
"91% of tokenized stocks are idle. 
 Not because DeFi doesn't exist,
 but because nobody connects the user to the right protocol.

 OnStock is three layers:
 Aggregate prices. Route trades. Orchestrate DeFi strategies.

 We're the Jupiter for tokenized equities.
 Solana first. Then Arc. Then Tempo.
 
 Every chain where stock tokens live,
 OnStock is the default entry point."
```

---

## Competitive Position

| | Kamino | Jupiter Lend | NestUSD | **OnStock** |
|---|---|---|---|---|
| Lending | Yes | Yes | CDP | Aggregates all |
| Multi-protocol comparison | No | No | No | **Yes** |
| Best-rate routing | No | No | No | **Yes** |
| Strategy composition | No | No | No | **Yes** |
| Price aggregation (multi-chain) | No | No | No | **Yes** |
| Swap routing | No | No | No | **Yes** |
| Unified portfolio view | Own only | Own only | Own only | **All protocols** |

**OnStock doesn't compete with Kamino. It sits on top of Kamino — and Jupiter Lend, and NestUSD, and Raydium — routing users to the best option.**

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Protocol API changes | Abstract via adapter pattern, easy to update |
| Smart contract risk (underlying protocols) | Display risk ratings, user accepts per protocol |
| Low initial xStocks volume | Start with top 5 (TSLAx, NVDAx, SPYx, QQQx, AAPLx) |
| Protocols block OnStock integration | We route users, protocols benefit from more TVL |
| Weekend price gaps | Frontend warning, inherited from underlying protocols |

---

## Team

**Vincent Chen (Founder)** — 8+ years blockchain. Founded Bandot (secured millions in collateral). Deep DeFi infrastructure.

**Ivan Chen (CMO)** — Full product lifecycle. NFT, staking, DeFi growth.

**Lesin Huang (Chief Manager)** — High-performance systems at Bandot. Liquidity management specialist.

---

## Summary

> **OnStock = the unified operations layer for on-chain RWA stocks.**
>
> **Aggregate** — Prices across 6 chains + DeFi yields across all protocols.
> **Route** — Trades to best price + deposits to best yield.
> **Orchestrate** — Combine protocols into strategies no single one offers.
>
> Jupiter didn't build a DEX. It aggregated all DEXes.
> OnStock doesn't build a lending protocol. It aggregates all RWA DeFi.
>
> 91% of tokenized stocks sit idle. OnStock activates them.
>
> *"The Jupiter for tokenized equities."*
