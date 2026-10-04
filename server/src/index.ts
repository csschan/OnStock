import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { router } from './api/routes.js'
import { xlayerRouter } from './api/xlayerRoutes.js'
import { arbitrumRouter } from './api/arbitrumRoutes.js'
import { gatewayRouter } from './api/gatewayRoutes.js'
import { bridgeRouter } from './api/bridgeRoutes.js'
import { solGatewayRouter } from './api/solGatewayRoutes.js'
import { robinhoodGatewayRouter } from './api/robinhoodGatewayRoutes.js'
import { runFetchCycle } from './aggregator.js'
import { buildAssetGraph } from './assets/index.js'
import { startBridgeWatcher } from './services/bridgeWatcher.js'

const app = express()
const PORT = process.env.PORT || 4000
const FETCH_INTERVAL = Number(process.env.FETCH_INTERVAL_MS) || 30_000

app.use(cors())
app.use(express.json())
app.use('/api', router)
app.use('/api/xlayer', xlayerRouter)
app.use('/api/arbitrum', arbitrumRouter)
app.use('/api/gateway', gatewayRouter)
app.use('/api/bridge', bridgeRouter)
app.use('/api/sol-gateway', solGatewayRouter)
app.use('/api/rh-gateway', robinhoodGatewayRouter)

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`)
  console.log(`[Server] Fetch interval: ${FETCH_INTERVAL / 1000}s`)

  // 初始化 Asset Graph
  const graph = buildAssetGraph()
  console.log(`[AssetGraph] Initialized: ${graph.size} canonical assets, ${Array.from(graph.values()).reduce((n, a) => n + a.instruments.length, 0)} instruments`)

  // 启动时立刻跑一次
  runFetchCycle().catch(console.error)

  // 之后定时跑
  setInterval(() => {
    runFetchCycle().catch(console.error)
  }, FETCH_INTERVAL)

  // Start cross-chain bridge watcher after 10s delay (ensure dotenv + aggregator ready)
  setTimeout(() => {
    try {
      const fs = require('fs')
      const path = require('path')
      // Use process.cwd() since PM2 cwd = /opt/onstock/server
      const arbFile = path.resolve(process.cwd(), '../xlayer-contracts/deployment-arbitrumSepolia.json')
      const solFile = path.resolve(process.cwd(), '../onstock-vault/gateway-deployment.json')

      const arbDeploy = fs.existsSync(arbFile) ? JSON.parse(fs.readFileSync(arbFile, 'utf8')) : null
      const solDeploy = fs.existsSync(solFile) ? JSON.parse(fs.readFileSync(solFile, 'utf8')) : null
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.XLAYER_DEPLOYER_KEY || ''
      const solKeeperPath = process.env.SOLANA_KEEPER_KEY || path.resolve(process.env.HOME || '', '.config/solana/deploy-keypair.json')

      console.log(`[BridgeWatcher] gateway: ${arbDeploy?.gateway ?? 'NOT FOUND'}`)
      console.log(`[BridgeWatcher] pool: ${arbDeploy?.pool ?? 'NOT FOUND'}`)
      console.log(`[BridgeWatcher] solTokens: ${JSON.stringify(Object.keys(solDeploy?.bridgeOsTokens ?? {}))}`)
      console.log(`[BridgeWatcher] key: ${deployerKey ? 'set' : 'MISSING'}`)
      console.log(`[BridgeWatcher] solKeeper: ${fs.existsSync(solKeeperPath)}`)

      if (arbDeploy?.gateway && deployerKey) {
        startBridgeWatcher({
          arbGateway: arbDeploy.gateway,
          arbPool: arbDeploy.pool,
          arbRpc: 'https://sepolia-rollup.arbitrum.io/rpc',
          solGatewayProgram: solDeploy?.programId ?? '',
          solOsTokens: solDeploy?.bridgeOsTokens || {},
          deployerKey,
          solKeeperPath,
        }).then(() => {
          console.log('[BridgeWatcher] Started successfully')
        }).catch(err => console.error('[BridgeWatcher] Start failed:', err.message))
      } else {
        console.warn('[BridgeWatcher] Skipped — missing gateway or key')
      }
    } catch (err: any) {
      console.error('[BridgeWatcher] Config error:', err.message)
    }
  }, 10_000)
})
