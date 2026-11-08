"use client";

import React, { useMemo, useRef, useState } from "react";
import { Plus, Download, Upload, Pencil, Trash2, Lock } from "lucide-react";
import type { Transaction } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/Money";
import { Button, Badge, PageHeader, Tabs, Callout } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/forms";
import { Table, type Column } from "@/components/ui/Table";
import { ConfirmModal, Modal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { TRANSACTION_TYPE_LABELS, TRANSFER_TYPES, REVENUE_TYPES, COLLECTION_FEE_TYPES, BUSINESS_SPEND_TYPES, PERSONAL_SPEND_TYPES, type TransactionType } from "@/lib/constants";
import { dateLabel, monthLabel } from "@/lib/dates";
import { formatMoney, parseMajorToMinor, type CurrencyCode, CURRENCY_CODES } from "@/lib/money";
import { toCsv, parseCsv, downloadBlob, readFileText, pickColumn, normaliseDate } from "@/lib/csv";
import { addTransactions, deleteTransaction, validateTransactionInput, type TransactionInput } from "@/db/repo";

type Filter = "all" | "revenue" | "business" | "personal" | "transfers" | "fees";

export default function TransactionsPage() {
  const { data, month, snapshot, mutate } = useReady();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<"month" | "all">("month");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const accountName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);
  const clientName = useMemo(() => new Map(data.clients.map((c) => [c.id, c.name])), [data.clients]);
  const categoryName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const closedMonths = useMemo(() => new Set(data.monthCloses.filter((c) => c.status === "closed").map((c) => c.month)), [data.monthCloses]);

  const rows = useMemo(() => {
    let list = data.transactions;
    if (scope === "month") list = list.filter((t) => t.month === month);
    const typeMatch = (t: Transaction) => {
      const ty = t.type as TransactionType;
      switch (filter) {
        case "revenue":
          return REVENUE_TYPES.includes(ty) || ty === "refund" || ty === "chargeback";
        case "business":
          return BUSINESS_SPEND_TYPES.includes(ty) || ty === "tax_payment";
        case "personal":
          return PERSONAL_SPEND_TYPES.includes(ty);
        case "transfers":
          return TRANSFER_TYPES.includes(ty);
        case "fees":
          return COLLECTION_FEE_TYPES.includes(ty);
        default:
          return true;
      }
    };
    list = list.filter(typeMatch);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((t) => t.description.toLowerCase().includes(s) || (t.notes ?? "").toLowerCase().includes(s) || TRANSACTION_TYPE_LABELS[t.type as TransactionType]?.toLowerCase().includes(s));
    }
    return list;
  }, [data.transactions, scope, month, filter, q]);

  const counts = useMemo(() => {
    const base = scope === "month" ? data.transactions.filter((t) => t.month === month) : data.transactions;
    return {
      all: base.length,
      revenue: base.filter((t) => REVENUE_TYPES.includes(t.type as TransactionType) || t.type === "refund" || t.type === "chargeback").length,
      business: base.filter((t) => BUSINESS_SPEND_TYPES.includes(t.type as TransactionType) || t.type === "tax_payment").length,
      personal: base.filter((t) => PERSONAL_SPEND_TYPES.includes(t.type as TransactionType)).length,
      transfers: base.filter((t) => TRANSFER_TYPES.includes(t.type as TransactionType)).length,
      fees: base.filter((t) => COLLECTION_FEE_TYPES.includes(t.type as TransactionType)).length,
    };
  }, [data.transactions, scope, month]);

  const direction = (t: Transaction): "in" | "out" | "move" => {
    const ty = t.type as TransactionType;
    if (REVENUE_TYPES.includes(ty)) return "in";
    if (TRANSFER_TYPES.includes(ty)) return "move";
    return "out";
  };

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Date", width: "110px", render: (t) => <span className="text-fg-muted">{dateLabel(t.date)}</span> },
    {
      key: "desc",
      header: "Description",
      render: (t) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{t.description}</span>
            {closedMonths.has(t.month) && <Lock size={11} className="shrink-0 text-fg-faint" />}
          </div>
          <div className="truncate text-[11px] text-fg-faint">
            {TRANSACTION_TYPE_LABELS[t.type as TransactionType]}
            {t.categoryId && ` · ${categoryName.get(t.categoryId)}`}
            {t.clientId && ` · ${clientName.get(t.clientId)}`}
            {t.costType === "direct_delivery" && " · delivery cost"}
            {t.isRecurring && " · recurring"}
          </div>
        </div>
      ),
    },
    {
      key: "account",
      header: "Account",
      render: (t) => (
        <span className="text-xs text-fg-muted">
          {t.accountId ? accountName.get(t.accountId) : "—"}
          {t.toAccountId && <> → {accountName.get(t.toAccountId)}</>}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (t) => {
        const d = direction(t);
        return (
          <div>
            <div className={d === "in" ? "text-positive" : d === "out" ? "text-fg" : "text-fg-muted"}>
              {d === "in" ? "+" : d === "out" ? "−" : ""}
              {formatMoney(Math.abs(t.amountMinor), t.currency as CurrencyCode)}
            </div>
            {t.currency !== "USD" && (
              <div className="text-[11px] text-fg-faint">
                <Money cents={t.amountUsdCents} currency="USD" /> @ {t.fxRatePerUsd}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "80px",
      render: (t) => (
        <div className="flex justify-end gap-1">
          <button
            className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg disabled:opacity-30"
            disabled={closedMonths.has(t.month)}
            onClick={() => {
              setEditing(t);
              setFormOpen(true);
            }}
            aria-label="Edit"
          >
            <Pencil size={14} />
          </button>
          <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical disabled:opacity-30" disabled={closedMonths.has(t.month)} onClick={() => setDeleting(t)} aria-label="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  const exportCsv = () => {
    const out = rows.map((t) => ({
      id: t.id,
      date: t.date,
      type: t.type,
      amount: (t.amountMinor / 100).toFixed(2),
      currency: t.currency,
      fx_rate_per_usd: t.fxRatePerUsd,
      amount_usd: (t.amountUsdCents / 100).toFixed(2),
      description: t.description,
      category: t.categoryId ? (categoryName.get(t.categoryId) ?? "") : "",
      account: t.accountId ? (accountName.get(t.accountId) ?? "") : "",
      to_account: t.toAccountId ? (accountName.get(t.toAccountId) ?? "") : "",
      client: t.clientId ? (clientName.get(t.clientId) ?? "") : "",
      cost_type: t.costType ?? "",
      bucket: t.bucket ?? "",
      recurring: t.isRecurring ? "yes" : "no",
      essential: t.isEssential ? "yes" : "no",
      notes: t.notes ?? "",
    }));
    downloadBlob(`transactions-${scope === "month" ? month : "all"}.csv`, toCsv(out));
  };

  const totals = useMemo(() => {
    const inflow = rows.filter((t) => direction(t) === "in").reduce((a, t) => a + t.amountUsdCents, 0);
    const outflow = rows.filter((t) => direction(t) === "out").reduce((a, t) => a + t.amountUsdCents, 0);
    return { inflow, outflow };
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="The single ledger behind every figure. Transfers between your own accounts, owner draws and processor payouts are movements, not income or expense."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import CSV
            </Button>
            <Button onClick={exportCsv} disabled={rows.length === 0}>
              <Download size={14} /> Export CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={14} /> Record
            </Button>
          </>
        }
      />

      {snapshot.isClosed && scope === "month" && (
        <Callout tone="neutral" className="mb-4" title={`${monthLabel(month)} is closed`}>
          Transactions in a closed month are locked. Reopen the month from Month-end to make corrections.
        </Callout>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "all", label: "All", count: counts.all },
            { value: "revenue", label: "Revenue", count: counts.revenue },
            { value: "business", label: "Business spend", count: counts.business },
            { value: "personal", label: "Personal", count: counts.personal },
            { value: "fees", label: "Fees", count: counts.fees },
            { value: "transfers", label: "Transfers", count: counts.transfers },
          ]}
        />
        <Tabs
          value={scope}
          onChange={setScope}
          tabs={[
            { value: "month", label: monthLabel(month) },
            { value: "all", label: "All time" },
          ]}
        />
        <Input className="w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
          <span>
            In <Money cents={totals.inflow} className="text-positive" />
          </span>
          <span>
            Out <Money cents={totals.outflow} />
          </span>
        </div>
      </div>

      <Table columns={columns} rows={rows} rowKey={(t) => t.id} empty={<>No transactions match. Record your first client payment or expense with the button above.</>} dense />

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} existing={editing} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete"
        title="Delete transaction?"
        body={
          deleting && (
            <>
              This removes <strong>{deleting.description}</strong> ({formatMoney(deleting.amountMinor, deleting.currency as CurrencyCode)}) from the ledger. Balances and allocations will recalculate.
              {deleting.groupId && <div className="mt-2 text-xs">This row is part of a processor sale batch; the other rows in the batch stay unless you delete them too.</div>}
            </>
          )
        }
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          try {
            mutate((db) => deleteTransaction(db, id));
            toast.success("Transaction deleted");
          } catch (e) {
            toast.error("Could not delete", e instanceof Error ? e.message : String(e));
          }
        }}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ import */

interface ParsedRow {
  input: TransactionInput;
  errors: string[];
  raw: Record<string, string>;
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [defaultAccount, setDefaultAccount] = useState<string>(data.accounts.find((a) => a.role === "operating")?.id ?? "");
  const [defaultType, setDefaultType] = useState<TransactionType>("expense");

  const accountByName = (name: string | undefined) => (name ? data.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase())?.id : undefined);
  const categoryByName = (name: string | undefined, scope: "business" | "personal") => (name ? data.categories.find((c) => c.scope === scope && c.name.toLowerCase() === name.toLowerCase())?.id : undefined);
  const clientByName = (name: string | undefined) => (name ? data.clients.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id : undefined);

  const handleFile = async (f: File) => {
    const text = await readFileText(f);
    const { rows, errors } = parseCsv(text);
    setFileErrors(errors);
    const out: ParsedRow[] = rows.map((raw) => {
      const errs: string[] = [];
      const dateCol = pickColumn(raw, ["date", "created", "time"]);
      const amountCol = pickColumn(raw, ["amount", "total", "gross"]);
      const descCol = pickColumn(raw, ["description", "memo", "name", "product", "title"]);
      const typeCol = pickColumn(raw, ["type"]);
      const curCol = pickColumn(raw, ["currency"]);
      const rateCol = pickColumn(raw, ["fx_rate_per_usd", "rate"]);
      const catCol = pickColumn(raw, ["category"]);
      const accCol = pickColumn(raw, ["account"]);
      const toCol = pickColumn(raw, ["to_account"]);
      const clientCol = pickColumn(raw, ["client"]);
      const costCol = pickColumn(raw, ["cost_type"]);
      const bucketCol = pickColumn(raw, ["bucket"]);
      const notesCol = pickColumn(raw, ["notes"]);
      const recCol = pickColumn(raw, ["recurring"]);
      const essCol = pickColumn(raw, ["essential"]);
      const date = dateCol ? normaliseDate(raw[dateCol]) : null;
      if (!date) errs.push("Missing or unreadable date");
      const rawType = typeCol ? raw[typeCol]?.trim() : "";
      const type = (rawType && (Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).includes(rawType as TransactionType) ? rawType : defaultType) as TransactionType;
      const currency = ((curCol && raw[curCol]?.trim().toUpperCase()) || "USD") as CurrencyCode;
      if (!CURRENCY_CODES.includes(currency)) errs.push(`Unsupported currency ${currency}`);
      let amountMinor = 0;
      try {
        amountMinor = Math.abs(parseMajorToMinor(amountCol ? raw[amountCol] : "0", CURRENCY_CODES.includes(currency) ? currency : "USD"));
      } catch {
        errs.push("Unreadable amount");
      }
      if (amountMinor === 0) errs.push("Amount is zero");
      const isPersonal = PERSONAL_SPEND_TYPES.includes(type);
      const input: TransactionInput = {
        date: date ?? "",
        type,
        amountMinor,
        currency: CURRENCY_CODES.includes(currency) ? currency : "USD",
        fxRatePerUsd: rateCol && raw[rateCol] ? raw[rateCol] : undefined,
        description: (descCol && raw[descCol]?.trim()) || TRANSACTION_TYPE_LABELS[type],
        categoryId: categoryByName(catCol ? raw[catCol] : undefined, isPersonal ? "personal" : "business") ?? null,
        accountId: accountByName(accCol ? raw[accCol] : undefined) ?? defaultAccount ?? null,
        toAccountId: accountByName(toCol ? raw[toCol] : undefined) ?? null,
        clientId: clientByName(clientCol ? raw[clientCol] : undefined) ?? null,
        costType: costCol && raw[costCol] === "direct_delivery" ? "direct_delivery" : BUSINESS_SPEND_TYPES.includes(type) ? "overhead" : null,
        bucket: bucketCol && raw[bucketCol] ? (raw[bucketCol] as TransactionInput["bucket"]) : null,
        isRecurring: recCol ? /^(yes|true|1)$/i.test(raw[recCol] ?? "") : false,
        isEssential: essCol ? /^(yes|true|1)$/i.test(raw[essCol] ?? "") : false,
        notes: notesCol ? raw[notesCol] || null : null,
      };
      errs.push(...validateTransactionInput(input, data.accounts));
      return { input, errors: errs, raw };
    });
    setParsed(out);
  };

  const valid = parsed.filter((p) => p.errors.length === 0);
  const doImport = () => {
    try {
      mutate((db, d) => addTransactions(db, valid.map((v) => v.input), d.settings, d.fxRates));
      toast.success(`Imported ${valid.length} transaction${valid.length === 1 ? "" : "s"}`);
      setParsed([]);
      onClose();
    } catch (e) {
      toast.error("Import failed", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import transactions from CSV"
      description="Use the same columns as the export (date, type, amount, currency, description, category, account, client…). Unknown types fall back to the default below."
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={valid.length === 0} onClick={doImport}>
            Import {valid.length} row{valid.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Default type (when the file has none)</span>
          <Select value={defaultType} onChange={(e) => setDefaultType(e.target.value as TransactionType)}>
            {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((t) => (
              <option key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Default account</span>
          <Select value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">File</span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="block w-full text-xs text-fg-muted file:mr-2 file:rounded-md file:border-0 file:bg-accent-soft file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-accent" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>
      {fileErrors.length > 0 && (
        <Callout tone="caution" className="mt-3" title="File warnings">
          {fileErrors.slice(0, 5).join("; ")}
        </Callout>
      )}
      {parsed.length > 0 && (
        <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-left text-fg-muted">
              <tr>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((p, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1.5">{p.input.date || "—"}</td>
                  <td className="px-2 py-1.5">{TRANSACTION_TYPE_LABELS[p.input.type]}</td>
                  <td className="max-w-[240px] truncate px-2 py-1.5">{p.input.description}</td>
                  <td className="tabular px-2 py-1.5 text-right">{formatMoney(p.input.amountMinor, p.input.currency)}</td>
                  <td className="px-2 py-1.5">{p.errors.length ? <Badge tone="critical">{p.errors[0]}</Badge> : <Badge tone="positive">ready</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
