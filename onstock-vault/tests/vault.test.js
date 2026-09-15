"use strict";
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const web3 = require("@solana/web3.js");
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Keypair } = web3;
const splToken = require("@solana/spl-token");
const assert = require("assert");

const IDL = require("../target/idl/onstock_vault.json");

const VAULT_SEED = Buffer.from("vault");
const RECEIPT_SEED = Buffer.from("receipt");

describe("onstock-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new anchor.Program(IDL, provider);
  const authority = provider.wallet;

  let xstockMint;
  let vaultPda;
  let vaultBump;
  let receiptMintPda;
  let vaultXstockAta;
  let userXstockAta;
  let userReceiptAta;
  let userPositionPda;

  const DECIMALS = 6;
  const DEPOSIT_AMOUNT = new BN(10_000_000); // 10 tokens
  const WITHDRAW_SHARES = new BN(5_000_000);

  before(async () => {
    xstockMint = await splToken.createMint(
      provider.connection,
      provider.wallet.payer,
      authority.publicKey,
      null,
      DECIMALS
    );
    console.log("  xStock mint:", xstockMint.toBase58());

    [vaultPda, vaultBump] = web3.PublicKey.findProgramAddressSync(
      [VAULT_SEED, xstockMint.toBuffer()],
      program.programId
    );
    [receiptMintPda] = web3.PublicKey.findProgramAddressSync(
      [RECEIPT_SEED, xstockMint.toBuffer()],
      program.programId
    );

    // Derive vault xstock ATA address (created by initialize_vault, not here)
    vaultXstockAta = splToken.getAssociatedTokenAddressSync(xstockMint, vaultPda, true);

    const userAtaInfo = await splToken.getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      xstockMint,
      authority.publicKey
    );
    userXstockAta = userAtaInfo.address;

    await splToken.mintTo(
      provider.connection,
      provider.wallet.payer,
      xstockMint,
      userXstockAta,
      authority.publicKey,
      100_000_000
    );

    [userPositionPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), vaultPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );

    console.log("  vault PDA:", vaultPda.toBase58());
    console.log("  receipt mint:", receiptMintPda.toBase58());
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
        tokenProgram: splToken.TOKEN_PROGRAM_ID,
        associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("  tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.strictEqual(vault.authority.toBase58(), authority.publicKey.toBase58());
    assert.strictEqual(vault.totalDeposited.toNumber(), 0);
    assert.strictEqual(vault.totalShares.toNumber(), 0);
    console.log("  ✓ vault initialized");
  });

  it("deposit — first deposit is 1:1", async () => {
    const receiptAtaInfo = await splToken.getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      receiptMintPda,
      authority.publicKey,
      false,
      undefined,
      undefined,
      splToken.TOKEN_PROGRAM_ID
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
        tokenProgram: splToken.TOKEN_PROGRAM_ID,
        associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("  tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.strictEqual(vault.totalDeposited.toNumber(), DEPOSIT_AMOUNT.toNumber());
    assert.strictEqual(vault.totalShares.toNumber(), DEPOSIT_AMOUNT.toNumber());

    const receiptBal = await splToken.getAccount(provider.connection, userReceiptAta);
    assert.strictEqual(Number(receiptBal.amount), DEPOSIT_AMOUNT.toNumber());

    const pos = await program.account.userPosition.fetch(userPositionPda);
    assert.strictEqual(pos.shares.toNumber(), DEPOSIT_AMOUNT.toNumber());
    console.log("  ✓ 1:1 shares minted on first deposit");
  });

  it("record_yield — increases NAV", async () => {
    const yieldAmt = new BN(500_000); // 5% yield

    await program.methods
      .recordYield(yieldAmt)
      .accounts({
        authority: authority.publicKey,
        vault: vaultPda,
      })
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.strictEqual(
      vault.totalDeposited.toNumber(),
      DEPOSIT_AMOUNT.toNumber() + yieldAmt.toNumber()
    );
    console.log("  ✓ NAV =", vault.totalDeposited.toNumber() / 1e6, "xStock");
  });

  it("set_strategy → KaminoSupply", async () => {
    await program.methods
      .setStrategy({ kaminoSupply: {} })
      .accounts({ authority: authority.publicKey, vault: vaultPda })
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.activeStrategy.kaminoSupply !== undefined);
    console.log("  ✓ strategy = KaminoSupply");
  });

  it("withdraw — proportional share of NAV (includes yield)", async () => {
    const vaultBefore = await program.account.vault.fetch(vaultPda);
    const userXstockBefore = await splToken.getAccount(provider.connection, userXstockAta);

    await program.methods
      .withdraw(WITHDRAW_SHARES)
      .accounts({
        user: authority.publicKey,
        vault: vaultPda,
        receiptMint: receiptMintPda,
        userXstockAta,
        vaultXstockAta,
        userReceiptAta,
        userPosition: userPositionPda,
        tokenProgram: splToken.TOKEN_PROGRAM_ID,
        associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    const expectedWithdraw = Math.floor(
      (WITHDRAW_SHARES.toNumber() * vaultBefore.totalDeposited.toNumber()) /
        vaultBefore.totalShares.toNumber()
    );

    const userXstockAfter = await splToken.getAccount(provider.connection, userXstockAta);
    const received = Number(userXstockAfter.amount) - Number(userXstockBefore.amount);
    assert.strictEqual(received, expectedWithdraw);
    assert.ok(received > WITHDRAW_SHARES.toNumber(), "yield included in withdrawal");

    console.log("  ✓ withdrew", received / 1e6, "xStock for", WITHDRAW_SHARES.toNumber() / 1e6, "shares (incl. yield)");
  });

  it("unauthorized set_strategy → rejected", async () => {
    const intruder = web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(intruder.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .setStrategy({ idle: {} })
        .accounts({ authority: intruder.publicKey, vault: vaultPda })
        .signers([intruder])
        .rpc();
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("Unauthorized") || e.message.includes("custom program error"));
      console.log("  ✓ unauthorized rejected");
    }
  });
});
