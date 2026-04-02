"use client";

import { useState, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { IDL, PROGRAM_ID } from "@/lib/idl";

export function MakerPanel({ onSuccess }: { onSuccess: () => void }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { connection } = useConnection();

  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const [takerPubkey, setTakerPubkey] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const program = useMemo(() => {
    const w = walletRef.current;
    if (!publicKey || !w.signTransaction || !w.signAllTransactions) return null;
    const anchorWallet = {
      publicKey,
      signTransaction: <T extends Transaction | VersionedTransaction>(
        tx: T,
      ) => {
        const cur = walletRef.current;
        if (!cur.signTransaction) throw new Error("Wallet not ready");
        return cur.signTransaction(tx);
      },
      signAllTransactions: <T extends Transaction | VersionedTransaction>(
        txs: T[],
      ) => {
        const cur = walletRef.current;
        if (!cur.signAllTransactions) throw new Error("Wallet not ready");
        return cur.signAllTransactions(txs);
      },
    };
    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(IDL as any, provider);
  }, [connection, publicKey]);

  // Derive PDA preview
  const escrowPda = useMemo(() => {
    if (!publicKey) return null;
    try {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), publicKey.toBuffer()],
        new PublicKey(PROGRAM_ID),
      );
      return pda.toBase58();
    } catch {
      return null;
    }
  }, [publicKey]);

  const handleDeposit = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    setStatus(null);
    try {
      const taker = new PublicKey(takerPubkey);
      const mint = new PublicKey(mintAddress);
      const depositAmount = new BN(Math.round(parseFloat(amount) * 1_000_000));

      const [escrowState] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), publicKey.toBuffer()],
        new PublicKey(PROGRAM_ID),
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowState.toBuffer()],
        new PublicKey(PROGRAM_ID),
      );
      const makerTokenAccount = getAssociatedTokenAddressSync(mint, publicKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .initializeAndDeposit(depositAmount)
        .accountsPartial({
          maker: publicKey,
          taker,
          mint,
          escrowState,
          vault,
          makerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      setStatus(`Deposited! Tx: ${tx.slice(0, 20)}...`);
      onSuccess();
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        <span className="icon">🔒</span> Depositar no Escrow
      </h2>
      <p className="panel-subtitle">Fluxo do Patrocinador (Maker)</p>

      <div className="field-group">
        <label className="field-label">Carteira do Criador (Taker)</label>
        <input
          className="field-input font-mono"
          placeholder="Ex: 6pq...4xZ"
          value={takerPubkey}
          onChange={(e) => setTakerPubkey(e.target.value)}
        />
      </div>

      <div className="field-group">
        <label className="field-label">Mint do Token (USDC / wSOL)</label>
        <input
          className="field-input font-mono"
          placeholder="Endereço do mint SPL"
          value={mintAddress}
          onChange={(e) => setMintAddress(e.target.value)}
        />
      </div>

      <div className="field-group">
        <label className="field-label">Valor (em tokens)</label>
        <input
          className="field-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="Ex: 100"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {escrowPda && (
        <div className="pda-preview">
          <span className="pda-label">PDA Previsto</span>
          <span className="font-mono pda-value">
            {escrowPda.slice(0, 16)}...{escrowPda.slice(-8)}
          </span>
        </div>
      )}

      <button
        className="btn-primary"
        onClick={handleDeposit}
        disabled={
          loading || !publicKey || !takerPubkey || !mintAddress || !amount
        }
      >
        {loading ? "Processando..." : "DEPOSITAR NO ESCROW"}
      </button>

      {status && (
        <div
          className={`status-toast ${status.startsWith("Error") ? "status-error" : "status-success"}`}
        >
          {status}
        </div>
      )}
    </div>
  );
}
