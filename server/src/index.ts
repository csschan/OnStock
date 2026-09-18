import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { router } from './api/routes.js'
import { xlayerRouter } from './api/xlayerRoutes.js'
import { runFetchCycle } from './aggregator.js'
import { buildAssetGraph } from './assets/index.js'

const app = express()
const PORT = process.env.PORT || 4000
const FETCH_INTERVAL = Number(process.env.FETCH_INTERVAL_MS) || 30_000

app.use(cors())
app.use(express.json())
app.use('/api', router)
app.use('/api/xlayer', xlayerRouter)

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
})
