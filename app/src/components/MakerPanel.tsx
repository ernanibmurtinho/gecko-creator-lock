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
import { Database } from "lucide-react";
import { IDL, PROGRAM_ID } from "@/lib/idl";

export function MakerPanel({ onSuccess }: { onSuccess: (txSig: string) => void }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { connection } = useConnection();

  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const [takerPubkey, setTakerPubkey] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);

  // Devnet USDC mint address as default
  const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

  const program = useMemo(() => {
    const w = walletRef.current;
    if (!publicKey || !w.signTransaction || !w.signAllTransactions) return null;
    const anchorWallet = {
      publicKey,
      signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => {
        const cur = walletRef.current;
        if (!cur.signTransaction) throw new Error("Wallet not ready");
        return cur.signTransaction(tx);
      },
      signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => {
        const cur = walletRef.current;
        if (!cur.signAllTransactions) throw new Error("Wallet not ready");
        return cur.signAllTransactions(txs);
      },
    };
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(IDL as any, provider);
  }, [connection, publicKey]);

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
    const t0 = performance.now();
    try {
      const taker = new PublicKey(takerPubkey);
      const mint = new PublicKey(USDC_DEVNET);
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

      setLatency(Math.round(performance.now() - t0));
      setStatus(`ok:${tx}`);
      onSuccess(tx);
    } catch (e: unknown) {
      setStatus(`err:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const isError = status?.startsWith("err:");
  const statusMsg = status
    ? isError
      ? status.slice(4)
      : `Tx: ${status.slice(3, 23)}...`
    : null;

  return (
    <div className="panel">
      {/* Panel header */}
      <div>
        <h2 className="panel-title">Travar Pagamento de Campanha</h2>
        <p className="panel-subtitle">Fluxo do Patrocinador</p>
      </div>

      {/* Taker wallet */}
      <div className="field-group">
        <label className="field-label">Carteira do Criador</label>
        <input
          className="field-input font-mono"
          placeholder="Ex: 8xJ9...p2Lk"
          value={takerPubkey}
          onChange={(e) => setTakerPubkey(e.target.value)}
        />
      </div>

      {/* Amount + Days row */}
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Valor em USDC</label>
          <div className="field-input-suffix">
            <input
              className="field-input font-mono"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="field-suffix-label">USDC</span>
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Dias para Entrega</label>
          <input
            className="field-input font-mono"
            type="number"
            min="1"
            placeholder="7"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
      </div>

      {/* PDA Preview */}
      {escrowPda && (
        <div className="pda-card">
          <div className="pda-card-header">
            <span className="pda-label">PDA do Contrato</span>
            <span className="pda-dot" />
          </div>
          <span className="pda-value">
            {escrowPda.slice(0, 16)}...{escrowPda.slice(-8)}
          </span>
          <div className="pda-tags">
            <span className="pda-tag">RENT_EXEMPT</span>
            <span className="pda-tag">V2_ESCROW</span>
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        className="btn-primary"
        onClick={handleDeposit}
        disabled={loading || !publicKey || !takerPubkey || !amount}
      >
        <Database size={14} />
        {loading ? "Processando..." : "DEPOSITAR NO ESCROW"}
      </button>

      {/* Inline status */}
      {statusMsg && (
        <div className={`status-toast ${isError ? "status-error" : "status-success"}`}>
          {statusMsg}
        </div>
      )}

      {/* Network latency bar */}
      <div className="network-bar">
        <span className="network-dot" />
        NETWORK LATENCY
        <span className="network-spacer" />
        <span className="network-value">{latency !== null ? `${latency}ms` : "—"}</span>
      </div>
    </div>
  );
}
