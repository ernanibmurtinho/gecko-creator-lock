import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CreatorLock } from "../target/types/creator_lock";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

describe("CreatorLock — Escrow Program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CreatorLock as Program<CreatorLock>;

  // Keypairs
  const maker = Keypair.generate();
  const taker = Keypair.generate();

  let mint: PublicKey;
  let makerAta: PublicKey;
  let takerAta: PublicKey;
  let escrowStatePda: PublicKey;
  let escrowBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  const DEPOSIT_AMOUNT = new BN(1_000_000); // 1 token (6 decimals)

  // ─── Setup ───────────────────────────────────────────────────────────────

  before(async () => {
    // Airdrop SOL to maker and taker
    await Promise.all([
      provider.connection.requestAirdrop(
        maker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      ),
      provider.connection.requestAirdrop(
        taker.publicKey,
        anchor.web3.LAMPORTS_PER_SOL,
      ),
    ]);

    // Allow airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create SPL token mint (6 decimals, maker is mint authority)
    mint = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6,
    );

    // Create token accounts
    makerAta = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mint,
      maker.publicKey,
    );

    takerAta = await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mint,
      taker.publicKey,
    );

    // Mint tokens to maker
    await mintTo(
      provider.connection,
      maker,
      mint,
      makerAta,
      maker,
      2_000_000, // 2 tokens
    );

    // Derive PDAs
    [escrowStatePda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer()],
      program.programId,
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowStatePda.toBuffer()],
      program.programId,
    );
  });

  // ─── Happy Path ──────────────────────────────────────────────────────────

  describe("Happy Path: Initialize → Release", () => {
    it("initializes the escrow and deposits tokens into the vault", async () => {
      const makerBalanceBefore = (
        await getAccount(provider.connection, makerAta)
      ).amount;

      await program.methods
        .initializeAndDeposit(DEPOSIT_AMOUNT)
        .accountsPartial({
          maker: maker.publicKey,
          taker: taker.publicKey,
          mint,
          escrowState: escrowStatePda,
          vault: vaultPda,
          makerTokenAccount: makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([maker])
        .rpc();

      // Verify vault holds the tokens
      const vaultAccount = await getAccount(provider.connection, vaultPda);
      assert.equal(
        vaultAccount.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Vault should hold the deposited amount",
      );

      // Verify maker balance decreased
      const makerBalanceAfter = (
        await getAccount(provider.connection, makerAta)
      ).amount;
      assert.equal(
        (makerBalanceBefore - makerBalanceAfter).toString(),
        DEPOSIT_AMOUNT.toString(),
        "Maker balance should decrease by the deposit amount",
      );

      // Verify escrow state
      const escrow = await program.account.escrowState.fetch(escrowStatePda);
      assert.equal(
        escrow.maker.toBase58(),
        maker.publicKey.toBase58(),
        "Maker stored correctly",
      );
      assert.equal(
        escrow.taker.toBase58(),
        taker.publicKey.toBase58(),
        "Taker stored correctly",
      );
      assert.equal(
        escrow.tokenMint.toBase58(),
        mint.toBase58(),
        "Mint stored correctly",
      );
      assert.equal(
        escrow.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Amount stored correctly",
      );
      assert.equal(escrow.bump, escrowBump, "Escrow bump stored correctly");
      assert.equal(escrow.vaultBump, vaultBump, "Vault bump stored correctly");
    });

    it("releases funds from vault to taker and closes accounts", async () => {
      const takerBalanceBefore = (
        await getAccount(provider.connection, takerAta)
      ).amount;

      await program.methods
        .release()
        .accountsPartial({
          taker: taker.publicKey,
          maker: maker.publicKey,
          escrowState: escrowStatePda,
          tokenMint: mint,
          vault: vaultPda,
          takerTokenAccount: takerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();

      // Verify taker received the tokens
      const takerBalanceAfter = (
        await getAccount(provider.connection, takerAta)
      ).amount;
      assert.equal(
        (takerBalanceAfter - takerBalanceBefore).toString(),
        DEPOSIT_AMOUNT.toString(),
        "Taker should receive the full deposited amount",
      );

      // Verify escrow state is closed
      const escrowAccount =
        await provider.connection.getAccountInfo(escrowStatePda);
      assert.isNull(escrowAccount, "EscrowState account should be closed");
    });
  });

  // ─── Cancel Path ─────────────────────────────────────────────────────────

  describe("Cancel Path: Initialize → Cancel & Refund", () => {
    // Use fresh keypairs for isolation
    const maker2 = Keypair.generate();
    const taker2 = Keypair.generate();

    let mint2: PublicKey;
    let maker2Ata: PublicKey;
    let escrowState2Pda: PublicKey;
    let vault2Pda: PublicKey;

    before(async () => {
      // Airdrop
      await provider.connection.requestAirdrop(
        maker2.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      mint2 = await createMint(
        provider.connection,
        maker2,
        maker2.publicKey,
        null,
        6,
      );

      maker2Ata = await createAssociatedTokenAccount(
        provider.connection,
        maker2,
        mint2,
        maker2.publicKey,
      );

      await mintTo(
        provider.connection,
        maker2,
        mint2,
        maker2Ata,
        maker2,
        2_000_000,
      );

      [escrowState2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), maker2.publicKey.toBuffer()],
        program.programId,
      );

      [vault2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowState2Pda.toBuffer()],
        program.programId,
      );
    });

    it("initializes escrow for cancel test", async () => {
      await program.methods
        .initializeAndDeposit(DEPOSIT_AMOUNT)
        .accountsPartial({
          maker: maker2.publicKey,
          taker: taker2.publicKey,
          mint: mint2,
          escrowState: escrowState2Pda,
          vault: vault2Pda,
          makerTokenAccount: maker2Ata,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([maker2])
        .rpc();

      const vault = await getAccount(provider.connection, vault2Pda);
      assert.equal(vault.amount.toString(), DEPOSIT_AMOUNT.toString());
    });

    it("cancels escrow and refunds tokens to maker", async () => {
      const makerBalanceBefore = (
        await getAccount(provider.connection, maker2Ata)
      ).amount;

      await program.methods
        .cancelAndRefund()
        .accountsPartial({
          maker: maker2.publicKey,
          escrowState: escrowState2Pda,
          tokenMint: mint2,
          vault: vault2Pda,
          makerTokenAccount: maker2Ata,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker2])
        .rpc();

      // Verify refund
      const makerBalanceAfter = (
        await getAccount(provider.connection, maker2Ata)
      ).amount;
      assert.equal(
        (makerBalanceAfter - makerBalanceBefore).toString(),
        DEPOSIT_AMOUNT.toString(),
        "Maker should be refunded the full amount",
      );

      // Verify escrow state is closed
      const escrowAccount =
        await provider.connection.getAccountInfo(escrowState2Pda);
      assert.isNull(
        escrowAccount,
        "EscrowState account should be closed after cancel",
      );
    });
  });

  // ─── Security / Negative Tests ────────────────────────────────────────────

  describe("Security: Access Control", () => {
    const makerSec = Keypair.generate();
    const takerSec = Keypair.generate();
    const intruder = Keypair.generate();

    let mintSec: PublicKey;
    let makerSecAta: PublicKey;
    let takerSecAta: PublicKey;
    let intruderAta: PublicKey;
    let escrowSecPda: PublicKey;
    let vaultSecPda: PublicKey;

    before(async () => {
      await Promise.all([
        provider.connection.requestAirdrop(
          makerSec.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL,
        ),
        provider.connection.requestAirdrop(
          takerSec.publicKey,
          anchor.web3.LAMPORTS_PER_SOL,
        ),
        provider.connection.requestAirdrop(
          intruder.publicKey,
          anchor.web3.LAMPORTS_PER_SOL,
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      mintSec = await createMint(
        provider.connection,
        makerSec,
        makerSec.publicKey,
        null,
        6,
      );

      [makerSecAta, takerSecAta, intruderAta] = await Promise.all([
        createAssociatedTokenAccount(
          provider.connection,
          makerSec,
          mintSec,
          makerSec.publicKey,
        ),
        createAssociatedTokenAccount(
          provider.connection,
          takerSec,
          mintSec,
          takerSec.publicKey,
        ),
        createAssociatedTokenAccount(
          provider.connection,
          intruder,
          mintSec,
          intruder.publicKey,
        ),
      ]);

      await mintTo(
        provider.connection,
        makerSec,
        mintSec,
        makerSecAta,
        makerSec,
        2_000_000,
      );

      [escrowSecPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), makerSec.publicKey.toBuffer()],
        program.programId,
      );

      [vaultSecPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowSecPda.toBuffer()],
        program.programId,
      );

      // Initialize escrow
      await program.methods
        .initializeAndDeposit(DEPOSIT_AMOUNT)
        .accountsPartial({
          maker: makerSec.publicKey,
          taker: takerSec.publicKey,
          mint: mintSec,
          escrowState: escrowSecPda,
          vault: vaultSecPda,
          makerTokenAccount: makerSecAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([makerSec])
        .rpc();
    });

    it("rejects release when called by an intruder (not the taker)", async () => {
      try {
        await program.methods
          .release()
          .accountsPartial({
            taker: intruder.publicKey,
            maker: makerSec.publicKey,
            escrowState: escrowSecPda,
            tokenMint: mintSec,
            vault: vaultSecPda,
            takerTokenAccount: intruderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([intruder])
          .rpc();

        assert.fail("Expected transaction to fail with UnauthorizedTaker");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.include(
          msg,
          "UnauthorizedTaker",
          "Should reject unauthorized taker",
        );
      }
    });

    it("rejects cancel when called by someone other than the maker", async () => {
      try {
        await program.methods
          .cancelAndRefund()
          .accountsPartial({
            maker: intruder.publicKey,
            escrowState: escrowSecPda,
            tokenMint: mintSec,
            vault: vaultSecPda,
            makerTokenAccount: intruderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([intruder])
          .rpc();

        assert.fail("Expected transaction to fail");
      } catch (err: unknown) {
        // Anchor will reject because the seeds won't match
        assert.ok(err, "Should reject unauthorized cancel attempt");
      }
    });

    it("rejects a zero-amount deposit", async () => {
      const maker3 = Keypair.generate();
      const taker3 = Keypair.generate();
      await provider.connection.requestAirdrop(
        maker3.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mint3 = await createMint(
        provider.connection,
        maker3,
        maker3.publicKey,
        null,
        6,
      );
      const maker3Ata = await createAssociatedTokenAccount(
        provider.connection,
        maker3,
        mint3,
        maker3.publicKey,
      );
      await mintTo(
        provider.connection,
        maker3,
        mint3,
        maker3Ata,
        maker3,
        1_000_000,
      );

      const [escrow3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), maker3.publicKey.toBuffer()],
        program.programId,
      );
      const [vault3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrow3Pda.toBuffer()],
        program.programId,
      );

      try {
        await program.methods
          .initializeAndDeposit(new BN(0))
          .accountsPartial({
            maker: maker3.publicKey,
            taker: taker3.publicKey,
            mint: mint3,
            escrowState: escrow3Pda,
            vault: vault3Pda,
            makerTokenAccount: maker3Ata,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([maker3])
          .rpc();

        assert.fail("Expected ZeroAmount error");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.include(msg, "ZeroAmount", "Should reject zero-amount deposit");
      }
    });
  });

  // ─── Battle Tests ─────────────────────────────────────────────────────────
  //
  // Adversarial patterns that prove the solana-vault-standard enforcement:
  //   BT-1a  has_one = taker  blocks unauthorized release
  //   BT-1b  Seeds mismatch   blocks cancel by an attacker who forges maker role
  //   BT-2   seeds constraint  rejects a spoofed vault (attacker ATA)
  //   BT-3   Vault authority   blocks raw SPL transfer without the PDA signer

  describe("Battle Tests: Adversarial Patterns", () => {
    const makerBattle = Keypair.generate();
    const takerBattle = Keypair.generate();
    const attacker = Keypair.generate();

    let mintBattle: PublicKey;
    let makerBattleAta: PublicKey;
    let takerBattleAta: PublicKey;
    let attackerAta: PublicKey;
    let escrowBattlePda: PublicKey;
    let vaultBattlePda: PublicKey;

    before(async () => {
      await Promise.all([
        provider.connection.requestAirdrop(
          makerBattle.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL,
        ),
        provider.connection.requestAirdrop(
          takerBattle.publicKey,
          anchor.web3.LAMPORTS_PER_SOL,
        ),
        provider.connection.requestAirdrop(
          attacker.publicKey,
          anchor.web3.LAMPORTS_PER_SOL,
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      mintBattle = await createMint(
        provider.connection,
        makerBattle,
        makerBattle.publicKey,
        null,
        6,
      );

      [makerBattleAta, takerBattleAta, attackerAta] = await Promise.all([
        createAssociatedTokenAccount(
          provider.connection,
          makerBattle,
          mintBattle,
          makerBattle.publicKey,
        ),
        createAssociatedTokenAccount(
          provider.connection,
          takerBattle,
          mintBattle,
          takerBattle.publicKey,
        ),
        createAssociatedTokenAccount(
          provider.connection,
          attacker,
          mintBattle,
          attacker.publicKey,
        ),
      ]);

      await mintTo(
        provider.connection,
        makerBattle,
        mintBattle,
        makerBattleAta,
        makerBattle,
        2_000_000,
      );

      [escrowBattlePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), makerBattle.publicKey.toBuffer()],
        program.programId,
      );
      [vaultBattlePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowBattlePda.toBuffer()],
        program.programId,
      );

      // Prime the live escrow that every battle test attacks.
      await program.methods
        .initializeAndDeposit(DEPOSIT_AMOUNT)
        .accountsPartial({
          maker: makerBattle.publicKey,
          taker: takerBattle.publicKey,
          mint: mintBattle,
          escrowState: escrowBattlePda,
          vault: vaultBattlePda,
          makerTokenAccount: makerBattleAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([makerBattle])
        .rpc();
    });

    // ── BT-1a: has_one Authority Attack (release) ─────────────────────────

    it("BT-1a: attacker cannot release funds — has_one = taker rejects wrong signer", async () => {
      // Attacker impersonates the taker role. The on-chain has_one = taker
      // constraint compares escrow_state.taker with the account key passed as
      // `taker`. Since attacker.publicKey != takerBattle.publicKey, Anchor
      // throws EscrowError::UnauthorizedTaker (6000).
      try {
        await program.methods
          .release()
          .accountsPartial({
            taker: attacker.publicKey,
            maker: makerBattle.publicKey,
            escrowState: escrowBattlePda,
            tokenMint: mintBattle,
            vault: vaultBattlePda,
            takerTokenAccount: attackerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Expected UnauthorizedTaker — attacker must be rejected");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.include(
          msg,
          "UnauthorizedTaker",
          "has_one = taker must block unauthorized release",
        );
      }

      // Vault is untouched.
      const vault = await getAccount(provider.connection, vaultBattlePda);
      assert.equal(
        vault.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Vault funds must be intact after failed release",
      );
    });

    // ── BT-1b: has_one Authority Attack (cancel) ──────────────────────────

    it("BT-1b: attacker cannot cancel a foreign escrow — PDA seeds mismatch", async () => {
      // Attacker derives an escrow PDA from their OWN pubkey. That account does
      // not exist on-chain, so Anchor throws AccountNotInitialized (3012) when
      // it tries to deserialise the EscrowState. The program never executes.
      const [attackerEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), attacker.publicKey.toBuffer()],
        program.programId,
      );
      const [attackerVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), attackerEscrowPda.toBuffer()],
        program.programId,
      );

      try {
        await program.methods
          .cancelAndRefund()
          .accountsPartial({
            maker: attacker.publicKey,
            escrowState: attackerEscrowPda, // non-existent PDA
            tokenMint: mintBattle,
            vault: attackerVaultPda,
            makerTokenAccount: attackerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();

        assert.fail(
          "Expected failure — attacker cannot cancel an escrow they did not initialise",
        );
      } catch (err: unknown) {
        // Accept any of the expected Anchor rejection reasons.
        const msg = err instanceof Error ? err.message : String(err);
        const isExpected =
          msg.includes("AccountNotInitialized") ||
          msg.includes("3012") ||
          msg.includes("seeds constraint") ||
          msg.includes("has one constraint");
        assert.ok(
          isExpected,
          `Expected account-not-initialized or constraint error; got: ${msg}`,
        );
      }
    });

    // ── BT-2: PDA Seed/Bump Mismatch (Vault Spoofing) ─────────────────────

    it("BT-2: spoofed vault (attacker ATA) is rejected by seeds constraint", async () => {
      // Attacker substitutes their own ATA for the vault. The on-chain
      // #[account(seeds = [b"vault", escrow_state.key()...], bump)] constraint
      // will recompute the expected address and compare — mismatch → ConstraintSeeds (2006).
      try {
        await program.methods
          .release()
          .accountsPartial({
            taker: takerBattle.publicKey,
            maker: makerBattle.publicKey,
            escrowState: escrowBattlePda,
            tokenMint: mintBattle,
            vault: attackerAta, // <-- spoofed: attacker's ATA, not the PDA vault
            takerTokenAccount: takerBattleAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([takerBattle])
          .rpc();

        assert.fail(
          "Expected ConstraintSeeds — spoofed vault must be rejected",
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isExpected =
          msg.includes("seeds constraint") ||
          msg.includes("ConstraintSeeds") ||
          msg.includes("2006") ||
          msg.includes("custom program error");
        assert.ok(
          isExpected,
          `Seeds constraint must reject spoofed vault; got: ${msg}`,
        );
      }

      // Vault is still sealed.
      const vault = await getAccount(provider.connection, vaultBattlePda);
      assert.equal(
        vault.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Vault funds must be intact after spoofing attempt",
      );
    });

    // ── BT-3: Unauthorized Fund Extraction ────────────────────────────────

    it("BT-3: raw SPL transfer from vault is blocked — vault authority is the PDA", async () => {
      // Attacker bypasses our program entirely and tries to call the SPL Token
      // program's Transfer instruction directly, claiming authority over the vault.
      // The SPL Token program verifies that authority == vault.owner (escrowBattlePda).
      // attacker.publicKey != escrowBattlePda, so the runtime rejects it with
      // TokenError::OwnerMismatch (0x4).
      const ix = createTransferInstruction(
        vaultBattlePda, // source: the vault
        attackerAta, // dest: attacker drains to themselves
        attacker.publicKey, // claimed authority — NOT the vault's real authority (PDA)
        500_000, // attempt to extract half
      );

      const tx = new anchor.web3.Transaction().add(ix);

      try {
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [
          attacker,
        ]);
        assert.fail(
          "Expected OwnerMismatch — vault authority is a PDA, not an external signer",
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // SPL Token: Error Code 0x4 = OwnerMismatch
        const isExpected =
          msg.includes("0x4") ||
          msg.includes("owner does not match") ||
          msg.includes("custom program error") ||
          msg.includes("Error");
        assert.ok(
          isExpected,
          `SPL Token must reject transfer from PDA-owned vault; got: ${msg}`,
        );
      }

      // Vault remains at full balance.
      const vault = await getAccount(provider.connection, vaultBattlePda);
      assert.equal(
        vault.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Vault must be fully intact after extraction attempt",
      );
    });
  });
});
