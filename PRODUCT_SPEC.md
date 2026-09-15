# OnStock - 产品设计文档

## 一、项目概述

### 1.1 产品定位
链上美股代币全渠道聚合比价平台 —— 帮助用户以最优价格买卖链上美股代币。

### 1.2 一句话描述
"链上美股代币的买卖入口 —— 全渠道比价，一键最优交易。"

### 1.3 核心价值
- 用户无需逐个平台比较价格，一站式查看所有渠道报价
- 同时支持买入和卖出比价，帮用户找到买入最便宜、卖出到手最多的渠道
- 自动计算真实交易成本（含手续费、Gas、滑点）
- 展示与美股真实价格的溢价/折价偏差
- 平台内直接完成交易（DEX swap），无需跳转到第三方
- 支持发行商铸造/赎回、DEX swap、CEX交易三种交易方式

### 1.4 目标用户
- 链上美股代币买家（全球非美国用户为主）
- DeFi用户想配置美股资产
- 套利交易者（捕捉各渠道价差）
- 新手用户（不了解各发行商区别）

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    前端 (Web App)                     │
│              Next.js + TailwindCSS                   │
│         Wagmi + Viem (EVM) + Solana Web3.js          │
├─────────────────────────────────────────────────────┤
│                    API Gateway                       │
│                  Node.js / Express                   │
├──────────┬──────────┬──────────┬────────────────────┤
│  价格聚合  │  资产信息  │ 交易路由  │   用户服务        │
│  引擎     │  服务     │  服务    │   服务            │
├──────────┴──────────┴──────────┴────────────────────┤
│                    数据层                             │
│           Redis (缓存) + PostgreSQL (持久化)          │
├─────────────────────────────────────────────────────┤
│                   外部数据源                          │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 发行商API │ │ DEX链上  │ │ CEX API  │            │
│  │          │ │ 价格     │ │          │            │
│  │ Ondo     │ │ Uniswap  │ │ Kraken   │            │
│  │ Backed   │ │ Raydium  │ │ Binance  │            │
│  │ Dinari   │ │ PancakeS │ │ Coinbase │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│  ┌──────────┐                                       │
│  │ Oracle   │                                       │
│  │ Chainlink│ ← 基准价格（美股真实价格）               │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端 | Next.js 14+ | SSR + 静态生成，SEO友好 |
| UI | TailwindCSS + shadcn/ui | 快速开发，风格专业 |
| 钱包连接 | Wagmi + RainbowKit (EVM), Solana Wallet Adapter | 多链钱包支持 |
| 后端 | Node.js + Express | API服务 |
| 数据库 | PostgreSQL | 资产信息、历史价格 |
| 缓存 | Redis | 实时价格缓存，减少API调用 |
| 链上交互 | Viem (EVM) + @solana/web3.js | 读取合约、DEX报价 |
| 部署 | Vercel (前端) + VPS (后端) | 低成本启动 |

---

## 三、数据源接入

### 3.1 发行商直接报价

#### Ondo Finance
- **API文档**: https://docs.ondo.finance/api-reference/overview
- **接入方式**: REST API + gRPC实时推送
- **SDK**: Python / JavaScript / Rust
- **可获取数据**:
  - 实时铸造/赎回报价
  - 代币元数据（合约地址、支持链）
  - 历史价格
- **支持链**: Ethereum, BNB Chain, Solana
- **代币命名**: {TICKER}on (如 NVDAon, TSLAon, SPYon)
- **费率**: 铸造/赎回约 0.1%
- **更新频率**: 实时 (gRPC推送)

#### Backed Finance (xStocks)
- **API文档**: https://docs.xstocks.fi/apis/openapi
- **接入方式**: REST API (公开免费，无需认证)
- **公开端点**: `GET https://api.xstocks.fi/api/v2/public/assets`
- **可获取数据**:
  - 168个产品目录
  - 实时价格 + rebasing倍数
  - 各链合约地址
  - ISIN编号
  - Chainlink Proof of Reserve数据
- **支持链**: Ethereum, Solana, Arbitrum, Mantle, TON, Ink 等11条链
- **代币命名**: {TICKER}x (如 NVDAx, TSLAx, SPYx)
- **费率**: 约 0.2%
- **更新频率**: API轮询，秒级

#### Dinari
- **API文档**: https://dinari.com (开发者文档)
- **接入方式**: REST API
- **可获取数据**:
  - 724只股票价格
  - dShares合约地址
- **支持链**: Ethereum, Avalanche, Arbitrum, Base, Sei, Solana
- **代币命名**: d{TICKER} (如 dNVDA, dTSLA)
- **费率**: 约 0.05%
- **更新频率**: 待测试

### 3.2 DEX链上价格

| DEX | 链 | 交易对示例 | 获取方式 |
|-----|-----|----------|---------|
| Uniswap V3 | Ethereum, Base | NVDAon/USDC | Quoter合约 |
| PancakeSwap | BNB Chain | NVDAon/USDT | Quoter合约 |
| Raydium | Solana | NVDAx/USDC, SPYx/USDC | Jupiter API / Raydium SDK |
| Robinhood DEX | Robinhood Chain | 美股代币/USDG | 待接入 |

**DEX价格获取方式:**
```javascript
// EVM链 - Uniswap V3 Quoter
const quotedAmount = await quoterContract.quoteExactInputSingle({
  tokenIn: USDC_ADDRESS,
  tokenOut: NVDA_TOKEN_ADDRESS,
  fee: 3000, // 0.3%
  amountIn: parseUnits("100", 6),
  sqrtPriceLimitX96: 0
});

// Solana - Jupiter API
const quote = await fetch(
  `https://quote-api.jup.ag/v6/quote?inputMint=USDC&outputMint=NVDAx&amount=100000000`
);
```

### 3.3 CEX价格

| 交易所 | API | 可获取数据 | 特点 |
|--------|-----|----------|------|
| Kraken | 公开REST API | 60+只美股代币价格、订单簿 | 可提币到链上钱包 |
| Binance | 公开REST API | bStocks价格、交易对 | USDT交易对 |
| Coinbase | 公开REST API | 计划中的美股代币价格 | 非美用户 |

**CEX价格获取方式:**
```javascript
// Kraken
const krakenPrice = await fetch(
  "https://api.kraken.com/0/public/Ticker?pair=NVDAUSD"
);

// Binance
const binancePrice = await fetch(
  "https://api.binance.com/api/v3/ticker/price?symbol=NVDAUSDT"
);
```

### 3.4 基准价格 (Chainlink Oracle)

- **用途**: 作为美股真实价格的参考基准，计算各渠道溢价/折价
- **文档**: https://docs.chain.link/data-feeds/tokenized-equity-feeds
- **支持资产**: SPYon, QQQon, TSLAon, NVDAon, HOODon, GOOGLon
- **更新频率**: 亚秒级 (Data Streams) / 心跳+偏差触发 (Price Feeds)
- **获取方式**: 链上合约直接读取

```javascript
// Chainlink Price Feed
const priceFeed = new Contract(
  CHAINLINK_NVDA_USD_FEED,
  ["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"],
  provider
);
const [, price, , updatedAt,] = await priceFeed.latestRoundData();
```

### 3.5 价格更新策略

| 数据源 | 更新方式 | 缓存时间 |
|--------|---------|---------|
| Chainlink | 链上监听事件 | 实时 |
| Ondo gRPC | 流式推送 | 实时 |
| Backed API | 定时轮询 | 5秒 |
| DEX Quoter | 用户请求时查询 | 不缓存（实时查询） |
| CEX API | 定时轮询 | 3秒 |

---

## 四、核心功能设计

### 4.1 Phase 1 — MVP (信息聚合 + 比价)

#### F1: 美股代币搜索
- 支持股票代码搜索 (NVDA, TSLA, AAPL)
- 支持公司名称搜索 (NVIDIA, Tesla, Apple)
- 搜索建议/自动补全
- 热门股票快捷入口

#### F2: 全渠道比价交易面板

面板顶部提供 **[买入]** / **[卖出]** 两个Tab切换，共用同一套比价框架。

**买入视图：** 用户输入USDC金额，展示各渠道买入价格，按实际成本从低到高排序。
**卖出视图：** 用户输入持有的代币数量，展示各渠道卖出价格，按到手金额从高到低排序。

```
┌─────────────────────────────────────────────────────┐
│  NVDA · NVIDIA Corporation                          │
│  美股实时价格: $135.20 (Chainlink)                    │
│  ─────────────────────────────────────────────────── │
│                                                     │
│  [● 买入]  [○ 卖出]                                  │
│                                                     │
│  排序: 价格最优 ▼    买入金额: [  $100  ]            │
│                                                     │
│  ┌─ 推荐 ─────────────────────────────────────────┐ │
│  │ ① Dinari dNVDA                                 │ │
│  │    价格: $135.05 · 折价 -0.11%                  │ │
│  │    费率: 0.05% · 链: Base                       │ │
│  │    实际成本: $100.07 → 获得 0.7408 dNVDA        │ │
│  │    [平台内交易]  [去Dinari]                      │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ② Raydium NVDAx (Backed)                          │
│     价格: $135.15 · 折价 -0.04%                     │
│     费率: 0.2% · 链: Solana                         │
│     实际成本: $100.20 → 获得 0.7413 NVDAx           │
│     [平台内交易]  [去Raydium]                        │
│                                                     │
│  ③ Kraken xNVDA                                    │
│     价格: $135.18 · 折价 -0.01%                     │
│     费率: 0.1% · 链: Solana/ETH                     │
│     实际成本: $100.10 → 获得 0.7405 xNVDA           │
│     [去Kraken购买] (CEX需跳转)                      │
│                                                     │
│  ④ Ondo NVDAon                                     │
│     价格: $135.22 · 溢价 +0.01%                     │
│     费率: 0.1% · 链: ETH/BNB/SOL                    │
│     实际成本: $100.10 → 获得 0.7401 NVDAon          │
│     [平台内交易]  [去Ondo]                           │
│                                                     │
│  ⑤ Uniswap NVDAon                                 │
│     价格: $135.30 · 溢价 +0.07%                     │
│     费率: 0.3% · 链: Ethereum                       │
│     实际成本: $100.30 → 获得 0.7396 NVDAon          │
│     [平台内交易]  [去Uniswap]                        │
│                                                     │
│  ⑥ Binance bNVDA                                  │
│     价格: $135.25 · 溢价 +0.04%                     │
│     费率: 0.1% · 链: BNB                            │
│     实际成本: $100.10 → 获得 0.7398 bNVDA           │
│     [去Binance购买] (CEX需跳转)                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**卖出视图示例：**
```
┌─────────────────────────────────────────────────────┐
│  NVDA · NVIDIA Corporation                          │
│  美股实时价格: $135.20 (Chainlink)                    │
│  ─────────────────────────────────────────────────── │
│                                                     │
│  [○ 买入]  [● 卖出]                                  │
│                                                     │
│  我持有: [NVDAon ▼]  数量: [ 1.0 ]                   │
│                                                     │
│  ┌─ 推荐 · 到手最多 ──────────────────────────────┐ │
│  │ ① Ondo赎回                                     │ │
│  │    赎回价: $135.20 · 基准价                      │ │
│  │    费率: 0.1% · 赎回方式: 24/7即时               │ │
│  │    到手: $135.07 USDC                           │ │
│  │    [平台内赎回]                                  │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ② Uniswap Swap                                   │
│     卖出价: $135.30 · 溢价 +0.07%                   │
│     费率: 0.3% · 链: Ethereum                       │
│     Gas: ~$0.50                                     │
│     到手: $134.49 USDC                              │
│     [平台内交易]                                     │
│                                                     │
│  ③ PancakeSwap Swap                               │
│     卖出价: $135.18 · 折价 -0.01%                   │
│     费率: 0.25% · 链: BNB Chain                     │
│     Gas: ~$0.05                                     │
│     到手: $134.84 USDC                              │
│     [平台内交易]                                     │
│                                                     │
│  ④ Kraken                                         │
│     卖出价: $135.15                                 │
│     费率: 0.1% · 需先充值到Kraken                    │
│     到手: $135.02 USDC                              │
│     [去Kraken] (需充值+卖出+提现)                    │
│                                                     │
│  💡 提示: 如果您持有的是NVDAx(Backed)，可赎回或      │
│     在Raydium上swap获得更好价格                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**交易方式区分：**

| 渠道类型 | 买入方式 | 卖出方式 | 平台内可完成 |
|---------|---------|---------|------------|
| 发行商(Ondo/Backed/Dinari) | 铸造(Mint) | 赎回(Redeem) | ✅ 调用合约 |
| DEX(Uniswap/Raydium等) | Swap USDC→代币 | Swap 代币→USDC | ✅ 调用Router |
| CEX(Kraken/Binance) | 跳转购买 | 需充值+卖出+提现 | ❌ 需跳转 |

**每个渠道显示:**
- 代币名称 + 发行商
- 当前价格
- vs 美股真实价格的溢价/折价百分比
- 协议费率
- 支持的链
- 买入: 输入金额后的实际成本计算 + 获得代币数量
- 卖出: 输入代币数量后的到手USDC金额
- Gas费预估
- 滑点预估（大额交易时）
- [平台内交易] 按钮（DEX/发行商）或 [跳转] 按钮（CEX）

#### F3: 资产详情页
每只股票一个详情页，包含:
- 美股基本信息（市值、PE、行业）
- 所有链上代币版本对比表
- 各发行商差异对比（KYC要求、分红权、投票权、赎回方式）
- 各渠道历史价格走势
- 溢价/折价历史趋势图

#### F4: 发行商对比功能
```
┌─────────────────────────────────────────────────────┐
│  发行商对比                                          │
│                                                     │
│          │  Ondo    │ Backed  │ Dinari  │ Kraken   │
│  ────────┼──────────┼─────────┼─────────┼──────────│
│  股票数   │  200+    │  168    │  724    │  60+     │
│  KYC     │  不需要   │ 不需要  │ 需要(US)│ 需要     │
│  分红     │  有      │  有     │  有     │  有      │
│  投票权   │  无      │  无     │  无     │  无      │
│  链      │  3条     │  11条   │  6条    │  2条     │
│  费率     │  0.1%   │  0.2%   │  0.05%  │  0.1%   │
│  赎回     │  24/7   │  工作日  │  工作日  │  即时   │
│  最小金额 │  $1     │  $1     │  $1     │  $10    │
│  合规     │  BVI    │  列支    │  US     │  US     │
└─────────────────────────────────────────────────────┘
```

#### F5: 热门排行榜
- 交易量最大的美股代币 Top 20
- 溢价最大的代币（套利机会）
- 折价最大的代币（买入机会）
- 新上线代币

### 4.2 Phase 2 — 交易聚合（买入+卖出）

#### F6: 平台内直接交易（连接钱包后）

用户无需离开平台，直接在比价面板内完成买入和卖出。

**买入流程：**
```
用户输入 $100 买 NVDA → 选择最优渠道 → 连接钱包 → 签名 → 完成
```

**卖出流程：**
```
用户选择持有的代币(如NVDAon) → 输入数量 → 选择最优卖出渠道 → 签名 → USDC到账
```

**三种交易执行方式：**

**方式一：DEX Swap（买入+卖出都支持）**
```javascript
// 买入: USDC → NVDAon (Uniswap)
const buyTx = await swapRouter.exactInputSingle({
  tokenIn: USDC_ADDRESS,
  tokenOut: NVDAon_ADDRESS,
  fee: 3000,
  recipient: userWallet,
  amountIn: parseUnits("100", 6),
  amountOutMinimum: minAmountOut,  // 滑点保护
  sqrtPriceLimitX96: 0
});

// 卖出: NVDAon → USDC (Uniswap)
const sellTx = await swapRouter.exactInputSingle({
  tokenIn: NVDAon_ADDRESS,
  tokenOut: USDC_ADDRESS,
  fee: 3000,
  recipient: userWallet,
  amountIn: userTokenAmount,
  amountOutMinimum: minUSDCOut,    // 滑点保护
  sqrtPriceLimitX96: 0
});

// Solana: Jupiter聚合 (买入+卖出)
const jupiterQuote = await fetch(
  `https://quote-api.jup.ag/v6/quote?` +
  `inputMint=${isBuy ? USDC_MINT : NVDAx_MINT}` +
  `&outputMint=${isBuy ? NVDAx_MINT : USDC_MINT}` +
  `&amount=${amount}&slippageBps=50`
);
const { swapTransaction } = await fetch(
  'https://quote-api.jup.ag/v6/swap',
  { method: 'POST', body: JSON.stringify({ quoteResponse, userPublicKey }) }
);
```

**方式二：发行商铸造/赎回**
```javascript
// 买入(铸造): USDC → 发行商合约 → 获得NVDAon
// 需要先从Ondo API获取铸造attestation
const mintAttestation = await ondoAPI.getMintQuote("NVDAon", amount);
const mintTx = await ondoContract.mint(mintAttestation, usdcAmount);

// 卖出(赎回): NVDAon → 发行商合约 → 获得USDC
const redeemAttestation = await ondoAPI.getRedeemQuote("NVDAon", tokenAmount);
const redeemTx = await ondoContract.redeem(redeemAttestation, tokenAmount);
```

**方式三：CEX（跳转）**
```
平台展示CEX价格供参考 → 用户点击跳转到CEX完成交易
不在平台内执行，但提供价格对比价值
```

**交易前确认弹窗：**
```
┌─────────────────────────────────────────┐
│  确认交易                                │
│                                         │
│  操作: 卖出 NVDAon                       │
│  渠道: Uniswap V3 (Ethereum)            │
│  数量: 1.0 NVDAon                       │
│  预计到手: 134.49 USDC                   │
│  ─────────────────────────────────────  │
│  价格: $135.30                          │
│  协议费: $0.41 (0.3%)                   │
│  Gas费: ~$0.50                          │
│  滑点保护: 0.5%                          │
│  最少到手: $133.82 USDC                  │
│                                         │
│  [确认交易]        [取消]                 │
└─────────────────────────────────────────┘
```

#### F7: 智能路由
- 大额订单自动拆分到多个渠道（买入和卖出均支持）
- 自动选择Gas最低的链
- 跨链交易支持（Base上有USDC → 买Solana上的NVDAx）
- 卖出时自动检测用户钱包中持有哪些美股代币，推荐最优卖出渠道

#### F8: 限价单（买入+卖出）
- 买入限价: "NVDAon折价超过0.5%时自动买入"
- 卖出限价: "NVDAon溢价超过0.3%时自动卖出"
- 止盈止损: 持有的代币涨到$150自动卖出 / 跌到$120自动卖出

### 4.3 Phase 3 — 增值功能

#### F9: 持仓仪表盘
```
┌─────────────────────────────────────────────────────┐
│  我的美股持仓                        总价值: $3,250  │
│  ─────────────────────────────────────────────────── │
│                                                     │
│  NVDA  │ 5.2股 │ $702   │ +12.3%  │ ETH(Ondo)     │
│  TSLA  │ 3.1股 │ $856   │ +5.7%   │ Solana(Backed)│
│  AAPL  │ 4.0股 │ $892   │ +8.1%   │ Base(Dinari)  │
│  SPY   │ 1.5股 │ $800   │ +3.2%   │ Solana(Backed)│
│                                                     │
│  资产分布:  科技 68% │ 指数 32%                       │
│  链分布:   ETH 22% │ SOL 51% │ Base 27%            │
│                                                     │
│  待领取分红: $12.50  [一键领取]                       │
└─────────────────────────────────────────────────────┘
```

#### F10: 定投功能
- 设定定投计划：每周$50买NVDA
- 自动选择当时最优渠道执行
- 定投记录和收益统计

#### F11: 价格提醒
- NVDA跌破$120时通知
- NVDAon折价超过1%时通知
- 支持Telegram/Email/浏览器推送

#### F12: 投资组合模板
- 预设组合："AI龙头5" / "美股大盘" / "高分红股"
- 一键买入整个组合
- 用户可创建和分享自己的组合

#### F13: 套利监控面板
```
┌─────────────────────────────────────────────────────┐
│  套利机会 (实时)                                     │
│                                                     │
│  NVDA │ Dinari $135.05 → Uniswap $135.30            │
│       │ 价差: 0.18% │ 扣除费用后利润: 0.03%           │
│       │ [执行套利]                                    │
│                                                     │
│  TSLA │ Raydium $248.10 → Binance $248.80           │
│       │ 价差: 0.28% │ 扣除费用后利润: 0.08%           │
│       │ [执行套利]                                    │
│                                                     │
│  SPY  │ Backed $562.00 → Kraken $563.50             │
│       │ 价差: 0.27% │ 扣除费用后利润: 0.07%           │
│       │ [执行套利]                                    │
└─────────────────────────────────────────────────────┘
```

---

## 五、页面结构

### 5.1 页面列表

```
/                        首页（搜索 + 热门排行）
/stock/{ticker}          单只股票详情页（如 /stock/NVDA）
/compare                 发行商对比页
/portfolio               持仓仪表盘（需连接钱包）
/dca                     定投管理（需连接钱包）
/arbitrage               套利监控面板
/alerts                  价格提醒管理
/about                   关于我们
```

### 5.2 首页设计

```
┌─────────────────────────────────────────────────────┐
│  [Logo] OnStock                      [连接钱包]      │
├─────────────────────────────────────────────────────┤
│                                                     │
│     链上美股代币全渠道比价 · 最优买卖                   │
│                                                     │
│   ┌─────────────────────────────────────────┐       │
│   │  🔍 搜索股票代码或公司名称...              │       │
│   └─────────────────────────────────────────┘       │
│                                                     │
│   热门: NVDA  TSLA  AAPL  SPY  MSFT  GOOG          │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  实时市场数据                                        │
│                                                     │
│  链上美股总市值: $1.6B    24h交易量: $89M            │
│  活跃代币数: 800+         支持渠道: 12               │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  交易量 Top 10           │    最大折价 (买入机会)     │
│  ─────────────────────── │    ──────────────────── │
│  1. NVDA  $12.3M         │    1. TSLA  -0.35%      │
│  2. TSLA  $8.7M          │    2. MSFT  -0.28%      │
│  3. SPY   $6.2M          │    3. GOOG  -0.22%      │
│  4. AAPL  $4.1M          │    4. META  -0.18%      │
│  5. QQQ   $3.8M          │    5. AMZN  -0.15%      │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  最新套利机会                                        │
│  NVDA: Dinari→Uniswap 价差0.18%                     │
│  TSLA: Raydium→Binance 价差0.28%                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 六、API设计

### 6.1 公开API端点

```
# 资产列表
GET /api/v1/assets
GET /api/v1/assets/{ticker}

# 买入比价
GET /api/v1/prices/{ticker}/buy?amount=100&currency=USDC
GET /api/v1/prices/{ticker}/buy?amount=100&chain=base

# 卖出比价
GET /api/v1/prices/{ticker}/sell?token=NVDAon&amount=1.0
GET /api/v1/prices/{ticker}/sell?token=NVDAx&amount=0.5&chain=solana

# 最优报价（买入+卖出）
GET /api/v1/best-price/{ticker}/buy?amount=100&chain=base
GET /api/v1/best-price/{ticker}/sell?token=NVDAon&amount=1.0

# 交易构建（返回可签名的交易数据）
POST /api/v1/trade/build
  body: { ticker, action: "buy"|"sell", provider, chain, amount, walletAddress, slippageBps }

# 交易状态
GET /api/v1/trade/{txHash}/status

# 用户持仓（需连接钱包）
GET /api/v1/portfolio?wallet=0x...&chains=ethereum,solana,base

# 排行榜
GET /api/v1/rankings/volume
GET /api/v1/rankings/discount
GET /api/v1/rankings/premium

# 套利机会
GET /api/v1/arbitrage

# 历史价格
GET /api/v1/history/{ticker}?period=7d
```

### 6.2 API响应示例

**买入比价:**
```json
// GET /api/v1/prices/NVDA/buy?amount=100
{
  "ticker": "NVDA",
  "company": "NVIDIA Corporation",
  "action": "buy",
  "inputAmount": 100,
  "inputCurrency": "USDC",
  "basePrice": 135.20,
  "basePriceSource": "Chainlink",
  "lastUpdated": "2026-08-10T12:00:00Z",
  "quotes": [
    {
      "provider": "Dinari",
      "type": "issuer",
      "tokenName": "dNVDA",
      "chain": "base",
      "price": 135.05,
      "premiumPercent": -0.11,
      "protocolFee": 0.05,
      "estimatedGas": 0.02,
      "slippage": 0.01,
      "totalCost": 100.08,
      "tokensReceived": 0.7408,
      "tradeMethod": "mint",
      "canTradeInPlatform": true,
      "tradeUrl": "https://app.dinari.com/trade/NVDA",
      "requiresKYC": true,
      "kycRegion": "US only",
      "hasDividends": true,
      "hasVotingRights": false
    },
    {
      "provider": "Raydium",
      "type": "dex",
      "tokenName": "NVDAx",
      "chain": "solana",
      "price": 135.15,
      "premiumPercent": -0.04,
      "protocolFee": 0.20,
      "estimatedGas": 0.001,
      "slippage": 0.05,
      "totalCost": 100.25,
      "tokensReceived": 0.7413,
      "tradeMethod": "swap",
      "canTradeInPlatform": true,
      "tradeUrl": "https://raydium.io/swap",
      "requiresKYC": false,
      "hasDividends": true,
      "hasVotingRights": false
    },
    {
      "provider": "Kraken",
      "type": "cex",
      "tokenName": "xNVDA",
      "chain": "solana",
      "price": 135.18,
      "premiumPercent": -0.01,
      "protocolFee": 0.10,
      "estimatedGas": 0,
      "slippage": 0.02,
      "totalCost": 100.12,
      "tokensReceived": 0.7405,
      "tradeMethod": "cex_redirect",
      "canTradeInPlatform": false,
      "tradeUrl": "https://kraken.com/trade/NVDA",
      "requiresKYC": true,
      "hasDividends": true,
      "hasVotingRights": false
    }
  ]
}
```

**卖出比价:**
```json
// GET /api/v1/prices/NVDA/sell?token=NVDAon&amount=1.0
{
  "ticker": "NVDA",
  "company": "NVIDIA Corporation",
  "action": "sell",
  "inputToken": "NVDAon",
  "inputAmount": 1.0,
  "basePrice": 135.20,
  "basePriceSource": "Chainlink",
  "lastUpdated": "2026-08-10T12:00:00Z",
  "quotes": [
    {
      "provider": "Ondo (Redeem)",
      "type": "issuer",
      "chain": "ethereum",
      "sellPrice": 135.20,
      "premiumPercent": 0,
      "protocolFee": 0.10,
      "estimatedGas": 0.50,
      "slippage": 0,
      "netReceived": 135.07,
      "receiveCurrency": "USDC",
      "tradeMethod": "redeem",
      "canTradeInPlatform": true,
      "redeemAvailability": "24/7",
      "estimatedSettlement": "instant"
    },
    {
      "provider": "Uniswap V3",
      "type": "dex",
      "chain": "ethereum",
      "sellPrice": 135.30,
      "premiumPercent": 0.07,
      "protocolFee": 0.30,
      "estimatedGas": 0.50,
      "slippage": 0.10,
      "netReceived": 134.49,
      "receiveCurrency": "USDC",
      "tradeMethod": "swap",
      "canTradeInPlatform": true,
      "liquidityDepth": "$520,000"
    },
    {
      "provider": "PancakeSwap",
      "type": "dex",
      "chain": "bnb",
      "sellPrice": 135.18,
      "premiumPercent": -0.01,
      "protocolFee": 0.25,
      "estimatedGas": 0.05,
      "slippage": 0.08,
      "netReceived": 134.84,
      "receiveCurrency": "USDC",
      "tradeMethod": "swap",
      "canTradeInPlatform": true,
      "liquidityDepth": "$180,000"
    },
    {
      "provider": "Kraken",
      "type": "cex",
      "chain": "n/a",
      "sellPrice": 135.15,
      "premiumPercent": -0.04,
      "protocolFee": 0.10,
      "estimatedGas": 0,
      "slippage": 0.03,
      "netReceived": 135.02,
      "receiveCurrency": "USD",
      "tradeMethod": "cex_redirect",
      "canTradeInPlatform": false,
      "note": "需先充值到Kraken，卖出后提现"
    }
  ]
}
```

**交易构建:**
```json
// POST /api/v1/trade/build
// Request:
{
  "ticker": "NVDA",
  "action": "sell",
  "provider": "uniswap_v3",
  "chain": "ethereum",
  "inputToken": "NVDAon",
  "amount": 1.0,
  "walletAddress": "0x1234...",
  "slippageBps": 50
}

// Response:
{
  "status": "ready",
  "chain": "ethereum",
  "transactions": [
    {
      "step": 1,
      "type": "approve",
      "description": "授权Uniswap Router使用你的NVDAon",
      "to": "0xNVDAon_CONTRACT",
      "data": "0x095ea7b3...",
      "value": "0"
    },
    {
      "step": 2,
      "type": "swap",
      "description": "卖出 1.0 NVDAon → USDC",
      "to": "0xUNISWAP_ROUTER",
      "data": "0x04e45aaf...",
      "value": "0"
    }
  ],
  "estimatedOutput": 134.49,
  "minimumOutput": 133.82,
  "estimatedGas": "0.50",
  "expiresAt": "2026-08-10T12:05:00Z"
}
```

---

## 七、数据库设计

### 7.1 核心表结构

```sql
-- 股票基本信息
CREATE TABLE stocks (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  sector VARCHAR(100),
  market_cap DECIMAL,
  logo_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 发行商信息
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,          -- Ondo, Backed, Dinari, Kraken...
  type VARCHAR(20) NOT NULL,           -- issuer, dex, cex
  website VARCHAR(500),
  api_base_url VARCHAR(500),
  fee_percent DECIMAL,
  requires_kyc BOOLEAN DEFAULT FALSE,
  kyc_regions TEXT,
  has_dividends BOOLEAN DEFAULT TRUE,
  has_voting_rights BOOLEAN DEFAULT FALSE,
  supported_chains TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- 代币信息（同一只股票在不同发行商/链上的不同版本）
CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER REFERENCES stocks(id),
  provider_id INTEGER REFERENCES providers(id),
  token_name VARCHAR(50) NOT NULL,     -- NVDAon, NVDAx, dNVDA
  chain VARCHAR(50) NOT NULL,          -- ethereum, solana, base, bnb
  contract_address VARCHAR(255),
  decimals INTEGER DEFAULT 18,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(stock_id, provider_id, chain)
);

-- 实时价格快照（定期写入，用于历史分析）
CREATE TABLE price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  token_id INTEGER REFERENCES tokens(id),
  price DECIMAL NOT NULL,
  base_price DECIMAL NOT NULL,         -- Chainlink基准价
  premium_percent DECIMAL,             -- 溢价/折价百分比
  volume_24h DECIMAL,
  liquidity DECIMAL,
  source VARCHAR(50),                  -- api, dex, cex
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- 价格提醒
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255),
  stock_ticker VARCHAR(10),
  alert_type VARCHAR(20),              -- price_below, price_above, discount_above
  target_value DECIMAL,
  is_active BOOLEAN DEFAULT TRUE,
  notification_channel VARCHAR(20),    -- telegram, email, browser
  created_at TIMESTAMP DEFAULT NOW()
);

-- 定投计划
CREATE TABLE dca_plans (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255),
  stock_ticker VARCHAR(10),
  amount_usdc DECIMAL NOT NULL,
  frequency VARCHAR(20),               -- daily, weekly, monthly
  preferred_chain VARCHAR(50),
  auto_best_price BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  next_execution TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 交易记录
CREATE TABLE trades (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  stock_ticker VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,         -- buy, sell
  trade_method VARCHAR(20) NOT NULL,   -- swap, mint, redeem, cex_redirect
  provider VARCHAR(100) NOT NULL,      -- Ondo, Uniswap, Raydium, Kraken...
  chain VARCHAR(50) NOT NULL,
  token_name VARCHAR(50) NOT NULL,     -- NVDAon, NVDAx, dNVDA
  input_amount DECIMAL NOT NULL,       -- 买入:USDC金额 / 卖出:代币数量
  output_amount DECIMAL NOT NULL,      -- 买入:代币数量 / 卖出:USDC到手
  price DECIMAL NOT NULL,              -- 成交价
  base_price DECIMAL,                  -- Chainlink基准价
  premium_percent DECIMAL,             -- 溢价/折价百分比
  protocol_fee DECIMAL,
  gas_fee DECIMAL,
  slippage DECIMAL,
  tx_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, failed
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

-- 限价单
CREATE TABLE limit_orders (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  stock_ticker VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,         -- buy, sell
  token_name VARCHAR(50),              -- 卖出时指定持有的代币
  amount DECIMAL NOT NULL,
  target_price DECIMAL,                -- 目标价格
  target_premium DECIMAL,              -- 或目标溢价/折价百分比
  preferred_chain VARCHAR(50),
  slippage_bps INTEGER DEFAULT 50,
  status VARCHAR(20) DEFAULT 'active', -- active, triggered, cancelled, expired
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  triggered_at TIMESTAMP,
  trade_id BIGINT REFERENCES trades(id)
);
```

---

## 八、价格聚合引擎详细设计

### 8.1 价格采集流程

```
┌─────────────────────────────────────────────────┐
│              PriceAggregator                     │
│                                                 │
│  1. 定时任务（每3-5秒）                           │
│     ├── 拉取 Chainlink 基准价格                   │
│     ├── 拉取 Ondo API 报价                       │
│     ├── 拉取 Backed API 报价                     │
│     ├── 拉取 CEX API 报价                        │
│     └── 写入 Redis 缓存                          │
│                                                 │
│  2. 用户请求时（实时）                             │
│     ├── 从 Redis 读取缓存价格                     │
│     ├── 实时查询 DEX Quoter（按用户输入金额）       │
│     ├── 计算真实成本                              │
│     │   ├── 交易价格                              │
│     │   ├── + 协议费                              │
│     │   ├── + Gas费                              │
│     │   ├── + 滑点                                │
│     │   └── = 实际总成本                          │
│     ├── 按成本排序                                │
│     └── 返回结果                                  │
│                                                 │
│  3. 每分钟                                       │
│     └── 价格快照写入 PostgreSQL（历史数据）         │
└─────────────────────────────────────────────────┘
```

### 8.2 成本计算公式

**买入成本计算:**
```
实际买入成本 = 代币价格 × 数量 + 协议费 + Gas费 + 滑点成本

其中:
- 代币价格: DEX实时报价 或 发行商铸造价
- 协议费: 各发行商费率 × 交易金额
- Gas费: 当前链的Gas价格 × 预估Gas用量
- 滑点: 基于流动性深度和交易金额计算
```

**卖出到手计算:**
```
实际到手金额 = 代币价格 × 数量 - 协议费 - Gas费 - 滑点成本

其中:
- 代币价格: DEX实时报价 或 发行商赎回价
- 协议费: 各渠道费率 × 交易金额
- Gas费: 当前链的Gas价格 × 预估Gas用量
  - Swap: approve + swap 两笔交易的Gas
  - Redeem: 赎回交易的Gas
- 滑点: 基于流动性深度和卖出金额计算（发行商赎回无滑点）
```

**通用公式:**
```
溢价/折价% = (代币价格 - Chainlink基准价) / Chainlink基准价 × 100

买入排序依据: 实际买入成本 从低到高（用户花最少的钱）
卖出排序依据: 实际到手金额 从高到低（用户拿到最多的钱）
```

### 8.3 多链Gas费获取

```javascript
// EVM链 Gas费
const gasPrice = await provider.getGasPrice();
const estimatedGas = 150000n; // swap预估
const gasCostWei = gasPrice * estimatedGas;
const gasCostUSD = ethToUSD(gasCostWei);

// Solana
const priorityFee = await connection.getRecentPrioritizationFees();
const gasCostSOL = 5000 + priorityFee; // lamports
const gasCostUSD = solToUSD(gasCostSOL);
```

---

## 九、商业模式

### 9.1 收入来源

| 收入类型 | 说明 | 预期占比 |
|---------|------|---------|
| 交易手续费 | 通过平台执行交易收取0.1%-0.3% | 50% |
| 推荐佣金 | 发行商Referral Program返佣 | 20% |
| API订阅 | 比价API给第三方DApp使用 | 15% |
| 高级功能 | 定投、套利监控等Pro功能月费 | 15% |

### 9.2 收入预估（保守）

```
假设:
- 日均通过平台交易额: $50,000
- 平均手续费率: 0.15%
- 日收入: $75
- 月收入: $2,250

随用户增长:
- 日交易额 $500,000 → 月收入 $22,500
- 日交易额 $5,000,000 → 月收入 $225,000
```

---

## 十、开发路线图

### Phase 1: MVP (第1-6周)

| 周 | 任务 | 交付物 |
|---|------|-------|
| W1 | 各API/合约可行性验证，搭建项目框架 | 技术验证报告 + 项目骨架 |
| W2 | 后端价格聚合引擎（Ondo + Backed + Chainlink） | 价格API可用 |
| W3 | 接入DEX报价（Uniswap + Raydium） | DEX价格API可用 |
| W4 | 接入CEX报价（Kraken + Binance） | 全渠道价格API完成 |
| W5 | 前端开发（首页 + 搜索 + 比价面板 + 详情页） | 前端可用 |
| W6 | 测试、优化、部署上线 | 产品上线 |

### Phase 2: 交易聚合 (第7-12周)

| 周 | 任务 |
|---|------|
| W7-8 | 钱包连接 + DEX交易集成 |
| W9-10 | 智能路由 + 跨链交易 |
| W11-12 | 限价单 + 交易历史 |

### Phase 3: 增值功能 (第13-20周)

| 周 | 任务 |
|---|------|
| W13-14 | 持仓仪表盘 |
| W15-16 | 定投功能 |
| W17-18 | 套利监控面板 |
| W19-20 | API开放 + 价格提醒 |

---

## 十一、MVP优先级

### 必须有 (Must Have)
- [ ] 股票搜索
- [ ] 多渠道价格展示
- [ ] 溢价/折价计算
- [ ] 实际成本计算（含费率、Gas）
- [ ] 发行商信息对比
- [ ] 跳转到对应平台购买

### 应该有 (Should Have)
- [ ] 热门排行榜
- [ ] 价格历史图表
- [ ] 移动端适配

### 可以有 (Nice to Have)
- [ ] 连接钱包查看持仓
- [ ] 套利机会展示
- [ ] 深色模式

---

## 十二、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| 发行商API变更或关闭 | 中 | 高 | 优先使用链上数据(Chainlink/DEX)，API作为补充 |
| 美股代币市场增长不及预期 | 低 | 高 | MVP成本控制在最低，快速验证 |
| 大平台做类似功能 | 中 | 中 | 专注垂直深度，做大平台不愿做的细节 |
| 合规风险 | 低 | 中 | 只做信息聚合和交易路由，不持有用户资产 |
| 价格数据不准确 | 中 | 高 | 多数据源交叉验证，异常价格标记警告 |

---

## 十三、成功指标

### 上线第一个月
- 日活用户 > 100
- 日均查询次数 > 1,000
- 收录美股代币 > 200只

### 上线三个月
- 日活用户 > 1,000
- 通过平台交易额 > $50,000/天
- API合作伙伴 > 3个

### 上线六个月
- 日活用户 > 5,000
- 通过平台交易额 > $500,000/天
- 成为链上美股代币交易的默认入口
