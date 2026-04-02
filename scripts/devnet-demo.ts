/**
 * CreatorLock — Live Devnet Demo
 *
 * Demonstrates the full escrow lifecycle on Solana devnet:
 *   Path A: initialize_and_deposit → cancel_and_refund   (maker reclaims)
 *   Path B: initialize_and_deposit → release              (taker collects)
 *
 * Wallets:
 *   MAKER  → ~/.config/solana/id.json          (default CLI wallet)
 *   TAKER  → ~/.config/solana/taker.json       (auto-generated if missing)
 *
 * Usage:
 *   npx ts-node scripts/devnet-demo.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { CreatorLock } from "../target/types/creator_lock";
import IDL from "../target/idl/creator_lock.json";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const CLUSTER = "devnet";
const PROGRAM_ID = new PublicKey(
  "3XBXCwwN5CMGhjnV1CD94exPqPY4mL2LPifdzaowGmhw",
);
const TOKEN_DECIMALS = 6;
const MINT_AMOUNT = 1_000_000_000n; // 1000 tokens (6 decimals)
const ESCROW_AMOUNT = 100_000_000n; //  100 tokens (6 decimals)
const MIN_SOL_BALANCE = 0.5 * LAMPORTS_PER_SOL;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", os.homedir());
  const raw = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function saveKeypair(filePath: string, kp: Keypair): void {
  const expanded = filePath.replace("~", os.homedir());
  fs.writeFileSync(expanded, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`  Saved keypair → ${expanded}`);
}

async function ensureBalance(
  connection: Connection,
  pubkey: PublicKey,
  label: string,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  console.log(`  ${label}: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < MIN_SOL_BALANCE) {
    console.log(`  Requesting airdrop for ${label}...`);
    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const newBalance = await connection.getBalance(pubkey);
    console.log(
      `  ${label} after airdrop: ${newBalance / LAMPORTS_PER_SOL} SOL`,
    );
  }
}

function explorerUrl(type: "tx" | "account", value: string): string {
  return `https://explorer.solana.com/${type}/${value}?cluster=${CLUSTER}`;
}

function shortKey(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function tokenBalance(
  connection: Connection,
  ata: PublicKey,
  label: string,
): Promise<void> {
  try {
    const acc = await getAccount(connection, ata);
    console.log(
      `  ${label}: ${Number(acc.amount) / 10 ** TOKEN_DECIMALS} tokens`,
    );
  } catch {
    console.log(`  ${label}: 0 tokens (account may not exist)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║       CreatorLock  ·  Live Devnet Demo               ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // ── 1. Load wallets ──────────────────────────────────────────────────────
  console.log("── 1. Wallets ──────────────────────────────────────────");

  const maker = loadKeypair("~/.config/solana/id.json");
  console.log(`  MAKER  pubkey: ${maker.publicKey.toBase58()}`);
  console.log(
    `         explorer: ${explorerUrl("account", maker.publicKey.toBase58())}`,
  );

  const takerPath = "~/.config/solana/taker.json";
  const takerExpanded = takerPath.replace("~", os.homedir());
  let taker: Keypair;
  if (!fs.existsSync(takerExpanded)) {
    console.log("\n  Taker keypair not found. Generating...");
    taker = Keypair.generate();
    saveKeypair(takerPath, taker);
  } else {
    taker = loadKeypair(takerPath);
  }
  console.log(`  TAKER  pubkey: ${taker.publicKey.toBase58()}`);
  console.log(
    `         explorer: ${explorerUrl("account", taker.publicKey.toBase58())}`,
  );

  // ── 2. Connection + airdrop ──────────────────────────────────────────────
  console.log("\n── 2. SOL Balances & Airdrops ──────────────────────────");
  const connection = new Connection(clusterApiUrl(CLUSTER), "confirmed");
  await ensureBalance(connection, maker.publicKey, "MAKER");
  await ensureBalance(connection, taker.publicKey, "TAKER");

  // ── 3. Anchor setup ──────────────────────────────────────────────────────
  const makerWallet = new Wallet(maker);
  const provider = new AnchorProvider(connection, makerWallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program<CreatorLock>(IDL as CreatorLock, provider);

  // ── 4. Create test mint ──────────────────────────────────────────────────
  console.log("\n── 3. Test Token Mint ──────────────────────────────────");
  const mint = await createMint(
    connection,
    maker,
    maker.publicKey,
    null,
    TOKEN_DECIMALS,
  );
  console.log(`  Mint:     ${mint.toBase58()}`);
  console.log(`  Explorer: ${explorerUrl("account", mint.toBase58())}`);

  // ── 5. Create ATAs and mint tokens ──────────────────────────────────────
  console.log("\n── 4. Associated Token Accounts ────────────────────────");
  const makerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    maker,
    mint,
    maker.publicKey,
  );
  const takerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    maker,
    mint,
    taker.publicKey,
  );
  console.log(`  Maker ATA: ${shortKey(makerAta.address)}`);
  console.log(`  Taker ATA: ${shortKey(takerAta.address)}`);

  await mintTo(connection, maker, mint, makerAta.address, maker, MINT_AMOUNT);
  console.log(
    `\n  Minted ${Number(MINT_AMOUNT) / 10 ** TOKEN_DECIMALS} tokens to MAKER`,
  );

  console.log("\n  Balances after mint:");
  await tokenBalance(connection, makerAta.address, "MAKER");
  await tokenBalance(connection, takerAta.address, "TAKER");

  // ── 6. Derive PDAs ───────────────────────────────────────────────────────
  const [escrowStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), maker.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowStatePda.toBuffer()],
    PROGRAM_ID,
  );
  console.log("\n── PDAs ────────────────────────────────────────────────");
  console.log(`  EscrowState: ${shortKey(escrowStatePda)}`);
  console.log(`  Vault:       ${shortKey(vaultPda)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PATH A: initialize_and_deposit  →  cancel_and_refund
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PATH A: initialize_and_deposit → cancel_and_refund  ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // 6a. Initialize & Deposit
  console.log("\n── initialize_and_deposit ──────────────────────────────");
  const depositAmount = new anchor.BN(ESCROW_AMOUNT.toString());
  const txInit = await program.methods
    .initializeAndDeposit(depositAmount)
    .accountsPartial({
      maker: maker.publicKey,
      taker: taker.publicKey,
      mint,
      escrowState: escrowStatePda,
      vault: vaultPda,
      makerTokenAccount: makerAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([maker])
    .rpc();
  console.log(`  Tx: ${txInit}`);
  console.log(`  Explorer: ${explorerUrl("tx", txInit)}`);

  console.log("\n  Balances after deposit:");
  await tokenBalance(connection, makerAta.address, "MAKER");
  await tokenBalance(connection, vaultPda, "VAULT");

  // 6b. Cancel and Refund
  console.log("\n── cancel_and_refund ───────────────────────────────────");
  const txCancel = await program.methods
    .cancelAndRefund()
    .accountsPartial({
      maker: maker.publicKey,
      escrowState: escrowStatePda,
      tokenMint: mint,
      vault: vaultPda,
      makerTokenAccount: makerAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([maker])
    .rpc();
  console.log(`  Tx: ${txCancel}`);
  console.log(`  Explorer: ${explorerUrl("tx", txCancel)}`);

  console.log("\n  Balances after refund:");
  await tokenBalance(connection, makerAta.address, "MAKER");

  // ═══════════════════════════════════════════════════════════════════════════
  // PATH B: initialize_and_deposit  →  release  (new deposit first)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   PATH B: initialize_and_deposit → release           ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // 7a. New deposit (escrow PDAs are re-derived — same maker means same PDA)
  console.log("\n── initialize_and_deposit (again) ──────────────────────");
  const txInit2 = await program.methods
    .initializeAndDeposit(depositAmount)
    .accountsPartial({
      maker: maker.publicKey,
      taker: taker.publicKey,
      mint,
      escrowState: escrowStatePda,
      vault: vaultPda,
      makerTokenAccount: makerAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([maker])
    .rpc();
  console.log(`  Tx: ${txInit2}`);
  console.log(`  Explorer: ${explorerUrl("tx", txInit2)}`);

  console.log("\n  Balances after deposit:");
  await tokenBalance(connection, makerAta.address, "MAKER");
  await tokenBalance(connection, vaultPda, "VAULT");

  // 7b. Release (taker signs)
  console.log("\n── release (taker signs) ───────────────────────────────");
  const takerProvider = new AnchorProvider(connection, new Wallet(taker), {
    commitment: "confirmed",
  });
  const takerProgram = new Program<CreatorLock>(
    IDL as CreatorLock,
    takerProvider,
  );

  const txRelease = await takerProgram.methods
    .release()
    .accountsPartial({
      taker: taker.publicKey,
      maker: maker.publicKey,
      escrowState: escrowStatePda,
      tokenMint: mint,
      vault: vaultPda,
      takerTokenAccount: takerAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([taker])
    .rpc();
  console.log(`  Tx: ${txRelease}`);
  console.log(`  Explorer: ${explorerUrl("tx", txRelease)}`);

  console.log("\n  Final Balances:");
  await tokenBalance(connection, makerAta.address, "MAKER");
  await tokenBalance(connection, takerAta.address, "TAKER");

  // ── Summary ──────────────────────────────────────────────────────────────
  const makerSolEnd = await connection.getBalance(maker.publicKey);
  const takerSolEnd = await connection.getBalance(taker.publicKey);
  console.log("\n── Final SOL Balances ──────────────────────────────────");
  console.log(`  MAKER: ${makerSolEnd / LAMPORTS_PER_SOL} SOL`);
  console.log(
    `  TAKER: ${takerSolEnd / LAMPORTS_PER_SOL} SOL  ← rent returned by close`,
  );

  console.log("\n✓ Demo complete. All transactions confirmed on devnet.");
  console.log(`\nExplorer links:`);
  console.log(
    `  MAKER  → ${explorerUrl("account", maker.publicKey.toBase58())}`,
  );
  console.log(
    `  TAKER  → ${explorerUrl("account", taker.publicKey.toBase58())}`,
  );
  console.log(`  Mint   → ${explorerUrl("account", mint.toBase58())}`);
}

main().catch((err) => {
  console.error("\nDEMO FAILED:", err);
  process.exit(1);
});
