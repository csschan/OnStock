/**
 * OnStock Vault Keeper
 *
 * 职责：
 * 1. 监听 vault，当有空闲 xStock 时，调用 deploy_to_kamino CPI
 * 2. 定期检查 Kamino kToken 价值增长，调用 redeem_from_kamino 取回收益
 * 3. 更新 vault NAV（record_yield）
 *
 * 使用真实 Kamino SDK 查找 reserve 地址
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { KaminoMarket, KaminoAction, VanillaObligation } from "@kamino-finance/klend-sdk";
import * as fs from "fs";

// ─── Config ────────────────────────────────────────────────────────────────

const VAULT_PROGRAM_ID = new PublicKey("Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx");
const KAMINO_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrL9iPgjlnU1EPa3Cf");

// Kamino mainnet lending market for xStocks
const KAMINO_MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");

// TSLAx mint on mainnet (Backed)
const TSLAX_MINT = new PublicKey("ELgUBeMTZBNNnHLxCdFBVAaMLn2ER9BJE9bvJSiLXmyD");

const VAULT_SEED = Buffer.from("vault");
const DEPLOY_THRESHOLD = 1_000_000; // 1 xStock minimum to deploy
const POLL_INTERVAL_MS = 30_000;    // 30s

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const keypairPath = process.env.KEEPER_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;

  const connection = new Connection(rpcUrl, "confirmed");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(keypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const IDL = JSON.parse(
    fs.readFileSync(__dirname + "/../target/idl/onstock_vault.json", "utf8")
  );
  const program = new anchor.Program(IDL, provider);

  console.log("Keeper started");
  console.log("  Authority:", keypair.publicKey.toBase58());
  console.log("  Vault program:", VAULT_PROGRAM_ID.toBase58());
  console.log("  RPC:", rpcUrl);

  while (true) {
    try {
      await runCycle(connection, program, keypair);
    } catch (e) {
      console.error("Cycle error:", e);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function runCycle(
  connection: Connection,
  program: anchor.Program,
  authority: Keypair
) {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );

  // Load vault state
  let vault: any;
  try {
    vault = await program.account.vault.fetch(vaultPda);
  } catch {
    console.log("Vault not initialized yet, skipping");
    return;
  }

  const idleBalance = vault.totalDeposited.toNumber() - vault.kaminoDeployed.toNumber();
  console.log(
    `[${new Date().toISOString()}] NAV=${vault.totalDeposited.toNumber() / 1e6} ` +
    `deployed=${vault.kaminoDeployed.toNumber() / 1e6} idle=${idleBalance / 1e6}`
  );

  // Load Kamino market to get reserve addresses
  const kaminoMarket = await KaminoMarket.load(
    connection,
    KAMINO_MAIN_MARKET,
    undefined,
    true
  );

  const reserve = kaminoMarket.getReserveByMint(TSLAX_MINT);
  if (!reserve) {
    console.log("No Kamino reserve found for TSLAx");
    return;
  }

  const vaultXstockAta = getAssociatedTokenAddressSync(TSLAX_MINT, vaultPda, true);
  const vaultCollateralAta = getAssociatedTokenAddressSync(
    reserve.state.collateral.mintPubkey,
    vaultPda,
    true
  );

  // ── Deploy idle xStock to Kamino ──────────────────────────────────────
  if (idleBalance >= DEPLOY_THRESHOLD && vault.activeStrategy?.kaminoSupply !== undefined) {
    console.log(`Deploying ${idleBalance / 1e6} TSLAx to Kamino...`);

    const tx = await program.methods
      .deployToKamino(new BN(idleBalance))
      .accounts({
        authority: authority.publicKey,
        vault: vaultPda,
        xstockMint: TSLAX_MINT,
        vaultXstockAta,
        vaultCollateralAta,
        kaminoProgram: KAMINO_PROGRAM_ID,
        kaminoReserve: reserve.address,
        kaminoLendingMarket: KAMINO_MAIN_MARKET,
        kaminoLendingMarketAuthority: reserve.state.lendingMarket,
        kaminoReserveLiquiditySupply: reserve.state.liquidity.supplyVault,
        kaminoReserveCollateralMint: reserve.state.collateral.mintPubkey,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
        liquidityTokenProgram: TOKEN_PROGRAM_ID,
        instructionSysvar: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log(`  ✓ Deployed! tx: ${tx}`);
  }

  // ── Harvest yield: check if kToken value > deployed ──────────────────
  try {
    const collateralAccount = await getAccount(connection, vaultCollateralAta);
    const collateralBalance = Number(collateralAccount.amount);

    if (collateralBalance > 0) {
      // Estimate current value of kTokens
      const exchangeRate = reserve.getEstimatedCollateralExchangeRate();
      const currentValue = Math.floor(collateralBalance / exchangeRate);
      const deployed = vault.kaminoDeployed.toNumber();

      if (currentValue > deployed) {
        const yieldAmount = currentValue - deployed;
        console.log(`Yield accrued: +${yieldAmount / 1e6} TSLAx, updating NAV...`);

        await program.methods
          .recordYield(new BN(yieldAmount))
          .accounts({
            authority: authority.publicKey,
            vault: vaultPda,
          })
          .signers([authority])
          .rpc();

        console.log("  ✓ NAV updated");
      }
    }
  } catch {
    // collateral ATA doesn't exist yet, skip
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);
