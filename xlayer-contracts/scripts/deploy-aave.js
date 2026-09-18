const hre = require("hardhat");
const deployment = require("../deployment-xlayerTestnet.json");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying MockAave with:", deployer.address);

  // 1. Deploy MockAavePool
  const MockAavePool = await hre.ethers.getContractFactory("MockAavePool");
  const pool = await MockAavePool.deploy();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("MockAavePool:", poolAddr);

  // 2. Deploy aTokens and register reserves for each xStock
  const MockAToken = await hre.ethers.getContractFactory("MockAToken");

  // Supply APY per asset in ray (1e27 = 100%)
  // e.g. 3.5% = 0.035e27 = 35000000000000000000000000
  const apyConfig = {
    TSLAx:  { apyPct: 3.50 },
    NVDAx:  { apyPct: 3.20 },
    SPYx:   { apyPct: 2.80 },
    AAPLx:  { apyPct: 3.50 },
    GOOGLx: { apyPct: 3.20 },
    METAx:  { apyPct: 3.50 },
    COINx:  { apyPct: 4.80 },
    MSTRx:  { apyPct: 4.50 },
  };

  const aTokens = {};

  for (const [symbol, tokenAddr] of Object.entries(deployment.tokens)) {
    const config = apyConfig[symbol];
    if (!config) continue;

    // Deploy aToken
    const aToken = await MockAToken.deploy(
      `Aave X Layer ${symbol}`,
      `a${symbol}`,
      poolAddr
    );
    await aToken.waitForDeployment();
    const aTokenAddr = await aToken.getAddress();
    aTokens[symbol] = aTokenAddr;

    // Register reserve: APY in ray
    const supplyRateRay = hre.ethers.parseUnits(
      (config.apyPct / 100).toFixed(18),
      27
    );

    const tx = await pool.registerReserve(tokenAddr, aTokenAddr, supplyRateRay);
    await tx.wait();

    console.log(`${symbol}: aToken=${aTokenAddr}, APY=${config.apyPct}%`);
  }

  // 3. Output result
  const result = {
    pool: poolAddr,
    aTokens,
    apyConfig,
  };

  console.log("\n=== MOCK AAVE DEPLOYMENT ===");
  console.log(JSON.stringify(result, null, 2));

  const fs = require("fs");
  fs.writeFileSync(
    "deployment-aave-xlayerTestnet.json",
    JSON.stringify(result, null, 2)
  );
  console.log("\nSaved to deployment-aave-xlayerTestnet.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
