import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

// IDL manually typed since IDL build failed on nightly
const IDL = require("../target/idl/onstock_vault.json");

const VAULT_SEED = Buffer.from("vault");
const RECEIPT_SEED = Buffer.from("receipt");

describe("onstock-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new anchor.Program(IDL, provider);
  const authority = provider.wallet;

  let xstockMint: PublicKey;
  let vaultPda: PublicKey;
  let vaultBump: number;
  let receiptMintPda: PublicKey;
  let vaultXstockAta: PublicKey;
  let userXstockAta: PublicKey;
  let userReceiptAta: PublicKey;
  let userPositionPda: PublicKey;

  const DECIMALS = 6;
  const DEPOSIT_AMOUNT = new BN(10_000_000); // 10 xStock tokens (6 decimals)
  const WITHDRAW_SHARES = new BN(5_000_000); // half

  before(async () => {
    // Create a mock xStock mint
    xstockMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      authority.publicKey,
      null,
      DECIMALS
    );
    console.log("xStock mint:", xstockMint.toBase58());

    // Derive PDAs
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, xstockMint.toBuffer()],
      program.programId
    );
    [receiptMintPda] = PublicKey.findProgramAddressSync(
      [RECEIPT_SEED, xstockMint.toBuffer()],
      program.programId
    );

    // Derive vault xstock ATA
    const { address: vaultAta } = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      xstockMint,
      vaultPda,
      true // allowOwnerOffCurve
    );
    vaultXstockAta = vaultAta;

    // Create user xStock ATA and mint some tokens
    const userAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      xstockMint,
      authority.publicKey
    );
    userXstockAta = userAtaInfo.address;

    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      xstockMint,
      userXstockAta,
      authority.publicKey,
      100_000_000 // 100 tokens
    );
    console.log("Minted 100 xStock to user");

    // Derive user position PDA
    [userPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), vaultPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
  });

  it("initialize_vault", async () => {
    const tx = await program.methods
      .initializeVault(vaultBump)
      .accounts({
        authority: authority.publicKey,
        xstockMint,
        vault: vaultPda,
        receiptMint: receiptMintPda,
        vaultXstockAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("initialize_vault tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(vault.xstockMint.toBase58(), xstockMint.toBase58());
    assert.equal(vault.receiptMint.toBase58(), receiptMintPda.toBase58());
    assert.equal(vault.totalDeposited.toNumber(), 0);
    assert.equal(vault.totalShares.toNumber(), 0);
    console.log("✓ Vault initialized");
  });

  it("deposit — first deposit is 1:1", async () => {
    // Get or create user receipt ATA
    const receiptAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      receiptMintPda,
      authority.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userReceiptAta = receiptAtaInfo.address;

    const tx = await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        user: authority.publicKey,
        vault: vaultPda,
        receiptMint: receiptMintPda,
        userXstockAta,
        vaultXstockAta,
        userReceiptAta,
        userPosition: userPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("deposit tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalDeposited.toNumber(), DEPOSIT_AMOUNT.toNumber());
    assert.equal(vault.totalShares.toNumber(), DEPOSIT_AMOUNT.toNumber()); // 1:1 first deposit

    const receiptBalance = await getAccount(provider.connection, userReceiptAta);
    assert.equal(Number(receiptBalance.amount), DEPOSIT_AMOUNT.toNumber());

    const position = await program.account.userPosition.fetch(userPositionPda);
    assert.equal(position.shares.toNumber(), DEPOSIT_AMOUNT.toNumber());
    console.log("✓ First deposit 1:1 shares minted");
  });

  it("record_yield — increases nav", async () => {
    const yieldAmount = new BN(500_000); // 0.5 tokens yield (5% on 10)

    const tx = await program.methods
      .recordYield(yieldAmount)
      .accounts({
        authority: authority.publicKey,
        vault: vaultPda,
      })
      .rpc();

    console.log("record_yield tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalDeposited.toNumber(), DEPOSIT_AMOUNT.toNumber() + yieldAmount.toNumber());
    console.log("✓ Yield recorded, NAV increased to", vault.totalDeposited.toNumber() / 1e6);
  });

  it("set_strategy", async () => {
    const tx = await program.methods
      .setStrategy({ kaminoSupply: {} })
      .accounts({
        authority: authority.publicKey,
        vault: vaultPda,
      })
      .rpc();

    console.log("set_strategy tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(vault.activeStrategy, { kaminoSupply: {} });
    console.log("✓ Strategy set to KaminoSupply");
  });

  it("withdraw — get back xStock + yield proportionally", async () => {
    const vaultBefore = await program.account.vault.fetch(vaultPda);
    const userXstockBefore = await getAccount(provider.connection, userXstockAta);

    const tx = await program.methods
      .withdraw(WITHDRAW_SHARES)
      .accounts({
        user: authority.publicKey,
        vault: vaultPda,
        receiptMint: receiptMintPda,
        userXstockAta,
        vaultXstockAta,
        userReceiptAta,
        userPosition: userPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("withdraw tx:", tx);

    // Expected: 5M shares / 10M total shares * 10.5M deposited = 5.25M
    const expectedWithdraw = Math.floor(
      (WITHDRAW_SHARES.toNumber() * vaultBefore.totalDeposited.toNumber()) /
        vaultBefore.totalShares.toNumber()
    );
    console.log("Expected withdraw:", expectedWithdraw / 1e6, "xStock (includes yield)");

    const userXstockAfter = await getAccount(provider.connection, userXstockAta);
    const received = Number(userXstockAfter.amount) - Number(userXstockBefore.amount);
    assert.equal(received, expectedWithdraw);
    assert.isAbove(received, WITHDRAW_SHARES.toNumber(), "Should receive more than deposited (yield)");

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalShares.toNumber(), DEPOSIT_AMOUNT.toNumber() - WITHDRAW_SHARES.toNumber());
    console.log("✓ Withdrawal includes yield:", received / 1e6, "xStock for", WITHDRAW_SHARES.toNumber() / 1e6, "shares");
  });

  it("unauthorized set_strategy should fail", async () => {
    const intruder = Keypair.generate();
    // Fund intruder
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .setStrategy({ idle: {} })
        .accounts({
          authority: intruder.publicKey,
          vault: vaultPda,
        })
        .signers([intruder])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
      console.log("✓ Unauthorized rejected");
    }
  });
});
