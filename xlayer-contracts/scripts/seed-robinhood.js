const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

  // Deploy MockUSDC on Robinhood testnet
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC:", usdcAddr);

  // Seed pool
  const poolAddr = "0xD4c8B27fF7Aa359fB08eF87224ad1f4c20e80c82";
  const seedAmount = hre.ethers.parseUnits("100000", 6);

  await (await usdc.mint(deployer.address, seedAmount)).wait();
  console.log("Minted 100k USDC");

  await (await usdc.approve(poolAddr, seedAmount)).wait();
  console.log("Approved");

  const pool = await hre.ethers.getContractAt("OSPool", poolAddr);
  await (await pool.lpDeposit(seedAmount)).wait();
  console.log("Pool seeded with $100k");

  // Save deployment
  const data = {
    network: "robinhoodTestnet",
    chainId: "46630",
    deployer: deployer.address,
    usdc: usdcAddr,
    gateway: "0x6C1224ef5D09e4Abbe0fbD8430D633980E4953cf",
    pool: poolAddr,
    osTokens: {
      TSLA: "0xa35bEc733819e2d3Bc79d3E46b6281eb3F80B5D3",
      NVDA: "0x7Ace8001A1fFbA17692A68234ABEB9293bB821b5",
      AAPL: "0x6ade7bc80966ed040D1a7A8dFBCF1177649bB871",
      SPY: "0xDD2Ce835da7E7df4067FD2223bAA501aFCA89dC4",
      GOOGL: "0xE7973c6a811814FF33B3D523D846c4564452B7Cc",
      META: "0x571C0751950351F5262E5287817EC955a3a81031",
      COIN: "0x79f5c488e2CCCc34f7DF2AC660b9148854236e11",
      MSTR: "0xabA4d0fcA93977bC76ae8D8BB6CA66202B955B78",
    },
    architecture: "thorchain-pool",
  };
  const deployFile = path.resolve(__dirname, "../deployment-robinhoodTestnet.json");
  fs.writeFileSync(deployFile, JSON.stringify(data, null, 2));
  console.log("Saved to", deployFile);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
