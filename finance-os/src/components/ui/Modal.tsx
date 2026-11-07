"use client";

import React, { useEffect } from "react";
import { clsx } from "clsx";
import { X } from "lucide-react";

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={clsx("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl", sizes[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="h-9 rounded-lg border border-border bg-surface-2 px-3.5 text-sm font-medium text-fg hover:bg-border">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={clsx("h-9 rounded-lg px-3.5 text-sm font-medium", danger ? "bg-critical text-white hover:brightness-110" : "bg-accent text-accent-fg hover:brightness-110")}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-fg-muted">{body}</div>
    </Modal>
  );
}
