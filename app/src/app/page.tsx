"use client";

import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MakerPanel } from "@/components/MakerPanel";
import { TakerPanel } from "@/components/TakerPanel";

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🔐</span>
            <span className="logo-text">CreatorLock</span>
            <span className="logo-badge">DEVNET</span>
          </div>
          <WalletMultiButton className="wallet-btn" />
        </div>
      </header>

      {/* Main Dashboard */}
      <main className="main-content">
        <div className="dashboard-grid">
          <MakerPanel onSuccess={() => setRefreshTrigger((n) => n + 1)} />
          <TakerPanel refreshTrigger={refreshTrigger} />
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <span>
          CreatorLock · Superteam Brazil × NearX Bootcamp · Solana Devnet
        </span>
      </footer>
    </div>
  );
}
