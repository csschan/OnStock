use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar,
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;

// Kamino Lending program ID (mainnet + devnet)
pub const KAMINO_LENDING_PROGRAM: &str = "KLend2g3cP87fffoy8q1mQqGKjrL9iPgjlnU1EPa3Cf";

// sha256("global:deposit_reserve_liquidity")[0..8]
const KAMINO_DEPOSIT_DISC: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
// sha256("global:redeem_reserve_collateral")[0..8]
const KAMINO_REDEEM_DISC: [u8; 8] = [152, 93, 211, 27, 43, 224, 186, 6];

declare_id!("Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx");

const VAULT_SEED: &[u8] = b"vault";
const RECEIPT_SEED: &[u8] = b"receipt";

#[program]
pub mod onstock_vault {
    use super::*;

    /// 初始化金库：为某个 xStock mint 创建金库 + receipt token mint
    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.xstock_mint = ctx.accounts.xstock_mint.key();
        vault.receipt_mint = ctx.accounts.receipt_mint.key();
        vault.total_deposited = 0;
        vault.total_shares = 0;
        vault.active_strategy = Strategy::Idle;
        vault.bump = vault_bump;
        vault.created_at = Clock::get()?.unix_timestamp;

        msg!("OnStock Vault initialized for mint: {}", vault.xstock_mint);
        Ok(())
    }

    /// 用户存入 xStock → 获得 receipt token（份额凭证）
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // 计算 receipt shares（首次 1:1，之后按净值比例）
        let shares = if ctx.accounts.vault.total_shares == 0 || ctx.accounts.vault.total_deposited == 0 {
            amount
        } else {
            (amount as u128)
                .checked_mul(ctx.accounts.vault.total_shares as u128)
                .unwrap()
                .checked_div(ctx.accounts.vault.total_deposited as u128)
                .unwrap() as u64
        };
        require!(shares > 0, VaultError::SharesTooSmall);

        // 转入 xStock 到金库
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_xstock_ata.to_account_info(),
                    to: ctx.accounts.vault_xstock_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Mint receipt token 给用户
        let xstock_mint_key = ctx.accounts.vault.xstock_mint;
        let bump = ctx.accounts.vault.bump;
        let seeds = &[VAULT_SEED, xstock_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.receipt_mint.to_account_info(),
                    to: ctx.accounts.user_receipt_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            shares,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();
        vault.total_shares = vault.total_shares.checked_add(shares).unwrap();

        // 记录用户仓位
        let position = &mut ctx.accounts.user_position;
        position.owner = ctx.accounts.user.key();
        position.vault = vault.key();
        position.deposited_amount = position.deposited_amount.checked_add(amount).unwrap();
        position.shares = position.shares.checked_add(shares).unwrap();
        position.deposit_timestamp = Clock::get()?.unix_timestamp;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            vault: vault.key(),
            xstock_mint: vault.xstock_mint,
            amount,
            shares,
            total_deposited: vault.total_deposited,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// 用户提取：burn receipt token → 取回 xStock（含收益）
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        require!(ctx.accounts.vault.total_shares > 0, VaultError::VaultEmpty);

        // withdraw_amount = shares * total_deposited / total_shares
        let withdraw_amount = (shares as u128)
            .checked_mul(ctx.accounts.vault.total_deposited as u128)
            .unwrap()
            .checked_div(ctx.accounts.vault.total_shares as u128)
            .unwrap() as u64;

        require!(withdraw_amount > 0, VaultError::SharesTooSmall);
        require!(
            ctx.accounts.vault_xstock_ata.amount >= withdraw_amount,
            VaultError::InsufficientVaultBalance
        );

        // Burn receipt tokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.receipt_mint.to_account_info(),
                    from: ctx.accounts.user_receipt_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // 从金库转出 xStock 给用户
        let xstock_mint_key = ctx.accounts.vault.xstock_mint;
        let bump = ctx.accounts.vault.bump;
        let seeds = &[VAULT_SEED, xstock_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_xstock_ata.to_account_info(),
                    to: ctx.accounts.user_xstock_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            withdraw_amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposited = vault.total_deposited.checked_sub(withdraw_amount).unwrap();
        vault.total_shares = vault.total_shares.checked_sub(shares).unwrap();

        let position = &mut ctx.accounts.user_position;
        position.deposited_amount = position.deposited_amount.saturating_sub(withdraw_amount);
        position.shares = position.shares.saturating_sub(shares);

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            vault: vault.key(),
            xstock_mint: vault.xstock_mint,
            amount: withdraw_amount,
            shares,
            total_deposited: vault.total_deposited,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin: 设置金库策略
    pub fn set_strategy(ctx: Context<SetStrategy>, strategy: Strategy) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.authority, VaultError::Unauthorized);

        let old = vault.active_strategy.clone();
        vault.active_strategy = strategy.clone();

        emit!(StrategyChangeEvent {
            vault: vault.key(),
            old_strategy: old,
            new_strategy: strategy,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin: 记录收益（keeper bot 执行策略后更新净值）
    pub fn record_yield(ctx: Context<RecordYield>, yield_amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.authority, VaultError::Unauthorized);

        vault.total_deposited = vault.total_deposited.checked_add(yield_amount).unwrap();

        emit!(YieldEvent {
            vault: vault.key(),
            yield_amount,
            new_total: vault.total_deposited,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// ─── 真实 CPI ──────────────────────────────────────────────────────────
    ///
    /// deploy_to_kamino: 把 vault 里的 xStock CPI 存入 Kamino reserve
    ///   xStock (vault ATA) → [CPI Kamino depositReserveLiquidity] → kToken (vault collateral ATA)
    pub fn deploy_to_kamino(ctx: Context<DeployToKamino>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.vault.active_strategy == Strategy::KaminoSupply,
            VaultError::WrongStrategy
        );
        require!(
            ctx.accounts.vault.authority == ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        require!(
            ctx.accounts.vault_xstock_ata.amount >= amount,
            VaultError::InsufficientVaultBalance
        );
        // Runtime verify kamino program ID
        require!(
            ctx.accounts.kamino_program.key().to_string() == KAMINO_LENDING_PROGRAM,
            VaultError::InvalidKaminoProgram
        );

        // Build Kamino depositReserveLiquidity instruction data
        // layout: [discriminator(8)] + [liquidityAmount(8 le)]
        let mut ix_data = KAMINO_DEPOSIT_DISC.to_vec();
        ix_data.extend_from_slice(&amount.to_le_bytes());

        let accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),   // owner = vault PDA (signer)
            AccountMeta::new(ctx.accounts.kamino_reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.xstock_mint.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.vault_xstock_ata.key(), false),          // userSourceLiquidity
            AccountMeta::new(ctx.accounts.vault_collateral_ata.key(), false),      // userDestinationCollateral
            AccountMeta::new_readonly(ctx.accounts.collateral_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.liquidity_token_program.key(), false),
            AccountMeta::new_readonly(sysvar::instructions::id(), false),
        ];

        let ix = Instruction {
            program_id: ctx.accounts.kamino_program.key(),
            accounts,
            data: ix_data,
        };

        let xstock_mint_key = ctx.accounts.vault.xstock_mint;
        let bump = ctx.accounts.vault.bump;
        let seeds = &[VAULT_SEED, xstock_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.kamino_reserve.to_account_info(),
                ctx.accounts.kamino_lending_market.to_account_info(),
                ctx.accounts.kamino_lending_market_authority.to_account_info(),
                ctx.accounts.xstock_mint.to_account_info(),
                ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
                ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
                ctx.accounts.vault_xstock_ata.to_account_info(),
                ctx.accounts.vault_collateral_ata.to_account_info(),
                ctx.accounts.collateral_token_program.to_account_info(),
                ctx.accounts.liquidity_token_program.to_account_info(),
                ctx.accounts.instruction_sysvar.to_account_info(),
            ],
            signer_seeds,
        )?;

        // Track deployed amount for NAV calculation
        let vault = &mut ctx.accounts.vault;
        vault.kamino_deployed = vault.kamino_deployed.checked_add(amount).unwrap();
        // Reduce idle balance in NAV (NAV stays same, just re-classified as deployed)

        emit!(KaminoDeployEvent {
            vault: vault.key(),
            amount,
            total_deployed: vault.kamino_deployed,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// redeem_from_kamino: 把 kToken CPI 赎回给 Kamino，取回 xStock
    ///   kToken (vault collateral ATA) → [CPI Kamino redeemReserveCollateral] → xStock (vault ATA)
    pub fn redeem_from_kamino(ctx: Context<RedeemFromKamino>, collateral_amount: u64) -> Result<()> {
        require!(collateral_amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.vault.authority == ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        require!(
            ctx.accounts.kamino_program.key().to_string() == KAMINO_LENDING_PROGRAM,
            VaultError::InvalidKaminoProgram
        );

        let mut ix_data = KAMINO_REDEEM_DISC.to_vec();
        ix_data.extend_from_slice(&collateral_amount.to_le_bytes());

        let accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),   // owner = vault PDA
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.xstock_mint.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.vault_collateral_ata.key(), false),       // userSourceCollateral
            AccountMeta::new(ctx.accounts.vault_xstock_ata.key(), false),           // userDestinationLiquidity
            AccountMeta::new_readonly(ctx.accounts.collateral_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.liquidity_token_program.key(), false),
            AccountMeta::new_readonly(sysvar::instructions::id(), false),
        ];

        let ix = Instruction {
            program_id: ctx.accounts.kamino_program.key(),
            accounts,
            data: ix_data,
        };

        let xstock_mint_key = ctx.accounts.vault.xstock_mint;
        let bump = ctx.accounts.vault.bump;
        let seeds = &[VAULT_SEED, xstock_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        // Record xstock balance before redeem to measure yield
        let xstock_before = ctx.accounts.vault_xstock_ata.amount;

        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.kamino_lending_market.to_account_info(),
                ctx.accounts.kamino_reserve.to_account_info(),
                ctx.accounts.kamino_lending_market_authority.to_account_info(),
                ctx.accounts.xstock_mint.to_account_info(),
                ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
                ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
                ctx.accounts.vault_collateral_ata.to_account_info(),
                ctx.accounts.vault_xstock_ata.to_account_info(),
                ctx.accounts.collateral_token_program.to_account_info(),
                ctx.accounts.liquidity_token_program.to_account_info(),
                ctx.accounts.instruction_sysvar.to_account_info(),
            ],
            signer_seeds,
        )?;

        // Reload xstock ATA after CPI
        ctx.accounts.vault_xstock_ata.reload()?;
        let xstock_after = ctx.accounts.vault_xstock_ata.amount;
        let redeemed = xstock_after.saturating_sub(xstock_before);

        // If redeemed > deployed → yield accrued → update NAV
        let vault = &mut ctx.accounts.vault;
        let deployed_portion = vault.kamino_deployed.min(redeemed);
        if redeemed > deployed_portion {
            let yield_amount = redeemed - deployed_portion;
            vault.total_deposited = vault.total_deposited.checked_add(yield_amount).unwrap();
        }
        vault.kamino_deployed = vault.kamino_deployed.saturating_sub(deployed_portion);

        emit!(KaminoRedeemEvent {
            vault: vault.key(),
            collateral_amount,
            xstock_redeemed: redeemed,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ─── 策略枚举 ─────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Strategy {
    Idle,
    KaminoSupply,
    RaydiumLp,
    NestUsdCdp,
    DeltaNeutral,
}

// ─── 账户结构 ─────────────────────────────────────

#[account]
pub struct Vault {
    pub authority: Pubkey,       // 32
    pub xstock_mint: Pubkey,     // 32
    pub receipt_mint: Pubkey,    // 32
    pub total_deposited: u64,    // 8  — total NAV (idle + deployed)
    pub total_shares: u64,       // 8
    pub active_strategy: Strategy, // 2
    pub bump: u8,                // 1
    pub created_at: i64,         // 8
    pub kamino_deployed: u64,    // 8  — amount currently in Kamino
}

#[account]
pub struct UserPosition {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub deposited_amount: u64,
    pub shares: u64,
    pub deposit_timestamp: i64,
}

// ─── 指令上下文 ───────────────────────────────────

#[derive(Accounts)]
#[instruction(vault_bump: u8)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub xstock_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 2 + 1 + 8 + 8 + 32,
        seeds = [VAULT_SEED, xstock_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 6,
        mint::authority = vault,
        seeds = [RECEIPT_SEED, xstock_mint.key().as_ref()],
        bump,
    )]
    pub receipt_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = xstock_mint,
        associated_token::authority = vault,
    )]
    pub vault_xstock_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut, address = vault.receipt_mint)]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = vault.xstock_mint, associated_token::authority = user)]
    pub user_xstock_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = vault.xstock_mint, associated_token::authority = vault)]
    pub vault_xstock_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed, payer = user,
        associated_token::mint = receipt_mint,
        associated_token::authority = user,
    )]
    pub user_receipt_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed, payer = user,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 16,
        seeds = [b"position", vault.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_position: Box<Account<'info, UserPosition>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut, address = vault.receipt_mint)]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = vault.xstock_mint, associated_token::authority = user)]
    pub user_xstock_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = vault.xstock_mint, associated_token::authority = vault)]
    pub vault_xstock_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = receipt_mint, associated_token::authority = user)]
    pub user_receipt_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [b"position", vault.key().as_ref(), user.key().as_ref()], bump)]
    pub user_position: Box<Account<'info, UserPosition>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetStrategy<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct RecordYield<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

/// 部署到 Kamino 的账户列表
#[derive(Accounts)]
pub struct DeployToKamino<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    /// xStock mint
    pub xstock_mint: Box<Account<'info, Mint>>,

    /// vault 持有的 xStock（资金来源）
    #[account(mut, associated_token::mint = xstock_mint, associated_token::authority = vault)]
    pub vault_xstock_ata: Box<Account<'info, TokenAccount>>,

    /// vault 持有的 kToken（Kamino 给的收据）
    #[account(
        init_if_needed, payer = authority,
        associated_token::mint = kamino_reserve_collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    // ─── Kamino 账户 ────────────────────────────────
    /// CHECK: Kamino program (verified by address constraint)
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: Kamino reserve state account (passed by caller, verified by Kamino)
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: Kamino lending market (verified by Kamino)
    pub kamino_lending_market: UncheckedAccount<'info>,

    /// CHECK: Kamino lending market authority PDA (verified by Kamino)
    pub kamino_lending_market_authority: UncheckedAccount<'info>,

    /// Kamino reserve liquidity supply (where xStock sits inside Kamino)
    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Box<Account<'info, TokenAccount>>,

    /// Kamino kToken mint (collateral mint)
    #[account(mut)]
    pub kamino_reserve_collateral_mint: Box<Account<'info, Mint>>,

    pub collateral_token_program: Program<'info, Token>,
    pub liquidity_token_program: Program<'info, Token>,

    /// CHECK: Sysvar instructions
    pub instruction_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// 从 Kamino 赎回的账户列表
#[derive(Accounts)]
pub struct RedeemFromKamino<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED, vault.xstock_mint.as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    pub xstock_mint: Box<Account<'info, Mint>>,

    /// vault 持有的 xStock（赎回目标）
    #[account(mut, associated_token::mint = xstock_mint, associated_token::authority = vault)]
    pub vault_xstock_ata: Box<Account<'info, TokenAccount>>,

    /// vault 持有的 kToken（赎回来源）
    #[account(mut, associated_token::mint = kamino_reserve_collateral_mint, associated_token::authority = vault)]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    // ─── Kamino 账户 ────────────────────────────────
    /// CHECK: Kamino program (verified at runtime in instruction)
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: Kamino reserve state (verified by Kamino)
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: Kamino lending market (verified by Kamino)
    pub kamino_lending_market: UncheckedAccount<'info>,

    /// CHECK: Kamino lending market authority (verified by Kamino)
    pub kamino_lending_market_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub kamino_reserve_collateral_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Box<Account<'info, TokenAccount>>,

    pub collateral_token_program: Program<'info, Token>,
    pub liquidity_token_program: Program<'info, Token>,

    /// CHECK: Sysvar instructions
    pub instruction_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─── 事件 ─────────────────────────────────────────

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub xstock_mint: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub xstock_mint: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct StrategyChangeEvent {
    pub vault: Pubkey,
    pub old_strategy: Strategy,
    pub new_strategy: Strategy,
    pub timestamp: i64,
}

#[event]
pub struct YieldEvent {
    pub vault: Pubkey,
    pub yield_amount: u64,
    pub new_total: u64,
    pub timestamp: i64,
}

#[event]
pub struct KaminoDeployEvent {
    pub vault: Pubkey,
    pub amount: u64,
    pub total_deployed: u64,
    pub timestamp: i64,
}

#[event]
pub struct KaminoRedeemEvent {
    pub vault: Pubkey,
    pub collateral_amount: u64,
    pub xstock_redeemed: u64,
    pub timestamp: i64,
}

// ─── 错误码 ───────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Calculated shares too small")]
    SharesTooSmall,
    #[msg("Vault has no deposits")]
    VaultEmpty,
    #[msg("Insufficient balance in vault")]
    InsufficientVaultBalance,
    #[msg("Unauthorized: not vault authority")]
    Unauthorized,
    #[msg("Wrong strategy: set strategy to KaminoSupply first")]
    WrongStrategy,
    #[msg("Invalid Kamino program ID")]
    InvalidKaminoProgram,
}
