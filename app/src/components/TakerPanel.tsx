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
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { IDL, PROGRAM_ID } from "@/lib/idl";

interface EscrowState {
  pda: string;
  maker: string;
  taker: string;
  tokenMint: string;
  amount: string;
  status: "active" | "resolved" | "canceled";
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

  const fetchEscrows = useCallback(async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await (program.account as any).escrowState.all();
      const relevant = accounts
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) =>
            a.account.maker.toBase58() === publicKey.toBase58() ||
            a.account.taker.toBase58() === publicKey.toBase58(),
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => ({
          pda: a.publicKey.toBase58(),
          maker: a.account.maker.toBase58(),
          taker: a.account.taker.toBase58(),
          tokenMint: a.account.tokenMint.toBase58(),
          amount: (a.account.amount as BN).toString(),
          status: "active" as const,
        }));
      setEscrows(relevant);
    } catch {
      // Silently handle — program might not be deployed on devnet yet
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

      setTxStatus((s) => ({
        ...s,
        [key]: `Liberado! ${tx.slice(0, 12)}...`,
      }));
      fetchEscrows();
    } catch (e: unknown) {
      setTxStatus((s) => ({
        ...s,
        [key]: `Erro: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`,
      }));
    }
  };

  const handleCancel = async (escrow: EscrowState) => {
    if (!program || !publicKey) return;
    const key = escrow.pda;
    setTxStatus((s) => ({ ...s, [key]: "cancelando..." }));
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

      setTxStatus((s) => ({
        ...s,
        [key]: `Cancelado! ${tx.slice(0, 12)}...`,
      }));
      fetchEscrows();
    } catch (e: unknown) {
      setTxStatus((s) => ({
        ...s,
        [key]: `Erro: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`,
      }));
    }
  };

  const statusColor: Record<EscrowState["status"], string> = {
    active: "chip-active",
    resolved: "chip-resolved",
    canceled: "chip-canceled",
  };

  return (
    <div className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">
            <span className="icon">📋</span> Atividade do Contrato
          </h2>
          <p className="panel-subtitle">Status & Resolução</p>
        </div>
        <button className="btn-ghost" onClick={fetchEscrows} disabled={loading}>
          {loading ? "..." : "↻"}
        </button>
      </div>

      {escrows.length === 0 && !loading && (
        <p className="empty-state">
          {publicKey
            ? "Nenhum escrow encontrado para esta carteira."
            : "Conecte sua carteira para ver os escrows."}
        </p>
      )}

      <div className="escrow-list">
        {escrows.map((escrow) => {
          const isMaker = publicKey?.toBase58() === escrow.maker;
          const isTaker = publicKey?.toBase58() === escrow.taker;

          return (
            <div key={escrow.pda} className="escrow-card">
              <div className="escrow-card-header">
                <span className={`chip ${statusColor[escrow.status]}`}>
                  {escrow.status.toUpperCase()}
                </span>
                <span className="font-mono text-xs text-slate-400">
                  {escrow.pda.slice(0, 8)}...
                </span>
              </div>

              <div className="escrow-detail-grid">
                <div>
                  <span className="detail-label">Maker</span>
                  <span className="font-mono detail-value">
                    {escrow.maker.slice(0, 8)}...
                  </span>
                </div>
                <div>
                  <span className="detail-label">Taker</span>
                  <span className="font-mono detail-value">
                    {escrow.taker.slice(0, 8)}...
                  </span>
                </div>
                <div>
                  <span className="detail-label">Valor</span>
                  <span className="detail-value accent">
                    {(parseInt(escrow.amount) / 1_000_000).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="detail-label">Mint</span>
                  <span className="font-mono detail-value">
                    {escrow.tokenMint.slice(0, 8)}...
                  </span>
                </div>
              </div>

              <div className="escrow-actions">
                {isTaker && (
                  <button
                    className="btn-release"
                    onClick={() => handleRelease(escrow)}
                  >
                    Liberar Fundos
                  </button>
                )}
                {isMaker && (
                  <button
                    className="btn-cancel"
                    onClick={() => handleCancel(escrow)}
                  >
                    Solicitar Reembolso
                  </button>
                )}
              </div>

              {txStatus[escrow.pda] && (
                <div className="status-toast status-info">
                  {txStatus[escrow.pda]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
