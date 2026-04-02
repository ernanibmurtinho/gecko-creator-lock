"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RefreshCw, CheckCircle } from "lucide-react";
import { IDL, PROGRAM_ID } from "@/lib/idl";

interface EscrowState {
  pda: string;
  maker: string;
  taker: string;
  tokenMint: string;
  amount: string;
  status: "active" | "resolved" | "canceled";
  daysLeft: number;
}

function getDeadlineBar(daysLeft: number, status: EscrowState["status"]) {
  if (status === "resolved") {
    return { pct: 100, colorClass: "deadline-bar-green", label: "Completed", urgent: false };
  }
  if (status === "canceled") {
    return { pct: 0, colorClass: "deadline-bar-red", label: "Canceled", urgent: false };
  }
  const total = 14;
  const pct = Math.min(100, Math.max(0, Math.round(((total - daysLeft) / total) * 100)));
  const urgent = daysLeft <= 1;
  const colorClass = urgent ? "deadline-bar-red" : daysLeft <= 3 ? "deadline-bar-red" : "deadline-bar-cyan";
  const label = urgent ? `${daysLeft}h left` : `${daysLeft} days left`;
  return { pct, colorClass, label, urgent };
}

export function TakerPanel({ refreshTrigger }: { refreshTrigger: number }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { connection } = useConnection();

  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const [escrows, setEscrows] = useState<EscrowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<Record<string, string>>({});

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

  const fetchEscrows = useCallback(async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await (program.account as any).escrowState.all();
      const relevant = accounts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((a: any) =>
          a.account.maker.toBase58() === publicKey.toBase58() ||
          a.account.taker.toBase58() === publicKey.toBase58(),
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any, i: number) => ({
          pda: a.publicKey.toBase58(),
          maker: a.account.maker.toBase58(),
          taker: a.account.taker.toBase58(),
          tokenMint: a.account.tokenMint.toBase58(),
          amount: (a.account.amount as BN).toString(),
          status: "active" as const,
          daysLeft: [4, 14, 0, 14, 14][i % 5], // mock deadline variation
        }));
      setEscrows(relevant);
    } catch {
      // Silently handle — program might not be deployed yet
    } finally {
      setLoading(false);
    }
  }, [program, publicKey]);

  useEffect(() => {
    fetchEscrows();
  }, [fetchEscrows, refreshTrigger]);

  const handleRelease = async (escrow: EscrowState) => {
    if (!program || !publicKey) return;
    const key = escrow.pda;
    setTxStatus((s) => ({ ...s, [key]: "releasing..." }));
    try {
      const maker = new PublicKey(escrow.maker);
      const mint = new PublicKey(escrow.tokenMint);
      const escrowStatePda = new PublicKey(escrow.pda);
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowStatePda.toBuffer()],
        new PublicKey(PROGRAM_ID),
      );
      const takerAta = getAssociatedTokenAddressSync(mint, publicKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .release()
        .accountsPartial({
          taker: publicKey,
          maker,
          escrowState: escrowStatePda,
          tokenMint: mint,
          vault,
          takerTokenAccount: takerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTxStatus((s) => ({ ...s, [key]: `ok:${tx.slice(0, 12)}` }));
      fetchEscrows();
    } catch (e: unknown) {
      setTxStatus((s) => ({
        ...s,
        [key]: `err:${e instanceof Error ? e.message.slice(0, 50) : String(e)}`,
      }));
    }
  };

  const handleCancel = async (escrow: EscrowState) => {
    if (!program || !publicKey) return;
    const key = escrow.pda;
    setTxStatus((s) => ({ ...s, [key]: "canceling..." }));
    try {
      const mint = new PublicKey(escrow.tokenMint);
      const escrowStatePda = new PublicKey(escrow.pda);
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowStatePda.toBuffer()],
        new PublicKey(PROGRAM_ID),
      );
      const makerAta = getAssociatedTokenAddressSync(mint, publicKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program.methods as any)
        .cancelAndRefund()
        .accountsPartial({
          maker: publicKey,
          escrowState: escrowStatePda,
          tokenMint: mint,
          vault,
          makerTokenAccount: makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTxStatus((s) => ({ ...s, [key]: `ok:${tx.slice(0, 12)}` }));
      fetchEscrows();
    } catch (e: unknown) {
      setTxStatus((s) => ({
        ...s,
        [key]: `err:${e instanceof Error ? e.message.slice(0, 50) : String(e)}`,
      }));
    }
  };

  const activeCount = escrows.filter((e) => e.status === "active").length;
  const resolvedCount = escrows.filter((e) => e.status === "resolved").length;

  return (
    <div className="panel">
      {/* Panel header row */}
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Atividade do Contrato</h2>
          <p className="panel-subtitle">Status e Resolução</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          {escrows.length > 0 && (
            <div className="activity-chips">
              <span className="activity-chip activity-chip-active">
                <span className="activity-chip-dot activity-chip-dot-active" />
                {activeCount} ACTIVE
              </span>
              <span className="activity-chip activity-chip-resolved">
                <span className="activity-chip-dot activity-chip-dot-resolved" />
                {resolvedCount} RESOLVED
              </span>
            </div>
          )}
          <button className="btn-ghost" onClick={fetchEscrows} disabled={loading} aria-label="Atualizar">
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {escrows.length === 0 && !loading && (
        <p className="empty-state">
          {publicKey
            ? "Nenhum escrow encontrado para esta carteira."
            : "Conecte sua carteira para ver os escrows."}
        </p>
      )}

      {/* Table */}
      {escrows.length > 0 && (
        <div>
          <div className="escrow-table-header">
            <span className="escrow-table-col-label">Criador</span>
            <span className="escrow-table-col-label">Valor</span>
            <span className="escrow-table-col-label">Estado</span>
            <span className="escrow-table-col-label">Deadline</span>
            <span className="escrow-table-col-label" style={{ textAlign: "right" }}>Ação</span>
          </div>

          {escrows.map((escrow) => {
            const isMaker = publicKey?.toBase58() === escrow.maker;
            const isTaker = publicKey?.toBase58() === escrow.taker;
            const { pct, colorClass, label, urgent } = getDeadlineBar(escrow.daysLeft, escrow.status);
            const rowTxStatus = txStatus[escrow.pda];

            return (
              <div key={escrow.pda} className="escrow-table-row">
                {/* Creator */}
                <span className="escrow-creator">
                  {escrow.taker.slice(0, 6)}...{escrow.taker.slice(-3)}
                </span>

                {/* Amount */}
                <span>
                  <span className="escrow-amount-val">
                    {(parseInt(escrow.amount) / 1_000_000).toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                    })}
                  </span>
                  <span className="escrow-amount-unit">USDC</span>
                </span>

                {/* State chip */}
                <span>
                  <span className={`chip chip-${escrow.status}`}>
                    {escrow.status === "active" ? "ACTIVE" : escrow.status === "resolved" ? "RESOLVED" : "CANCELED"}
                  </span>
                </span>

                {/* Deadline progress */}
                <div className="deadline-cell">
                  <div className="deadline-bar-track">
                    <div
                      className={`deadline-bar-fill ${colorClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`deadline-label ${urgent ? "deadline-label-urgent" : ""}`}>
                    {label}
                  </span>
                </div>

                {/* Actions */}
                <div className="escrow-action-cell">
                  {escrow.status === "resolved" ? (
                    <CheckCircle size={16} color="var(--accent-green)" />
                  ) : rowTxStatus ? (
                    <span
                      style={{
                        fontSize: "0.62rem",
                        fontFamily: "var(--font-mono)",
                        color: rowTxStatus.startsWith("err:")
                          ? "var(--accent-red)"
                          : "var(--accent-green)",
                      }}
                    >
                      {rowTxStatus.startsWith("err:")
                        ? "error"
                        : rowTxStatus.startsWith("ok:")
                          ? "sent"
                          : rowTxStatus}
                    </span>
                  ) : (
                    <>
                      {isTaker && (
                        <button className="btn-release" onClick={() => handleRelease(escrow)}>
                          Release
                        </button>
                      )}
                      {isMaker && (
                        <button className="btn-cancel" onClick={() => handleCancel(escrow)}>
                          Refund
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
