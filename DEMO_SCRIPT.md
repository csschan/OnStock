# OKX X Layer Demo Video Script

**项目**: OnStock — RWA-Aware Smart Execution Suite
**时长**: 4-5 分钟
**录制地址**: http://72.167.42.254:5001

---

## Opening — 30 秒 Hook（0:00 - 0:30）

**画面**: OnStock 首页 Dashboard，价格数据在跳动

**旁白**:

> 代币化股票正在爆发——Tesla、NVIDIA、Apple 都能在链上交易。
> 但现有的 DEX 路由器完全不懂 RWA。
> 1inch 不知道链上价格和真实股价偏离了多少；Paraswap 不知道现在休市还是开市。
>
> OnStock 解决的就是这个问题：业界首个 **RWA 感知智能执行套件**——
> 感知净值偏离、感知市场时序、感知发行风险——部署在 OKX X Layer 上。

---

## Demo 1: Intent Router — RWA 感知路由（0:30 - 1:30）

**操作步骤**:
1. 点击导航栏 **Intent**
2. 选择 Asset: **TSLA**, Amount: **$1000**, Risk: **Medium**, Holding Period: **30d**
3. 点击 **Generate Optimal Route**

**展示重点**:

> 看路由结果——不只是比价格。每条路由都有一个 **RWA Quality Score**。

4. 展开第一条路由（X Layer Vault）→ 指出 **RWA Score: 99**
5. 滚动到 **RWA QUALITY SCORE** 面板 → 展示 5 个维度条：
   - Liquidity 100, Slippage 100, NAV Deviation 100, Freshness 100, Issuer Trust 88

**旁白**:

> X Layer 路由得分最高——因为通过 Oracle 价格铸造，没有 DEX 溢价，没有滑点。
> 这是 1inch 根本看不到的维度。

6. 指出 **NET VALUE PROJECTION** 面板：
   - Entry Cost 0%, Effective In $1000, Yield +$3.45, Gas $0.05, Net $1003.40

> Net Value 面板计算了完整持有成本：入场溢价 + 滑点 + Gas + 30 天收益。
> Solana 路由因为 DEX 溢价，净值只有 $998——差了 $5。
> 这就是为什么路由引擎把 X Layer 排第一。

7. 指出 **RWA RISK CONTEXT** 面板（Market Status / Issuer / Pool Health）

> 每次路由查询都带有 RWA 风险上下文：市场状态、NAV 新鲜度、发行方审计频率、池子深度——
> 这些是代币化证券特有的风险维度，通用路由器完全没有。

---

## Demo 2: X Layer Vault Deposit（1:30 - 2:15）

**操作步骤**:
1. 在 Intent 页面，点击 X Layer 路由的 **Execute on X Layer: Approve + Vault Deposit**
2. OKX Wallet 弹出 Approve 签名 → 确认
3. 等待链上确认（显示 loading spinner）
4. OKX Wallet 弹出 Deposit 签名 → 确认
5. 显示成功 → 点击 OKX Explorer 链接

**旁白**:

> 整个执行在 X Layer 上完成——服务端按 Oracle 价格铸造 TSLAx，
> 然后两次钱包签名：Approve + Vault Deposit。
> 资产存入 ERC4626 标准 Vault，赚取 4.2% APY。
> 点这个链接可以在 OKX Explorer 上查看交易。

---

## Demo 3: Portfolio Builder — 风险感知资产分配（2:15 - 3:15）

**操作步骤**:
1. 点击导航栏 **Portfolio Builder**
2. 默认已选 TSLA 40% / NVDA 30% / SPY 30%，$3000
3. 看 **CROSS-CHAIN ROUTING ENGINE** — 所有资产路由到 X Layer

**旁白**:

> Portfolio Builder 不是简单的批量买入脚本。
> 路由引擎自动把每个资产路由到最优链——现在全部指向 X Layer。

4. 点击 **Simulate Closed** 按钮 → 面板变黄

**旁白**:

> 模拟休市——看到发生了什么？

5. 指出 **RWA RISK-AWARE ALLOCATION** 面板：
   - NAV Freshness 进度条降到 25%
   - Target → Effective Weights: TSLA 40→30%, NVDA 30→23%, SPY 30→23%
   - USDC buffer 25%（$750）

> 系统自动把 25% 资金缓冲到 USDC——因为休市期间 NAV 不更新，
> 开盘可能有跳空风险。不是替用户决定，是把风险从隐性变成显性。

6. 展示三个选择按钮：Accept / Force / Wait
7. 展示 **RISK PARAMETERS** 滑块 → 拖动 **Conservative** / **Aggressive** 预设

> 参数完全透明可调——Conservative 大缓冲，Aggressive 小缓冲。
> 评委可以看到这不是黑盒，每个参数都有明确含义。

8. 点 **Accept risk-adjusted** → Build Portfolio
9. 看 Confirm 面板：Executing $2,250 + USDC Buffer $750

---

## Demo 4: Earn 页面 — Withdraw（3:15 - 3:45）

**操作步骤**:
1. 点击导航栏 **Earn**
2. 看到 X Layer Vaults 在最上面（3 列卡片，和 Solana 完全一致的 UI）
3. 展开 **NVDAx** 卡片 → 看到 Position（Shares, Deposited, NAV/Share, PnL）
4. 点 **Withdraw** tab → 输入数量或点 **MAX** → 点 Withdraw

**旁白**:

> Earn 页面三链统一体验——X Layer、Arbitrum、Solana 用同一套 UI 组件。
> Deposit 和 Withdraw 操作完全一致，不需要学习新界面。

---

## Demo 5: Portfolio — 跨链 NAV（3:45 - 4:05）

**操作步骤**:
1. 点击导航栏 **Portfolio**
2. 看到 **CROSS-CHAIN PORTFOLIO NAV** — 统一显示 EVM + Solana + X Layer 总资产
3. X Layer Vault Positions 在最上面，每个有 Redeem 按钮

**旁白**:

> Portfolio 页面统一管理所有链上资产——一个 NAV 数字覆盖 Solana、X Layer、Arbitrum。
> 点 Redeem 直接跳到 Earn 页的 Withdraw 面板。

---

## Closing — 差异化总结（4:05 - 4:30）

**画面**: 回到 Intent 页面的 RWA Score 面板

**旁白**:

> 总结一下 OnStock 和通用路由器的区别：
>
> 1. **NAV 偏离度检测** — DEX 价格 vs 托管净值，偏离超过 5% 自动警告
> 2. **市场时序感知** — 休市时降级执行，不是停机
> 3. **发行方健康标签** — Ondo 0.92 信任分，PreStocks 0.35，透明展示
> 4. **Net Value 全成本优化** — 入场成本 + 滑点 + Gas + 收益，不只是比 APY
> 5. **风险感知资产分配** — 目标权重 vs 有效权重，USDC 缓冲，可调参数
>
> 所有这些，部署在 OKX X Layer 上，ERC4626 标准，可被任何钱包、DEX、财富管理协议集成。
>
> 别人的路由管"能不能便宜买到"；OnStock 管"现在适不适合买、以多大风险买"。
>
> 谢谢。

---

## 录制注意事项

- **提前准备**: 确保 OKX Wallet 已连接到 X Layer Testnet，地址有 OKB gas + 测试 USDC
- **钱包地址**: 0x1b543d5156535383f33bfcf38cf34990f3a4effe
- **不要展示**: 水龙头、Devnet 标签、报错页面
- **浏览器**: 清除缓存，关闭无关标签页，全屏录制
- **节奏**: 每个 Demo 之间停顿 1-2 秒，让观众消化
- **重点**: 每次展示 RWA Score、Net Value、Risk Parameters 时停留 3-5 秒，让评委看清数字
