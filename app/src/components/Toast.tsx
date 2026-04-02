"use client";

import { useEffect } from "react";
import { Rocket, X } from "lucide-react";

export interface ToastData {
  title: string;
  description: string;
}

interface ToastProps {
  toast: ToastData | null;
  onClose: () => void;
  durationMs?: number;
}

export function Toast({ toast, onClose, durationMs = 6000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [toast, onClose, durationMs]);

  if (!toast) return null;

  return (
    <div className="toast-notification" role="status" aria-live="polite">
      <div className="toast-icon">
        <Rocket size={16} />
      </div>
      <div className="toast-body">
        <p className="toast-title">{toast.title}</p>
        <p className="toast-desc">{toast.description}</p>
      </div>
      <button className="toast-close" onClick={onClose} aria-label="Fechar notificação">
        <X size={14} />
      </button>
    </div>
  );
}
