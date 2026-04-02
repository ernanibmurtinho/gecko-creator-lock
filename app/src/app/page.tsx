"use client";

import { useState, useCallback } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Settings, Bell, Lock } from "lucide-react";
import { MakerPanel } from "@/components/MakerPanel";
import { TakerPanel } from "@/components/TakerPanel";
import { Sidebar, SidebarPage } from "@/components/Sidebar";
import { Toast, ToastData } from "@/components/Toast";

export default function Home() {
  const { publicKey } = useWallet();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activePage, setActivePage] = useState<SidebarPage>("initialize");
  const [toast, setToast] = useState<ToastData | null>(null);

  const handleSuccess = useCallback((txSig: string) => {
    setRefreshTrigger((n) => n + 1);
    setToast({
      title: "Escrow Criado na DevNet",
      description: `ID: ${txSig.slice(0, 8)}x_0x${txSig.slice(8, 12)}...${txSig.slice(-4)}.\nDepósito confirmado.`,
    });
  }, []);

  const truncatedKey = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-3)}`
    : null;

  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-logo">
          <Lock size={16} color="var(--accent-cyan)" />
          <span className="header-logo-text">CreatorLock</span>
        </div>

        <div className="header-spacer" />

        <div className="header-actions">
          <button className="header-icon-btn" aria-label="Configurações">
            <Settings size={14} />
          </button>
          <button className="header-icon-btn" aria-label="Notificações">
            <Bell size={14} />
          </button>
          <span className="header-network-badge">DevNet</span>
          <WalletMultiButton>
            {truncatedKey ?? "Connect Wallet"}
          </WalletMultiButton>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        <Sidebar activePage={activePage} onNavigate={setActivePage} />

        <main className="main-content">
          <div className="dashboard-grid">
            <MakerPanel onSuccess={handleSuccess} />
            <TakerPanel refreshTrigger={refreshTrigger} />
          </div>
        </main>
      </div>

      {/* ── Status Bar ── */}
      <div className="statusbar">
        <div className="statusbar-item">
          <span className="statusbar-dot statusbar-dot-green" />
          SOLANA DEVNET: SYNCED
        </div>
        <div className="statusbar-item">
          TPS: 2,492
        </div>
        <div className="statusbar-spacer" />
        <div className="statusbar-item">UTF-8</div>
        <div className="statusbar-item">Solana CLI 1.14.7</div>
        <div className="statusbar-item" style={{ color: "var(--accent-cyan)" }}>
          MASTER*
        </div>
      </div>

      {/* ── Floating Toast ── */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
