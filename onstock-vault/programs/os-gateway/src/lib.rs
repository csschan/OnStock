use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("76R7gyAYTFTnKPW3ePx44KTm1AQgRRqQopxTpGxpSy6G");

const GATEWAY_SEED: &[u8] = b"gateway";
const ASSET_SEED: &[u8] = b"asset";

#[program]
pub mod os_gateway {
    use super::*;

    /// Initialize the gateway with USDC mint and keeper authority
    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let gw = &mut ctx.accounts.gateway;
        gw.authority = ctx.accounts.authority.key();
        gw.keeper = ctx.accounts.authority.key();
        gw.usdc_mint = ctx.accounts.usdc_mint.key();
        gw.asset_count = 0;
        gw.bump = bump;
        gw.mint_fee_bps = 10;   // 0.10%
        gw.redeem_fee_bps = 10; // 0.10%
        gw.max_price_age = 3600; // 1 hour

        msg!("OSGateway initialized");
        Ok(())
    }

    /// Register a new stock asset (e.g. TSLA) with its osToken mint
    pub fn register_asset(
        ctx: Context<RegisterAsset>,
        ticker: String,
        _asset_bump: u8,
    ) -> Result<()> {
        require!(ticker.len() <= 10, GatewayError::TickerTooLong);

        let asset = &mut ctx.accounts.asset_info;
        asset.ticker = ticker.clone();
        asset.os_mint = ctx.accounts.os_mint.key();
        asset.price_usd = 0;
        asset.last_price_update = 0;
        asset.market_open = false;
        asset.total_minted = 0;
        asset.total_redeemed = 0;

        let gw = &mut ctx.accounts.gateway;
        gw.asset_count += 1;

        msg!("Asset registered: {} → mint {}", ticker, asset.os_mint);
        Ok(())
    }

    /// Keeper sets oracle price for an asset
    pub fn set_price(
        ctx: Context<SetPrice>,
        _ticker: String,
        price_usd: u64,      // USDC units (6 decimals): $351.50 = 351_500_000
        market_open: bool,
    ) -> Result<()> {
        require!(price_usd > 0, GatewayError::ZeroPrice);
        let gw = &ctx.accounts.gateway;
        require!(
            ctx.accounts.keeper.key() == gw.keeper || ctx.accounts.keeper.key() == gw.authority,
            GatewayError::Unauthorized
        );

        let asset = &mut ctx.accounts.asset_info;
        asset.price_usd = price_usd;
        asset.last_price_update = Clock::get()?.unix_timestamp;
        asset.market_open = market_open;

        msg!("Price updated: {} = ${}", asset.ticker, price_usd as f64 / 1_000_000.0);
        Ok(())
    }

    /// User deposits USDC → receives osToken at oracle price
    pub fn mint_os(ctx: Context<MintOS>, usdc_amount: u64) -> Result<()> {
        require!(usdc_amount > 0, GatewayError::ZeroAmount);

        let asset = &ctx.accounts.asset_info;
        let gw = &ctx.accounts.gateway;
        require!(asset.price_usd > 0, GatewayError::PriceNotSet);

        // Check freshness
        let now = Clock::get()?.unix_timestamp;
        let age = now.saturating_sub(asset.last_price_update);
        require!(
            asset.market_open || age <= (gw.max_price_age as i64),
            GatewayError::PriceStale
        );

        // Fee
        let fee = usdc_amount * (gw.mint_fee_bps as u64) / 10000;
        let net_usdc = usdc_amount - fee;

        // Calculate osToken amount: net_usdc * 1_000_000 / price_usd
        // Both are 6 decimals, so result is in 6 decimal os-token units
        let os_amount = (net_usdc as u128)
            .checked_mul(1_000_000)
            .unwrap()
            .checked_div(asset.price_usd as u128)
            .unwrap() as u64;
        require!(os_amount > 0, GatewayError::AmountTooSmall);

        // Transfer USDC from user to gateway vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc_ata.to_account_info(),
                    to: ctx.accounts.gateway_usdc_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            usdc_amount,
        )?;

        // Mint osToken to user
        let usdc_mint_key = gw.usdc_mint;
        let bump = gw.bump;
        let seeds = &[GATEWAY_SEED, usdc_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.os_mint.to_account_info(),
                    to: ctx.accounts.user_os_ata.to_account_info(),
                    authority: ctx.accounts.gateway.to_account_info(),
                },
                signer_seeds,
            ),
            os_amount,
        )?;

        // Update stats
        let asset = &mut ctx.accounts.asset_info;
        asset.total_minted += os_amount;

        emit!(MintEvent {
            user: ctx.accounts.user.key(),
            ticker: asset.ticker.clone(),
            usdc_in: usdc_amount,
            os_out: os_amount,
            price: asset.price_usd,
            timestamp: now,
        });

        Ok(())
    }

    /// User burns osToken → receives USDC at oracle price
    pub fn redeem_os(ctx: Context<RedeemOS>, os_amount: u64) -> Result<()> {
        require!(os_amount > 0, GatewayError::ZeroAmount);

        let asset = &ctx.accounts.asset_info;
        let gw = &ctx.accounts.gateway;
        require!(asset.price_usd > 0, GatewayError::PriceNotSet);

        // Calculate USDC out: os_amount * price_usd / 1_000_000
        let gross_usdc = (os_amount as u128)
            .checked_mul(asset.price_usd as u128)
            .unwrap()
            .checked_div(1_000_000)
            .unwrap() as u64;
        let fee = gross_usdc * (gw.redeem_fee_bps as u64) / 10000;
        let usdc_out = gross_usdc - fee;
        require!(usdc_out > 0, GatewayError::AmountTooSmall);

        // Burn osToken from user
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.os_mint.to_account_info(),
                    from: ctx.accounts.user_os_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            os_amount,
        )?;

        // Transfer USDC from gateway vault to user
        let usdc_mint_key = gw.usdc_mint;
        let bump = gw.bump;
        let seeds = &[GATEWAY_SEED, usdc_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.gateway_usdc_ata.to_account_info(),
                    to: ctx.accounts.user_usdc_ata.to_account_info(),
                    authority: ctx.accounts.gateway.to_account_info(),
                },
                signer_seeds,
            ),
            usdc_out,
        )?;

        // Update stats
        let asset = &mut ctx.accounts.asset_info;
        asset.total_redeemed += os_amount;

        emit!(RedeemEvent {
            user: ctx.accounts.user.key(),
            ticker: asset.ticker.clone(),
            os_in: os_amount,
            usdc_out,
            price: asset.price_usd,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin: update keeper
    pub fn set_keeper(ctx: Context<AdminAction>, new_keeper: Pubkey) -> Result<()> {
        let gw = &mut ctx.accounts.gateway;
        require!(ctx.accounts.authority.key() == gw.authority, GatewayError::Unauthorized);
        gw.keeper = new_keeper;
        Ok(())
    }
}

// ─── Accounts ───────────────────────────────────────────────────────────────

#[account]
pub struct Gateway {
    pub authority: Pubkey,      // 32
    pub keeper: Pubkey,         // 32
    pub usdc_mint: Pubkey,      // 32
    pub asset_count: u16,       // 2
    pub bump: u8,               // 1
    pub mint_fee_bps: u16,      // 2
    pub redeem_fee_bps: u16,    // 2
    pub max_price_age: u32,     // 4 (seconds)
}

#[account]
pub struct AssetInfo {
    pub ticker: String,         // 4 + 10 = 14
    pub os_mint: Pubkey,        // 32
    pub price_usd: u64,         // 8  (6 decimals)
    pub last_price_update: i64, // 8
    pub market_open: bool,      // 1
    pub total_minted: u64,      // 8
    pub total_redeemed: u64,    // 8
}

// ─── Instruction Contexts ───────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 2 + 1 + 2 + 2 + 4 + 32,
        seeds = [GATEWAY_SEED, usdc_mint.key().as_ref()],
        bump,
    )]
    pub gateway: Account<'info, Gateway>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker: String, asset_bump: u8)]
pub struct RegisterAsset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [GATEWAY_SEED, gateway.usdc_mint.as_ref()], bump = gateway.bump)]
    pub gateway: Account<'info, Gateway>,

    #[account(
        init,
        payer = authority,
        space = 8 + 14 + 32 + 8 + 8 + 1 + 8 + 8 + 32,
        seeds = [ASSET_SEED, gateway.key().as_ref(), ticker.as_bytes()],
        bump,
    )]
    pub asset_info: Account<'info, AssetInfo>,

    /// The osToken mint — must be created beforehand with gateway as mint authority
    pub os_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker: String)]
pub struct SetPrice<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [GATEWAY_SEED, gateway.usdc_mint.as_ref()], bump = gateway.bump)]
    pub gateway: Account<'info, Gateway>,

    #[account(
        mut,
        seeds = [ASSET_SEED, gateway.key().as_ref(), ticker.as_bytes()],
        bump,
    )]
    pub asset_info: Account<'info, AssetInfo>,
}

#[derive(Accounts)]
pub struct MintOS<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [GATEWAY_SEED, gateway.usdc_mint.as_ref()], bump = gateway.bump)]
    pub gateway: Account<'info, Gateway>,

    #[account(
        mut,
        seeds = [ASSET_SEED, gateway.key().as_ref(), asset_info.ticker.as_bytes()],
        bump,
    )]
    pub asset_info: Account<'info, AssetInfo>,

    /// osToken mint (gateway is mint authority)
    #[account(mut, address = asset_info.os_mint)]
    pub os_mint: Account<'info, Mint>,

    /// User's USDC account
    #[account(mut, token::mint = gateway.usdc_mint, token::authority = user)]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    /// Gateway's USDC vault
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = usdc_mint,
        associated_token::authority = gateway,
    )]
    pub gateway_usdc_ata: Account<'info, TokenAccount>,

    /// User's osToken account
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = os_mint,
        associated_token::authority = user,
    )]
    pub user_os_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemOS<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [GATEWAY_SEED, gateway.usdc_mint.as_ref()], bump = gateway.bump)]
    pub gateway: Account<'info, Gateway>,

    #[account(
        mut,
        seeds = [ASSET_SEED, gateway.key().as_ref(), asset_info.ticker.as_bytes()],
        bump,
    )]
    pub asset_info: Account<'info, AssetInfo>,

    #[account(mut, address = asset_info.os_mint)]
    pub os_mint: Account<'info, Mint>,

    #[account(mut, token::mint = gateway.usdc_mint, token::authority = user)]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = gateway)]
    pub gateway_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut, token::mint = os_mint, token::authority = user)]
    pub user_os_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [GATEWAY_SEED, gateway.usdc_mint.as_ref()], bump = gateway.bump)]
    pub gateway: Account<'info, Gateway>,
}

// ─── Events ─────────────────────────────────────────────────────────────────

#[event]
pub struct MintEvent {
    pub user: Pubkey,
    pub ticker: String,
    pub usdc_in: u64,
    pub os_out: u64,
    pub price: u64,
    pub timestamp: i64,
}

#[event]
pub struct RedeemEvent {
    pub user: Pubkey,
    pub ticker: String,
    pub os_in: u64,
    pub usdc_out: u64,
    pub price: u64,
    pub timestamp: i64,
}

// ─── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum GatewayError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Ticker too long (max 10 chars)")]
    TickerTooLong,
    #[msg("Zero price")]
    ZeroPrice,
    #[msg("Price not set")]
    PriceNotSet,
    #[msg("Price is stale and market is closed")]
    PriceStale,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Amount too small after fee")]
    AmountTooSmall,
}
