"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Transaction } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, Checkbox, FormRow, FormError } from "@/components/ui/forms";
import { addTransaction, updateTransaction, validateTransactionInput, type TransactionInput } from "@/db/repo";
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, TWO_SIDED_TYPES, BUCKETS, BUCKET_LABELS, type TransactionType, type Bucket } from "@/lib/constants";
import { CURRENCY_CODES, type CurrencyCode } from "@/lib/money";
import { rateFor } from "@/engine/fx";
import { todayKey } from "@/lib/dates";

const BUSINESS_SPEND: TransactionType[] = ["expense", "contractor_payment", "employee_payment", "growth_investment"];
const PERSONAL: TransactionType[] = ["household_expense", "personal_expense"];
const CLIENT_LINKED: TransactionType[] = ["client_payment", "refund", "chargeback", "contractor_payment", "employee_payment", "expense"];
const FEE_TYPES: TransactionType[] = ["processing_fee", "conversion_fee", "payout_fee", "platform_fee"];

export interface TransactionFormProps {
  open: boolean;
  onClose: () => void;
  existing?: Transaction | null;
  /** Preset values when creating. */
  preset?: Partial<TransactionInput>;
  onSaved?: (id: string) => void;
}

function defaultAccountFor(type: TransactionType, accounts: { id: string; role: string }[]): { accountId: string | null; toAccountId: string | null } {
  const byRole = (r: string) => accounts.find((a) => a.role === r)?.id ?? null;
  switch (type) {
    case "household_expense":
    case "personal_expense":
      return { accountId: byRole("personal"), toAccountId: null };
    case "owner_draw":
      return { accountId: byRole("operating"), toAccountId: byRole("personal") };
    case "profit_distribution":
      return { accountId: byRole("profit"), toAccountId: byRole("personal") };
    case "tax_payment":
      return { accountId: byRole("tax"), toAccountId: null };
    case "payout":
      return { accountId: byRole("processor_available"), toAccountId: byRole("operating") };
    case "reserve_hold":
      return { accountId: byRole("processor_available"), toAccountId: byRole("processor_restricted") };
    case "reserve_release":
      return { accountId: byRole("processor_restricted"), toAccountId: byRole("processor_available") };
    case "growth_investment":
      return { accountId: byRole("growth") ?? byRole("operating"), toAccountId: null };
    case "transfer":
      return { accountId: byRole("operating"), toAccountId: byRole("savings") };
    default:
      return { accountId: byRole("operating"), toAccountId: null };
  }
}

export function TransactionForm({ open, onClose, existing, preset, onSaved }: TransactionFormProps) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [form, setForm] = useState<TransactionInput>(() => initial(existing, preset));
  const [errors, setErrors] = useState<string[]>([]);
  const [autoRate, setAutoRate] = useState(true);

  function initial(e?: Transaction | null, p?: Partial<TransactionInput>): TransactionInput {
    if (e) {
      return {
        id: e.id,
        date: e.date,
        type: e.type as TransactionType,
        amountMinor: e.amountMinor,
        currency: e.currency as CurrencyCode,
        fxRatePerUsd: e.fxRatePerUsd,
        description: e.description,
        categoryId: e.categoryId,
        accountId: e.accountId,
        toAccountId: e.toAccountId,
        clientId: e.clientId,
        invoiceId: e.invoiceId,
        processorId: e.processorId,
        vendorId: e.vendorId,
        recurringExpenseId: e.recurringExpenseId,
        groupId: e.groupId,
        costType: (e.costType as "overhead" | "direct_delivery" | null) ?? null,
        bucket: (e.bucket as Bucket | null) ?? null,
        isEssential: e.isEssential,
        isRecurring: e.isRecurring,
        notes: e.notes,
      };
    }
    const type = p?.type ?? "expense";
    const acc = defaultAccountFor(type, data.accounts);
    return { date: todayKey(), type, amountMinor: 0, currency: "USD", description: "", costType: BUSINESS_SPEND.includes(type) ? "overhead" : null, ...acc, ...p };
  }

  useEffect(() => {
    if (open) {
      setForm(initial(existing, preset));
      setErrors([]);
      setAutoRate(!existing || existing.currency === "USD");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const set = <K extends keyof TransactionInput>(k: K, v: TransactionInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const lookedUpRate = useMemo(() => rateFor(form.currency, form.date, data.fxRates, data.settings), [form.currency, form.date, data.fxRates, data.settings]);
  useEffect(() => {
    if (autoRate) setForm((f) => ({ ...f, fxRatePerUsd: f.currency === "USD" ? "1" : lookedUpRate }));
  }, [autoRate, lookedUpRate]);

  const twoSided = TWO_SIDED_TYPES.includes(form.type);
  const isBusinessSpend = BUSINESS_SPEND.includes(form.type);
  const isPersonal = PERSONAL.includes(form.type);
  const categories = data.categories.filter((c) => c.scope === (isPersonal ? "personal" : "business"));
  const showClient = CLIENT_LINKED.includes(form.type);
  const openInvoices = data.invoices.filter((i) => (!form.clientId || i.clientId === form.clientId) && i.status !== "void" && i.status !== "paid");

  const onTypeChange = (t: TransactionType) => {
    const acc = defaultAccountFor(t, data.accounts);
    setForm((f) => ({ ...f, type: t, ...acc, costType: BUSINESS_SPEND.includes(t) ? (f.costType ?? "overhead") : null, bucket: t === "growth_investment" ? "growth" : BUSINESS_SPEND.includes(t) ? f.bucket : null, categoryId: null }));
  };

  const submit = () => {
    const errs = validateTransactionInput(form, data.accounts);
    if (errs.length) return setErrors(errs);
    try {
      const id = mutate((db, d) => {
        if (existing) {
          updateTransaction(db, existing.id, form, d.settings, d.fxRates);
          return existing.id;
        }
        return addTransaction(db, form, d.settings, d.fxRates);
      });
      toast.success(existing ? "Transaction updated" : "Transaction recorded");
      onSaved?.(id);
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit transaction" : "Record transaction"}
      description="Transfers, draws and payouts move money between your own accounts and are never counted as income or expense."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {existing ? "Save changes" : "Record"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError errors={errors} />
        <FormRow cols={2}>
          <Field label="Type" required>
            <Select value={form.type} onChange={(e) => onTypeChange(e.target.value as TransactionType)}>
              {TRANSACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRANSACTION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Amount" required hint={form.type === "balance_adjustment" ? "Use a negative number to reduce the balance." : undefined}>
            <MoneyInput value={form.amountMinor} onChange={(v) => set("amountMinor", v)} currency={form.currency} allowNegative={form.type === "balance_adjustment"} />
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value as CurrencyCode)}>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Rate (${form.currency} per 1 USD)`} hint={form.currency === "USD" ? "Not needed for USD" : autoRate ? "From your FX table; edit to override" : "Manual rate for this transaction"}>
            <Input
              value={form.currency === "USD" ? "1" : (form.fxRatePerUsd ?? "")}
              disabled={form.currency === "USD"}
              onChange={(e) => {
                setAutoRate(false);
                set("fxRatePerUsd", e.target.value);
              }}
              inputMode="decimal"
            />
          </Field>
        </FormRow>
        <Field label="Description" required>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. ListKit monthly, November commission, Electricity bill" />
        </Field>
        <FormRow cols={2}>
          <Field label={twoSided ? "From account" : form.type === "client_payment" || form.type === "income" ? "Received into" : "Paid from"} required={twoSided}>
            <Select value={form.accountId ?? ""} onChange={(e) => set("accountId", e.target.value || null)}>
              <option value="">— none —</option>
              {data.accounts
                .filter((a) => !a.isArchived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          {twoSided ? (
            <Field label="To account" required>
              <Select value={form.toAccountId ?? ""} onChange={(e) => set("toAccountId", e.target.value || null)}>
                <option value="">— choose —</option>
                {data.accounts
                  .filter((a) => !a.isArchived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            (isBusinessSpend || isPersonal) && (
              <Field label="Category">
                <Select value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)}>
                  <option value="">— none —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          )}
        </FormRow>
        {isBusinessSpend && (
          <FormRow cols={3}>
            <Field label="Cost type" hint="Delivery costs count against gross margin, not the operating ceiling.">
              <Select value={form.costType ?? "overhead"} onChange={(e) => set("costType", e.target.value as "overhead" | "direct_delivery")}>
                <option value="overhead">General overhead</option>
                <option value="direct_delivery">Direct delivery cost</option>
              </Select>
            </Field>
            <Field label="Envelope" hint="Which allocation this draws from.">
              <Select value={form.bucket ?? (form.type === "growth_investment" ? "growth" : "opex")} onChange={(e) => set("bucket", e.target.value as Bucket)}>
                {BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {BUCKET_LABELS[b]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor">
              <Select value={form.vendorId ?? ""} onChange={(e) => set("vendorId", e.target.value || null)}>
                <option value="">— none —</option>
                {data.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormRow>
        )}
        {(showClient || FEE_TYPES.includes(form.type)) && (
          <FormRow cols={3}>
            {showClient && (
              <Field label="Client">
                <Select value={form.clientId ?? ""} onChange={(e) => set("clientId", e.target.value || null)}>
                  <option value="">— none —</option>
                  {data.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {form.type === "client_payment" && (
              <Field label="Applies to invoice">
                <Select value={form.invoiceId ?? ""} onChange={(e) => set("invoiceId", e.target.value || null)}>
                  <option value="">— none —</option>
                  {openInvoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number ?? i.id.slice(0, 6)} · {i.periodMonth}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Processor">
              <Select value={form.processorId ?? ""} onChange={(e) => set("processorId", e.target.value || null)}>
                <option value="">— none —</option>
                {data.processors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormRow>
        )}
        {isBusinessSpend && (
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Recurring" checked={!!form.isRecurring} onChange={(v) => set("isRecurring", v)} />
            <Checkbox label="Essential to keep the business running" hint="Used for reserve coverage." checked={!!form.isEssential} onChange={(v) => set("isEssential", v)} />
          </div>
        )}
        <Field label="Notes">
          <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} placeholder="Business justification, invoice reference, anything future-you will want." />
        </Field>
      </div>
    </Modal>
  );
}
