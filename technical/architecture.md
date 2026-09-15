# 技术架构文档

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                      前端 (Web App)                       │
│                Next.js 14+ / TailwindCSS                 │
│           Wagmi + RainbowKit (EVM钱包连接)                │
│           Solana Wallet Adapter (Solana钱包)              │
├──────────────────────────────────────────────────────────┤
│                      API Gateway                         │
│                   Node.js + Express                      │
│                    Rate Limiting                         │
│                      CORS                                │
├────────────┬────────────┬─────────────┬──────────────────┤
│  价格聚合   │  资产信息   │  交易路由    │   用户服务       │
│  引擎      │  服务      │  服务        │   服务          │
├────────────┴────────────┴─────────────┴──────────────────┤
│                       数据层                              │
│            Redis (实时缓存) + PostgreSQL (持久化)          │
├──────────────────────────────────────────────────────────┤
│                     数据采集层                             │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ 发行商采集器 │  │ DEX采集器  │  │ CEX采集器   │         │
│  │            │  │            │  │            │         │
│  │ OndoFetcher│  │ UniswapQ   │  │ KrakenAPI  │         │
│  │ BackedFetch│  │ JupiterAPI │  │ BinanceAPI │         │
│  │ DinariFetch│  │ PancakeQ   │  │            │         │
│  └────────────┘  └────────────┘  └────────────┘         │
│                                                          │
│  ┌────────────┐                                          │
│  │ Oracle采集器│                                          │
│  │ Chainlink  │  ← 基准价格                               │
│  └────────────┘                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 二、技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **前端框架** | Next.js | 14+ | App Router, SSR + 静态生成 |
| **UI库** | TailwindCSS + shadcn/ui | - | 快速开发, 专业风格 |
| **EVM钱包** | Wagmi + Viem | v2 | 多链EVM钱包连接 |
| **钱包UI** | RainbowKit | v2 | 钱包连接弹窗 |
| **Solana钱包** | @solana/wallet-adapter | - | Phantom等Solana钱包 |
| **后端** | Node.js + Express | v20+ | API服务 |
| **数据库** | PostgreSQL | 16 | 持久化存储 |
| **缓存** | Redis | 7 | 实时价格缓存 |
| **EVM交互** | Viem / ethers.js | v2 / v6 | 合约调用 |
| **Solana交互** | @solana/web3.js | v1/v2 | Solana链上交互 |
| **定时任务** | node-cron | - | 价格采集定时 |
| **WebSocket** | ws / Socket.io | - | 实时价格推送到前端 |
| **部署-前端** | Vercel | - | 免费, 全球CDN |
| **部署-后端** | VPS (2核4G起步) | - | 运行后端+Redis+PG |
| **域名** | - | - | 待定 |

---

## 三、核心模块设计

### 3.1 价格聚合引擎 (PriceAggregator)

```
src/
├── aggregator/
│   ├── PriceAggregator.ts        # 主聚合器
│   ├── fetchers/
│   │   ├── OndoFetcher.ts        # Ondo API价格采集
│   │   ├── BackedFetcher.ts      # Backed API价格采集
│   │   ├── DinariFetcher.ts      # Dinari API价格采集
│   │   ├── ChainlinkFetcher.ts   # Chainlink Oracle采集
│   │   ├── UniswapFetcher.ts     # Uniswap报价采集
│   │   ├── JupiterFetcher.ts     # Jupiter/Raydium报价采集
│   │   ├── PancakeFetcher.ts     # PancakeSwap报价采集
│   │   ├── KrakenFetcher.ts      # Kraken API价格
│   │   └── BinanceFetcher.ts     # Binance API价格
│   ├── calculator/
│   │   ├── CostCalculator.ts     # 成本计算(买入/卖出)
│   │   ├── GasEstimator.ts       # 多链Gas费估算
│   │   └── SlippageCalculator.ts # 滑点计算
│   └── cache/
│       └── PriceCache.ts         # Redis价格缓存层
```

### 3.2 交易路由服务 (TradeRouter)

```
src/
├── router/
│   ├── TradeRouter.ts            # 主路由器
│   ├── builders/
│   │   ├── UniswapBuilder.ts     # 构建Uniswap swap交易
│   │   ├── JupiterBuilder.ts     # 构建Jupiter swap交易
│   │   ├── PancakeBuilder.ts     # 构建PancakeSwap交易
│   │   ├── OndoMintBuilder.ts    # 构建Ondo铸造交易
│   │   ├── OndoRedeemBuilder.ts  # 构建Ondo赎回交易
│   │   ├── BackedMintBuilder.ts  # 构建Backed铸造交易
│   │   └── BackedRedeemBuilder.ts# 构建Backed赎回交易
│   └── validators/
│       ├── AllowanceChecker.ts   # 检查ERC20授权
│       └── BalanceChecker.ts     # 检查余额
```

### 3.3 资产信息服务 (AssetService)

```
src/
├── assets/
│   ├── AssetService.ts           # 资产查询
│   ├── AssetSync.ts              # 定期同步发行商资产列表
│   └── ContractRegistry.ts      # 合约地址注册表
```

---

## 四、数据流

### 4.1 价格采集流程

```
[定时任务: 每3-5秒]
     │
     ├─→ ChainlinkFetcher → 读取链上Oracle → Redis (basePrice)
     ├─→ OndoFetcher → 调用Ondo API/gRPC → Redis (ondoPrice)
     ├─→ BackedFetcher → 调用xStocks API → Redis (backedPrice)
     ├─→ KrakenFetcher → 调用Kraken API → Redis (krakenPrice)
     └─→ BinanceFetcher → 调用Binance API → Redis (binancePrice)

[用户请求时: 实时]
     │
     ├─→ 从Redis读取缓存价格
     ├─→ UniswapFetcher → 实时查询Quoter合约 (按用户金额)
     ├─→ JupiterFetcher → 实时查询Jupiter API (按用户金额)
     ├─→ CostCalculator → 计算每个渠道的真实成本
     ├─→ 排序 (买入:成本低→高 / 卖出:到手高→低)
     └─→ 返回结果

[定时任务: 每1分钟]
     │
     └─→ 价格快照写入PostgreSQL (用于历史图表)
```

### 4.2 交易执行流程

```
用户点击[平台内交易]
     │
     ├─→ 前端检查钱包连接状态
     ├─→ 前端检查用户余额
     │
     ├─→ POST /api/v1/trade/build
     │   ├─→ TradeRouter选择对应的Builder
     │   ├─→ Builder构建交易数据
     │   │   ├─→ Step 1: Approve交易 (如需要)
     │   │   └─→ Step 2: Swap/Mint/Redeem交易
     │   └─→ 返回交易数据
     │
     ├─→ 前端展示确认弹窗
     ├─→ 用户确认 → 钱包签名
     ├─→ 广播交易到链上
     │
     ├─→ 前端轮询交易状态
     └─→ 交易确认 → 展示结果
```

---

## 五、RPC节点

| 链 | 推荐RPC | 免费额度 |
|-----|---------|---------|
| Ethereum | Alchemy / Infura | 每月300M-1B请求 |
| Base | Alchemy | 同上 |
| BNB Chain | Quicknode / 公共节点 | - |
| Solana | Helius / Quicknode | 每月50K-100K请求 |
| Arbitrum | Alchemy | 同上 |

**MVP阶段用免费额度足够, 后期按需升级。**

---

## 六、项目目录结构

```
rwa-stock-aggregator/
├── apps/
│   ├── web/                        # Next.js前端
│   │   ├── app/
│   │   │   ├── page.tsx            # 首页
│   │   │   ├── stock/[ticker]/
│   │   │   │   └── page.tsx        # 股票详情+比价
│   │   │   ├── compare/
│   │   │   │   └── page.tsx        # 发行商对比
│   │   │   ├── portfolio/
│   │   │   │   └── page.tsx        # 持仓仪表盘
│   │   │   └── arbitrage/
│   │   │       └── page.tsx        # 套利监控
│   │   ├── components/
│   │   │   ├── PricePanel.tsx      # 比价面板(买入/卖出)
│   │   │   ├── TradeModal.tsx      # 交易确认弹窗
│   │   │   ├── SearchBar.tsx       # 搜索框
│   │   │   ├── Rankings.tsx        # 排行榜
│   │   │   ├── WalletConnect.tsx   # 钱包连接
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   ├── usePrices.ts        # 价格查询Hook
│   │   │   ├── useTrade.ts         # 交易执行Hook
│   │   │   └── usePortfolio.ts     # 持仓查询Hook
│   │   └── lib/
│   │       ├── chains.ts           # 链配置
│   │       ├── contracts.ts        # 合约地址
│   │       └── utils.ts
│   │
│   └── api/                        # Node.js后端
│       ├── src/
│       │   ├── index.ts            # Express入口
│       │   ├── routes/
│       │   │   ├── assets.ts       # /api/v1/assets
│       │   │   ├── prices.ts       # /api/v1/prices
│       │   │   ├── trade.ts        # /api/v1/trade
│       │   │   ├── rankings.ts     # /api/v1/rankings
│       │   │   └── arbitrage.ts    # /api/v1/arbitrage
│       │   ├── aggregator/         # 价格聚合引擎
│       │   ├── router/             # 交易路由
│       │   ├── assets/             # 资产服务
│       │   ├── db/                 # 数据库连接+迁移
│       │   └── cache/              # Redis缓存
│       └── package.json
│
├── packages/
│   └── shared/                     # 共享类型和工具
│       ├── types/
│       │   ├── asset.ts
│       │   ├── price.ts
│       │   ├── trade.ts
│       │   └── provider.ts
│       └── constants/
│           ├── chains.ts
│           ├── contracts.ts
│           └── providers.ts
│
├── docker-compose.yml              # PG + Redis
├── package.json
└── turbo.json                      # Turborepo配置
```

---

## 七、部署架构

```
[Vercel]                    [VPS 2核4G]
  │                            │
  ├── Next.js前端              ├── Node.js API
  ├── 全球CDN                  ├── Redis
  └── 自动部署                  ├── PostgreSQL
                               ├── 价格采集定时任务
                               └── WebSocket服务

[外部服务]
  ├── Alchemy (EVM RPC)
  ├── Helius (Solana RPC)
  ├── Ondo API
  ├── xStocks API
  ├── Kraken API
  ├── Binance API
  └── Chainlink (链上)
```

**MVP阶段成本:**
- Vercel: 免费
- VPS: ~$20/月
- RPC: 免费额度
- 域名: ~$10/年
- **总计: ~$30/月**
