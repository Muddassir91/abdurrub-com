"use client";

import React from "react";
import { clsx } from "clsx";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, empty, onRowClick, dense, className, footer }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: React.ReactNode; onRowClick?: (row: T) => void; dense?: boolean; className?: string; footer?: React.ReactNode }) {
  return (
    <div className={clsx("overflow-x-auto rounded-xl border border-border bg-surface", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/60">
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} className={clsx("px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-fg-faint">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={clsx("border-b border-border last:border-b-0", onRowClick && "cursor-pointer hover:bg-surface-2/60")}>
                {columns.map((c) => (
                  <td key={c.key} className={clsx("px-3 align-middle text-fg", dense ? "py-1.5" : "py-2.5", c.align === "right" && "tabular text-right", c.align === "center" && "text-center", c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="border-t border-border bg-surface-2/40">{footer}</tfoot>}
      </table>
    </div>
  );
}
