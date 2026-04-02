"use client";

import {
  ArrowRightLeft,
  BarChart3,
  Eye,
  HelpCircle,
  BookOpen,
  Zap,
} from "lucide-react";

export type SidebarPage = "initialize" | "escrow" | "auditor" | "analytics";

interface SidebarProps {
  activePage: SidebarPage;
  onNavigate: (page: SidebarPage) => void;
}

const navItems: { id: SidebarPage; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: "initialize", label: "Initialize", Icon: Zap },
  { id: "escrow", label: "Escrow", Icon: ArrowRightLeft },
  { id: "auditor", label: "Auditor", Icon: Eye },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
];

const footerItems = [
  { label: "Documentation", Icon: BookOpen },
  { label: "Support", Icon: HelpCircle },
];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <span className="sidebar-brand-name">Sovereign Terminal</span>
        <span className="sidebar-brand-version">V1.0.4-STABLE</span>
      </div>

      {/* Nav items */}
      <nav>
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`sidebar-item${activePage === id ? " active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <span className="sidebar-item-icon">
              <Icon size={14} />
            </span>
            {label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="sidebar-cta">Create Lock</button>
        <div className="sidebar-footer-links">
          {footerItems.map(({ label, Icon }) => (
            <button key={label} className="sidebar-item" style={{ fontSize: "0.75rem" }}>
              <span className="sidebar-item-icon">
                <Icon size={13} />
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
