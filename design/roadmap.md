# 开发路线图

## Phase 1: MVP — 比价聚合 (第1-6周)

### 第1周: 技术验证 + 项目搭建
- [ ] 测试Ondo API连通性和响应格式
- [ ] 测试Backed xStocks API (https://api.xstocks.fi/api/v2/public/assets)
- [ ] 测试Chainlink Price Feed读取
- [ ] 测试Uniswap Quoter合约调用
- [ ] 测试Jupiter API调用
- [ ] 测试Kraken/Binance公开API
- [ ] 搭建Next.js + Express项目骨架
- [ ] 配置PostgreSQL + Redis
- [ ] 配置多链RPC (Alchemy/Helius)

### 第2周: 后端 — 价格聚合引擎 (发行商)
- [ ] 实现OndoFetcher (API + gRPC)
- [ ] 实现BackedFetcher (xStocks API)
- [ ] 实现DinariFetcher
- [ ] 实现ChainlinkFetcher (链上Oracle)
- [ ] 实现Redis缓存层
- [ ] 实现定时采集任务 (每3-5秒)
- [ ] 实现价格快照定时写入PG (每分钟)

### 第3周: 后端 — DEX报价接入
- [ ] 实现UniswapFetcher (EVM链Quoter)
- [ ] 实现JupiterFetcher (Solana)
- [ ] 实现PancakeFetcher (BNB Chain)
- [ ] 实现CostCalculator (买入成本 + 卖出到手)
- [ ] 实现GasEstimator (多链Gas)
- [ ] 实现SlippageCalculator

### 第4周: 后端 — CEX + API完成
- [ ] 实现KrakenFetcher
- [ ] 实现BinanceFetcher
- [ ] 完成买入比价API: GET /api/v1/prices/{ticker}/buy
- [ ] 完成卖出比价API: GET /api/v1/prices/{ticker}/sell
- [ ] 完成资产列表API: GET /api/v1/assets
- [ ] 完成排行榜API: GET /api/v1/rankings
- [ ] API测试和优化

### 第5周: 前端开发
- [ ] 首页 (搜索 + 热门排行 + 市场数据)
- [ ] 股票详情页 + 买入/卖出比价面板
- [ ] 发行商对比页
- [ ] 钱包连接 (EVM + Solana)
- [ ] 移动端适配

### 第6周: 测试 + 上线
- [ ] 端到端测试
- [ ] 价格准确性验证
- [ ] 性能优化 (API响应<500ms)
- [ ] 部署到Vercel (前端) + VPS (后端)
- [ ] 域名配置
- [ ] 上线发布

**Phase 1交付物:**
- 可用的比价网站
- 支持搜索、买入/卖出比价、发行商对比
- 覆盖3个发行商 + 3个DEX + 2个CEX

---

## Phase 2: 交易聚合 (第7-12周)

### 第7-8周: 平台内交易 — 买入
- [ ] DEX Swap买入 (Uniswap/Jupiter/PancakeSwap)
- [ ] 发行商铸造买入 (Ondo/Backed)
- [ ] ERC20 Approve流程
- [ ] 交易确认弹窗
- [ ] 交易状态追踪
- [ ] 交易记录存储

### 第9-10周: 平台内交易 — 卖出
- [ ] DEX Swap卖出
- [ ] 发行商赎回
- [ ] 自动检测用户持有的美股代币
- [ ] 卖出最优渠道推荐

### 第11-12周: 智能路由 + 限价单
- [ ] 大额订单拆分
- [ ] 跨链交易支持
- [ ] 限价买入/卖出
- [ ] 止盈止损

**Phase 2交付物:**
- 平台内直接买入/卖出
- 智能路由
- 限价单和止盈止损

---

## Phase 3: 增值功能 (第13-20周)

### 第13-14周: 持仓仪表盘
- [ ] 跨链美股持仓扫描
- [ ] 统一持仓视图
- [ ] 盈亏计算
- [ ] 分红追踪

### 第15-16周: 定投功能
- [ ] 定投计划创建/管理
- [ ] 自动最优价格执行
- [ ] 定投记录和收益统计

### 第17-18周: 套利监控
- [ ] 实时价差检测
- [ ] 套利机会面板
- [ ] 套利利润计算(扣除所有费用)
- [ ] 提醒通知

### 第19-20周: API开放 + 通知
- [ ] 公开API (比价API给第三方)
- [ ] 价格提醒 (Telegram Bot)
- [ ] 邮件通知

**Phase 3交付物:**
- 持仓管理
- 定投功能
- 套利监控
- 开放API

---

## 里程碑

| 时间 | 里程碑 | 关键指标 |
|------|--------|---------|
| 第6周 | MVP上线 | 网站可访问, 比价可用 |
| 第8周 | 首笔平台内交易 | 交易流程跑通 |
| 第12周 | 完整交易功能 | 买入+卖出+限价单 |
| 第16周 | 持仓+定投上线 | 用户留存功能 |
| 第20周 | 全功能上线 | API开放, 套利监控 |
