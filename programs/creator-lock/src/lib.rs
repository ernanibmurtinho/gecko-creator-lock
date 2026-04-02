use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("3XBXCwwN5CMGhjnV1CD94exPqPY4mL2LPifdzaowGmhw");

#[program]
pub mod creator_lock {
    use super::*;

    /// Maker initializes the escrow state, creates the vault token account (PDA),
    /// and deposits SPL tokens into it.
    pub fn initialize_and_deposit(ctx: Context<InitializeAndDeposit>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        let escrow = &mut ctx.accounts.escrow_state;
        escrow.maker = ctx.accounts.maker.key();
        escrow.taker = ctx.accounts.taker.key();
        escrow.token_mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.bump = ctx.bumps.escrow_state;
        escrow.vault_bump = ctx.bumps.vault;

        // CPI: transfer tokens from maker ATA → vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.maker_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        msg!("CreatorLock: escrow initialized. Amount: {}", amount);
        Ok(())
    }

    /// Taker calls this to receive the locked funds. Closes the vault and
    /// the escrow state, returning rent to the maker.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &ctx.accounts.escrow_state;
        let amount = escrow.amount;

        let maker_key = escrow.maker;
        let seeds = &[b"escrow", maker_key.as_ref(), &[escrow.bump]];
        let signer_seeds = &[&seeds[..]];

        // CPI: transfer tokens from vault → taker ATA (PDA signer)
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.taker_token_account.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            amount,
        )?;

        // CPI: close the vault token account, return rent to maker
        let close_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        };
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            close_accounts,
            signer_seeds,
        ))?;

        msg!("CreatorLock: funds released to taker. Amount: {}", amount);
        Ok(())
    }

    /// Maker cancels the escrow and reclaims the locked tokens.
    pub fn cancel_and_refund(ctx: Context<CancelAndRefund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow_state;
        let amount = escrow.amount;

        let maker_key = escrow.maker;
        let seeds = &[b"escrow", maker_key.as_ref(), &[escrow.bump]];
        let signer_seeds = &[&seeds[..]];

        // CPI: transfer tokens from vault → maker ATA (PDA signer)
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.maker_token_account.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            amount,
        )?;

        // CPI: close the vault token account, return rent to maker
        let close_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        };
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            close_accounts,
            signer_seeds,
        ))?;

        msg!("CreatorLock: escrow canceled. Tokens refunded to maker.");
        Ok(())
    }
}

// ─── Account Contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeAndDeposit<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    /// CHECK: taker is stored for future validation; no on-chain check needed at init.
    pub taker: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = maker,
        space = 8 + EscrowState::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref()],
        bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// Vault token account owned by the escrow_state PDA.
    #[account(
        init,
        payer = maker,
        token::mint = mint,
        token::authority = escrow_state,
        seeds = [b"vault", escrow_state.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = maker,
    )]
    pub maker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// Required for creating the associated token account in the vault init.
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// The taker signs to claim the funds.
    #[account(mut)]
    pub taker: Signer<'info>,

    /// Rent from closed accounts returns here.
    /// CHECK: validated via has_one on escrow_state.
    #[account(mut)]
    pub maker: UncheckedAccount<'info>,

    #[account(
        mut,
        close = maker,
        has_one = taker @ EscrowError::UnauthorizedTaker,
        has_one = maker @ EscrowError::InvalidMaker,
        has_one = token_mint @ EscrowError::MintMismatch,
        seeds = [b"escrow", maker.key().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", escrow_state.key().as_ref()],
        bump = escrow_state.vault_bump,
        token::mint = token_mint,
        token::authority = escrow_state,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Taker destination token account.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = taker,
    )]
    pub taker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelAndRefund<'info> {
    /// Only the maker can cancel.
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        close = maker,
        has_one = maker @ EscrowError::InvalidMaker,
        has_one = token_mint @ EscrowError::MintMismatch,
        seeds = [b"escrow", maker.key().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", escrow_state.key().as_ref()],
        bump = escrow_state.vault_bump,
        token::mint = token_mint,
        token::authority = escrow_state,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Maker destination for refund.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = maker,
    )]
    pub maker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct EscrowState {
    /// The sponsor who locked the funds.
    pub maker: Pubkey,
    /// The creator who will receive the funds on release.
    pub taker: Pubkey,
    /// The SPL token mint used for this escrow.
    pub token_mint: Pubkey,
    /// Lamport amount of tokens locked.
    pub amount: u64,
    /// Canonical bump for this EscrowState PDA.
    pub bump: u8,
    /// Canonical bump for the vault token account PDA.
    pub vault_bump: u8,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Only the designated taker may release the funds")]
    UnauthorizedTaker,
    #[msg("Maker account mismatch")]
    InvalidMaker,
    #[msg("Token mint does not match the escrow")]
    MintMismatch,
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
}
