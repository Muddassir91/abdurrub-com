"use client";

import React, { useRef, useState } from "react";
import { Plus, Trash2, Download, Upload, Lock, Unlock, RotateCcw, Save, Star, Sun, Moon, MonitorSmartphone } from "lucide-react";
import type { AllocationPolicy, Category, FxRate } from "@/db/schema";
import { useReady, useFinance } from "@/store/FinanceProvider";
import { useTheme, type ThemePref } from "@/components/AppShell";
import { WorkspaceForm } from "@/components/WorkspaceForm";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/Money";
import { PageHeader, Card, Badge, Button, Callout, Tabs, DefinitionList } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, PercentInput, FormRow, FormError, Checkbox } from "@/components/ui/forms";
import { ConfirmModal, Modal } from "@/components/ui/Modal";
import { updateSettings, upsertPolicy, deletePolicy, upsertFxRate, deleteFxRate, upsertCategory, deleteCategory } from "@/db/repo";
import { validatePercentages, policyPercentages, computeAllocations, type PolicyPercentages } from "@/engine/allocation";
import { BUCKETS, BUCKET_LABELS } from "@/lib/constants";
import { downloadBlob, readFileBytes } from "@/lib/csv";
import { todayKey, dateLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { clsx } from "clsx";

type Tab = "allocation" | "business" | "fx" | "categories" | "backup" | "privacy" | "appearance" | "workspaces" | "account";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "allocation";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "account" ? "account" : "allocation";
  });
  return (
    <>
      <PageHeader title="Settings" description="Allocation rules, business parameters, exchange rates, categories, backups, privacy, appearance and workspaces. Nothing here changes silently; every percentage must add up to 100%." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "allocation", label: "Allocation policies" }, { value: "business", label: "Business & targets" }, { value: "fx", label: "Exchange rates" }, { value: "categories", label: "Categories" }, { value: "backup", label: "Backup & restore" }, { value: "privacy", label: "Privacy lock" }, { value: "appearance", label: "Appearance" }, { value: "workspaces", label: "Workspaces" }, { value: "account", label: "Account & sync" }]} />
      {tab === "allocation" && <PoliciesTab />}
      {tab === "business" && <BusinessTab />}
      {tab === "fx" && <FxTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "backup" && <BackupTab />}
      {tab === "privacy" && <PrivacyTab />}
      {tab === "appearance" && <AppearanceTab />}
      {tab === "workspaces" && <WorkspacesTab />}
      {tab === "account" && <AccountTab />}
    </>
  );
}

/* ----------------------------------------------------------------- account */

function AccountTab() {
  const { cloudStatus, cloudUser, cloudError, lastSyncedAt, signOut, syncNow, workspaces, currentWorkspace, continueWithoutAccount } = useFinance();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState<null | boolean>(null);
  if (cloudStatus === "off") {
    return (
      <Callout tone="neutral" title="Accounts are not enabled in this build">
        This copy of CFoh! runs on this device only. Once the cloud project is connected (see finance-os/README.md), signing in makes your workspaces follow you across devices.
      </Callout>
    );
  }
  if (!cloudUser) {
    return (
      <Card title="Not signed in" subtitle="You chose to use CFoh! on this device only">
        <p className="text-sm text-fg-muted">Sign in or create an account to keep your workspaces in your private cloud space and open them from any device. Local workspaces on this device will be uploaded to the account automatically.</p>
        <Button className="mt-3" variant="primary" onClick={() => { localStorage.removeItem("finance-os:device-only"); window.location.reload(); }}>Sign in or create account</Button>
      </Card>
    );
  }
  const synced = workspaces.filter((w) => w.cloud).length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Your account" subtitle="Private cloud space for your workspaces">
        <DefinitionList items={[{ label: "Signed in as", value: cloudUser.email ?? cloudUser.id }, { label: "Sync status", value: cloudStatus === "syncing" ? "Syncing…" : cloudStatus === "error" ? <span className="text-critical">Error</span> : "Up to date" }, { label: "Last synced", value: lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "—" }, { label: "Workspaces in account", value: `${synced} of ${workspaces.length}` }, { label: "Current workspace", value: currentWorkspace ? `${currentWorkspace.name}${currentWorkspace.cloud ? " (synced)" : " (this device only)"}` : "—" }]} />
        {cloudError && <Callout tone="critical" className="mt-3" title="Last sync error">{cloudError}</Callout>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await syncNow(); setBusy(false); toast.success("Sync complete"); }}>Sync now</Button>
          <Button onClick={() => setConfirmOut(false)}>Sign out</Button>
          <Button variant="danger" onClick={() => setConfirmOut(true)}>Sign out and remove data from this device</Button>
        </div>
        <ConfirmModal open={confirmOut !== null} onClose={() => setConfirmOut(null)} danger={confirmOut === true} confirmLabel={confirmOut ? "Sign out and remove" : "Sign out"} title={confirmOut ? "Remove your data from this device?" : "Sign out?"} body={confirmOut ? "Your workspaces stay safe in your account. Their local copies on this device are deleted, which is what you want on a shared computer." : "Your workspaces stay on this device and in your account. Sign back in any time."} onConfirm={() => void signOut(confirmOut === true)} />
        <span className="hidden">{String(continueWithoutAccount)}</span>
      </Card>
      <Card title="How sync works" subtitle="Plain answers">
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-fg-muted">
          <li>Every save on this device is also uploaded to your account, usually within two seconds.</li>
          <li>Opening a workspace on another device downloads the latest copy. If both devices changed it while offline, the newer save wins and the other is kept as a separate &quot;copy from this device&quot; workspace so nothing is lost.</li>
          <li>With a passphrase set, the workspace is encrypted before upload. The server stores ciphertext only; the passphrase is needed on every device.</li>
          <li>Nobody else can read your rows: the database enforces that each account only sees its own data.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- appearance */

function AppearanceTab() {
  const { pref, resolved, setPref } = useTheme();
  const options: { value: ThemePref; label: string; hint: string; icon: React.ReactNode }[] = [
    { value: "system", label: "Follow system", hint: "Switches with your device's light/dark setting.", icon: <MonitorSmartphone size={16} /> },
    { value: "light", label: "Light", hint: "Always light.", icon: <Sun size={16} /> },
    { value: "dark", label: "Dark", hint: "Always dark.", icon: <Moon size={16} /> },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Theme" subtitle={`Currently showing the ${resolved} theme. The sun/moon button in the top bar is a quick toggle.`}>
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => (
            <button key={o.value} onClick={() => setPref(o.value)} className={clsx("rounded-xl border p-3 text-left transition-colors", pref === o.value ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
              <div className="flex items-center gap-2 text-sm font-medium">{o.icon} {o.label}</div>
              <div className="mt-1 text-xs text-fg-muted">{o.hint}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Currency display" subtitle="USD is the primary currency; PKR is the secondary for household figures">
        <p className="text-sm text-fg-muted">Use the USD / PKR switch in the top bar to flip every figure. Each transaction keeps its original currency and rate regardless of the display setting.</p>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- workspaces */

function WorkspacesTab() {
  const { workspaces, currentWorkspace, switchWorkspace, renameWorkspace, deleteWorkspace, createWorkspace } = useFinance();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; businessName: string } | null>(null);
  return (
    <>
      <Callout tone="info" className="mb-4" title="One workspace per business or person">
        Each workspace is a separate database with its own policy, accounts, clients, settings and passphrase. Nothing is shared between them. Use this for a second business, or for another person using this device. To use a workspace on another device, download its backup and restore it there.
      </Callout>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Add business or person</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {workspaces.map((w) => (
          <Card key={w.id} title={<span className="flex items-center gap-2">{w.name}{w.id === currentWorkspace?.id && <Badge tone="positive">open</Badge>}<Badge>{w.template === "retention_rules" ? "Retention Rules template" : "blank template"}</Badge></span>} subtitle={`${w.businessName} · ${w.ownerName} · created ${dateLabel(w.createdAt.slice(0, 10))}`} actions={<>{w.id !== currentWorkspace?.id && <Button size="sm" onClick={() => void switchWorkspace(w.id)}>Open</Button>}<Button size="sm" variant="ghost" onClick={() => setEditing({ id: w.id, name: w.name, businessName: w.businessName })}>Rename</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(w.id)}><Trash2 size={13} /></Button></>}>
            <p className="text-xs text-fg-muted">Passphrase, backups and reset for a workspace are managed while it is open, under Privacy lock and Backup & restore.</p>
          </Card>
        ))}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add a business or person" size="lg">
        <WorkspaceForm allowRetentionRulesTemplate={false} onCancel={() => setCreating(false)} onSubmit={async (input) => { await createWorkspace(input); setCreating(false); toast.success(`Workspace "${input.name}" created and opened`); }} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Rename workspace" size="sm" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={!editing?.name.trim()} onClick={async () => { if (!editing) return; await renameWorkspace(editing.id, editing.name, editing.businessName); setEditing(null); toast.success("Workspace renamed"); }}>Save</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="Workspace name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Business name (label only)" hint="The business name used inside the app is under Business & targets."><Input value={editing.businessName} onChange={(e) => setEditing({ ...editing, businessName: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Delete workspace" title="Delete this workspace?" body="Its entire database is removed from this browser. This cannot be undone unless you have a backup file of it." onConfirm={() => { if (deleting) void deleteWorkspace(deleting).then(() => toast.success("Workspace deleted")); }} />
    </>
  );
}

/* ----------------------------------------------------------------- policies */

function PoliciesTab() {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const [edit, setEdit] = useState<AllocationPolicy | null | "new">(null);
  return (
    <>
      <Callout tone="info" className="mb-4" title="How policies are chosen">
        The engine picks the policy with the highest revenue threshold that the month&apos;s allocatable revenue reaches, unless you pin one. This lets you define different rules for different growth stages (e.g. a higher operating share once you have delivery staff). Active now: <Badge tone="accent">{snapshot.policy.name}</Badge>
      </Callout>
      <div className="mb-3 flex items-center justify-between">
        <Field label="Pinned policy (overrides revenue bands)" className="w-72">
          <Select value={data.settings.pinnedPolicyId ?? ""} onChange={(e) => { mutate((db) => updateSettings(db, { pinnedPolicyId: e.target.value || null })); toast.success("Policy selection saved"); }}>
            <option value="">Automatic by revenue band</option>
            {data.policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} /> New policy</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.policies.slice().sort((a, b) => a.appliesFromMonthlyRevenueUsdCents - b.appliesFromMonthlyRevenueUsdCents).map((p) => {
          const v = validatePercentages(policyPercentages(p));
          return (
            <Card key={p.id} title={<span className="flex items-center gap-2">{p.name}{p.isDefault && <Badge tone="accent"><Star size={10} className="mr-1" />default</Badge>}{p.id === snapshot.policy.id && <Badge tone="positive">active</Badge>}{!v.ok && <Badge tone="critical">invalid</Badge>}</span>} subtitle={`Applies from ${formatMoney(p.appliesFromMonthlyRevenueUsdCents)} /month${p.description ? ` · ${p.description}` : ""}`} actions={<><Button size="sm" onClick={() => setEdit(p)}>Edit</Button>{data.policies.length > 1 && <Button size="sm" variant="ghost" onClick={() => { try { mutate((db) => deletePolicy(db, p.id)); toast.success("Policy deleted"); } catch (e) { toast.error("Cannot delete", e instanceof Error ? e.message : String(e)); } }}><Trash2 size={13} /></Button>}</>}>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {BUCKETS.map((b) => (
                  <div key={b} className="rounded-lg border border-border p-2 text-center">
                    <div className="text-[10px] text-fg-muted">{BUCKET_LABELS[b].split(" ")[0]}</div>
                    <div className="tabular text-base font-semibold">{policyPercentages(p)[b]}%</div>
                  </div>
                ))}
              </div>
              {!v.ok && <p className="mt-2 text-xs text-critical">{v.errors.join("; ")}</p>}
            </Card>
          );
        })}
      </div>
      <PolicyModal open={edit !== null} existing={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PolicyModal({ open, existing, onClose }: { open: boolean; existing: AllocationPolicy | null; onClose: () => void }) {
  const { mutate } = useReady();
  const toast = useToast();
  const blank = { name: "", description: "", appliesFrom: 0, isDefault: false, pcts: { opex: "25", owner: "35", tax: "15", profit: "10", reserve: "10", growth: "5" } as PolicyPercentages };
  const [f, setF] = useState(blank);
  React.useEffect(() => {
    if (open) setF(existing ? { name: existing.name, description: existing.description ?? "", appliesFrom: existing.appliesFromMonthlyRevenueUsdCents, isDefault: existing.isDefault, pcts: policyPercentages(existing) } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  const v = validatePercentages(f.pcts);
  const preview = v.ok ? computeAllocations(1000000, f.pcts) : null;
  return (
    <Modal open={open} onClose={onClose} title={existing ? `Edit ${existing.name}` : "New allocation policy"} description="Percentages must add up to exactly 100%. The operating share is a ceiling, never a spending target." size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.ok || !f.name.trim()} onClick={() => { mutate((db) => upsertPolicy(db, { id: existing?.id, name: f.name.trim(), description: f.description || null, appliesFromMonthlyRevenueUsdCents: f.appliesFrom, isDefault: f.isDefault, opexPct: f.pcts.opex, ownerPct: f.pcts.owner, taxPct: f.pcts.tax, profitPct: f.pcts.profit, reservePct: f.pcts.reserve, growthPct: f.pcts.growth })); toast.success("Policy saved"); onClose(); }}>Save policy</Button></>}>
      <div className="space-y-4">
        <FormRow cols={2}>
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Scale stage (with delivery team)" /></Field>
          <Field label="Applies from monthly revenue (USD)" hint="0 = base policy"><MoneyInput value={f.appliesFrom} onChange={(v) => setF({ ...f, appliesFrom: v })} /></Field>
        </FormRow>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {BUCKETS.map((b) => (
            <Field key={b} label={BUCKET_LABELS[b]}><PercentInput value={f.pcts[b]} onChange={(val) => setF({ ...f, pcts: { ...f.pcts, [b]: val } })} /></Field>
          ))}
        </div>
        <div className={clsx("rounded-lg border px-3 py-2 text-sm", v.ok ? "border-positive/40 bg-positive-soft text-positive" : "border-critical/40 bg-critical-soft text-critical")}>Total: {v.total}% {v.ok ? "✓ valid" : `· ${v.errors.join("; ")}`}</div>
        {preview && <DefinitionList items={BUCKETS.map((b) => ({ label: `${BUCKET_LABELS[b]} at $10,000`, value: <Money cents={preview[b]} /> }))} />}
        <Checkbox label="Make this the default policy" hint="Used when no revenue band matches." checked={f.isDefault} onChange={(val) => setF({ ...f, isDefault: val })} />
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- business */

function BusinessTab() {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const s = data.settings;
  const [f, setF] = useState({ businessName: s.businessName, ownerName: s.ownerName, gmMin: s.targetGrossMarginMinPct, gmMax: s.targetGrossMarginMaxPct, resTarget: s.reserveTargetMonths, resMin: s.reserveMinMonths, resMax: s.reserveMaxMonths, concWarn: s.concentrationWarnPct, concCrit: s.concentrationCriticalPct, renewalDays: s.renewalReminderDays, graceDays: s.invoiceOverdueGraceDays, override: s.opexCeilingOverrideUsdCents ?? 0, overrideOn: s.opexCeilingOverrideUsdCents != null, overrideNote: s.opexCeilingOverrideNote ?? "" });
  const [errors, setErrors] = useState<string[]>([]);
  const save = () => {
    const errs: string[] = [];
    if (!(Number(f.gmMin) >= 0 && Number(f.gmMax) <= 100 && Number(f.gmMin) <= Number(f.gmMax))) errs.push("Gross margin range must be 0–100 with min ≤ max");
    if (!(Number(f.resMin) >= 1 && Number(f.resTarget) >= Number(f.resMin) && Number(f.resTarget) <= Number(f.resMax))) errs.push("Reserve target must sit between min and max months");
    if (!(Number(f.concWarn) > 0 && Number(f.concCrit) > Number(f.concWarn) && Number(f.concCrit) <= 100)) errs.push("Concentration thresholds must be 0 < warn < critical ≤ 100");
    if (f.overrideOn && !f.overrideNote.trim()) errs.push("Document the reason for a higher operating ceiling");
    if (errs.length) return setErrors(errs);
    setErrors([]);
    mutate((db) => updateSettings(db, { businessName: f.businessName.trim() || s.businessName, ownerName: f.ownerName.trim() || s.ownerName, targetGrossMarginMinPct: f.gmMin, targetGrossMarginMaxPct: f.gmMax, reserveTargetMonths: f.resTarget, reserveMinMonths: f.resMin, reserveMaxMonths: f.resMax, concentrationWarnPct: f.concWarn, concentrationCriticalPct: f.concCrit, renewalReminderDays: f.renewalDays, invoiceOverdueGraceDays: f.graceDays, opexCeilingOverrideUsdCents: f.overrideOn ? f.override : null, opexCeilingOverrideNote: f.overrideOn ? f.overrideNote.trim() : null, opexCeilingOverrideApprovedAt: f.overrideOn ? (s.opexCeilingOverrideApprovedAt ?? todayKey()) : null }));
    toast.success("Business settings saved");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Business" subtitle="Names shown around the app">
        <FormRow cols={2}>
          <Field label="Business name"><Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
          <Field label="Owner name"><Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
        </FormRow>
        <DefinitionList className="mt-3" items={[{ label: "Base currency", value: s.baseCurrency }, { label: "Household currency", value: s.householdCurrency }, { label: "Location", value: data.taxProfiles[0]?.jurisdiction ?? "—" }, { label: "Entities", value: data.entities.map((e) => e.name).join(" · ") }]} />
        <div className="mt-4 rounded-xl border border-border bg-surface-2/60 p-3">
          <div className="text-sm font-medium text-fg">Setup questions</div>
          <p className="mt-1 text-xs text-fg-muted">Income, costs, home budget and your split were set when you first opened CFoh!. Run the questions again to refresh them; your transactions are untouched.</p>
          <Button className="mt-2" onClick={() => { mutate((db) => updateSettings(db, { onboardingJson: null })); }}>Redo the setup questions</Button>
        </div>
      </Card>
      <Card title="Targets & thresholds" subtitle="Drive margins, reserves, concentration alerts and reminders">
        <FormError errors={errors} />
        <FormRow cols={2} className="mt-2">
          <Field label="Target gross margin min %"><PercentInput value={f.gmMin} onChange={(v) => setF({ ...f, gmMin: v })} /></Field>
          <Field label="Target gross margin max %"><PercentInput value={f.gmMax} onChange={(v) => setF({ ...f, gmMax: v })} /></Field>
        </FormRow>
        <FormRow cols={3} className="mt-3">
          <Field label="Reserve min months"><Input value={f.resMin} onChange={(e) => setF({ ...f, resMin: e.target.value })} /></Field>
          <Field label="Reserve target months"><Input value={f.resTarget} onChange={(e) => setF({ ...f, resTarget: e.target.value })} /></Field>
          <Field label="Reserve max months"><Input value={f.resMax} onChange={(e) => setF({ ...f, resMax: e.target.value })} /></Field>
        </FormRow>
        <FormRow cols={2} className="mt-3">
          <Field label="Concentration caution at %"><PercentInput value={f.concWarn} onChange={(v) => setF({ ...f, concWarn: v })} /></Field>
          <Field label="Concentration critical at %"><PercentInput value={f.concCrit} onChange={(v) => setF({ ...f, concCrit: v })} /></Field>
        </FormRow>
        <FormRow cols={2} className="mt-3">
          <Field label="Renewal reminder (days ahead)"><Input type="number" value={f.renewalDays} onChange={(e) => setF({ ...f, renewalDays: Number(e.target.value) || 0 })} /></Field>
          <Field label="Invoice overdue grace (days)"><Input type="number" value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: Number(e.target.value) || 0 })} /></Field>
        </FormRow>
      </Card>
      <Card title="Operating ceiling override" subtitle="Approve a higher monthly operating budget when a documented hiring or growth decision justifies it" className="lg:col-span-2">
        <Checkbox label="Approve a higher operating expense ceiling than the policy percentage" checked={f.overrideOn} onChange={(v) => setF({ ...f, overrideOn: v })} />
        {f.overrideOn && (
          <FormRow cols={2} className="mt-3">
            <Field label="Monthly ceiling (USD)" hint={<>Policy ceiling this month: <Money cents={snapshot.expenses.policyCeiling} />. The override only applies when higher.</>}><MoneyInput value={f.override} onChange={(v) => setF({ ...f, override: v })} /></Field>
            <Field label="Justification" required><Textarea value={f.overrideNote} onChange={(e) => setF({ ...f, overrideNote: e.target.value })} placeholder="Hired a part-time VA to free 10h/week for sales; reviewed quarterly." /></Field>
          </FormRow>
        )}
        {s.opexCeilingOverrideApprovedAt && f.overrideOn && <p className="mt-2 text-xs text-fg-faint">Approved {dateLabel(s.opexCeilingOverrideApprovedAt)}.</p>}
        <div className="mt-4"><Button variant="primary" onClick={save}><Save size={14} /> Save business settings</Button></div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- fx */

function FxTab() {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [def, setDef] = useState(data.settings.defaultFxRatePkrPerUsd);
  const [n, setN] = useState({ date: todayKey(), currency: "PKR", rate: "", source: "" });
  const rates = data.fxRates.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Default rate" subtitle="PKR per 1 USD, used for budgets and any transaction without a dated rate">
        <div className="flex items-end gap-2">
          <Field label="PKR per USD" className="flex-1"><Input inputMode="decimal" value={def} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setDef(e.target.value)} /></Field>
          <Button variant="primary" disabled={!(Number(def) > 0)} onClick={() => { mutate((db) => updateSettings(db, { defaultFxRatePkrPerUsd: def })); toast.success("Default rate saved"); }}>Save</Button>
        </div>
        <p className="mt-3 text-xs text-fg-faint">Each foreign-currency transaction stores its own rate, the original amount and the converted USD amount, so changing this default never rewrites history.</p>
      </Card>
      <Card title="Historical rates" subtitle="Dated rates are used for transactions on or after that date">
        <div className="grid grid-cols-4 gap-2">
          <Input type="date" value={n.date} onChange={(e) => setN({ ...n, date: e.target.value })} />
          <Select value={n.currency} onChange={(e) => setN({ ...n, currency: e.target.value })}><option>PKR</option><option>EUR</option><option>GBP</option><option>AED</option><option>CAD</option><option>AUD</option></Select>
          <Input placeholder="Rate per USD" inputMode="decimal" value={n.rate} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setN({ ...n, rate: e.target.value })} />
          <Button variant="primary" disabled={!(Number(n.rate) > 0)} onClick={() => { mutate((db) => upsertFxRate(db, { date: n.date, currency: n.currency, ratePerUsd: n.rate, source: n.source || "manual" })); setN({ ...n, rate: "" }); toast.success("Rate added"); }}><Plus size={14} /></Button>
        </div>
        <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
          {rates.map((r: FxRate) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-fg-muted">{dateLabel(r.date)} · {r.currency}</span>
              <span className="flex items-center gap-3"><span className="tabular font-medium">{r.ratePerUsd}</span><button className="text-fg-faint hover:text-critical" onClick={() => { mutate((db) => deleteFxRate(db, r.id)); }}><Trash2 size={13} /></button></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- categories */

function CategoriesTab() {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [n, setN] = useState({ business: "", personal: "" });
  const list = (scope: "business" | "personal") => (
    <Card title={scope === "business" ? "Business categories" : "Personal categories"}>
      <div className="flex gap-2">
        <Input placeholder="New category" value={n[scope]} onChange={(e) => setN({ ...n, [scope]: e.target.value })} />
        <Button variant="primary" disabled={!n[scope].trim()} onClick={() => { mutate((db) => upsertCategory(db, { name: n[scope].trim(), scope })); setN({ ...n, [scope]: "" }); toast.success("Category added"); }}><Plus size={14} /></Button>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {data.categories.filter((c) => c.scope === scope).map((c: Category) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2">{c.name}{c.isEssentialDefault && <Badge>essential</Badge>}</span>
            <span className="flex items-center gap-2">
              <button className="text-[11px] text-fg-faint hover:text-fg" onClick={() => mutate((db) => upsertCategory(db, { id: c.id, name: c.name, scope, isEssentialDefault: !c.isEssentialDefault }))}>{c.isEssentialDefault ? "unmark essential" : "mark essential"}</button>
              <button className="text-fg-faint hover:text-critical" onClick={() => { mutate((db) => deleteCategory(db, c.id)); toast.success("Category removed"); }}><Trash2 size={13} /></button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
  return <div className="grid gap-4 lg:grid-cols-2">{list("business")}{list("personal")}</div>;
}

/* ----------------------------------------------------------------- backup */

function BackupTab() {
  const { exportDatabase, importDatabase, resetDatabase, data, lastSavedAt } = useReady();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingImport, setPendingImport] = useState<Uint8Array | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Backup" subtitle="Download the complete SQLite database. Keep copies somewhere safe; your browser is the only place this data lives.">
        <DefinitionList items={[{ label: "Transactions", value: data.transactions.length }, { label: "Clients", value: data.clients.length }, { label: "Closed months", value: data.monthCloses.length }, { label: "Last saved in browser", value: lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "—" }]} />
        <Button className="mt-4" variant="primary" onClick={() => { const bytes = exportDatabase(); downloadBlob(`finance-os-backup-${todayKey()}.sqlite`, bytes as BlobPart, "application/x-sqlite3"); toast.success("Backup downloaded"); }}><Download size={14} /> Download backup (.sqlite)</Button>
        <p className="mt-3 text-xs text-fg-faint">The file is a standard SQLite database. It opens in any SQLite tool, and restores here on any device.</p>
      </Card>
      <Card title="Restore" subtitle="Replace everything in this browser with a backup file">
        <input ref={fileRef} type="file" accept=".sqlite,.db,application/x-sqlite3,application/octet-stream" className="block w-full text-xs text-fg-muted file:mr-2 file:rounded-md file:border-0 file:bg-accent-soft file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-accent" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setPendingImport(await readFileBytes(f)); }} />
        <Button className="mt-3" disabled={!pendingImport} onClick={async () => { if (!pendingImport) return; try { await importDatabase(pendingImport); toast.success("Backup restored"); setPendingImport(null); if (fileRef.current) fileRef.current.value = ""; } catch (err) { toast.error("Restore failed", err instanceof Error ? err.message : String(err)); } }}><Upload size={14} /> Restore from file</Button>
        <Callout tone="caution" className="mt-4" title="Restoring overwrites current data">Download a backup of the current state first if you might want it back.</Callout>
        <div className="mt-6 border-t border-border pt-4">
          <Button variant="danger" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset to starting seed</Button>
          <p className="mt-2 text-xs text-fg-faint">Deletes everything in this browser and re-creates the initial profile (policy, accounts, subscriptions, household lines, client).</p>
        </div>
        <ConfirmModal open={confirmReset} onClose={() => setConfirmReset(false)} danger confirmLabel="Reset everything" title="Reset the database?" body="All transactions, clients, closes and settings in this browser are deleted. This cannot be undone unless you have a backup file." onConfirm={() => void resetDatabase().then(() => toast.success("Reset complete"))} />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- privacy */

function PrivacyTab() {
  const { isEncrypted, setPassphrase, lock } = useReady();
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Passphrase lock" subtitle="Encrypt the database at rest in this browser with AES-256 (key derived with PBKDF2)">
        <Callout tone={isEncrypted ? "positive" : "neutral"} title={isEncrypted ? "Encryption is on" : "Encryption is off"}>
          {isEncrypted ? "Your data is encrypted in browser storage and the app locks when you close the tab. Use the lock icon in the top bar to lock immediately." : "Data is stored unencrypted in this browser's storage. Anyone with access to this device profile could open it."}
        </Callout>
        <FormRow cols={2} className="mt-4">
          <Field label={isEncrypted ? "New passphrase" : "Passphrase"}><Input type="password" value={p1} onChange={(e) => setP1(e.target.value)} /></Field>
          <Field label="Repeat"><Input type="password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
        </FormRow>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} disabled={p1.length < 8 || p1 !== p2} onClick={async () => { setBusy(true); await setPassphrase(p1); setBusy(false); setP1(""); setP2(""); toast.success(isEncrypted ? "Passphrase changed" : "Encryption enabled"); }}><Lock size={14} /> {isEncrypted ? "Change passphrase" : "Enable encryption"}</Button>
          {isEncrypted && <Button onClick={async () => { await setPassphrase(null); toast.info("Encryption disabled"); }}><Unlock size={14} /> Disable</Button>}
          {isEncrypted && <Button variant="ghost" onClick={lock}>Lock now</Button>}
        </div>
        <p className="mt-3 text-xs text-fg-faint">Minimum 8 characters. There is no recovery: if you forget the passphrase, the only way back is a backup file.</p>
      </Card>
      <Card title="Where your data lives" subtitle="Plain answers">
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-fg-muted">
          <li>The app is static files. There is no server and no account; nothing is uploaded anywhere.</li>
          <li>Your database is a SQLite file held in this browser&apos;s IndexedDB, saved after every change.</li>
          <li>A different browser or device starts empty: move data with a backup file.</li>
          <li>Clearing site data in the browser deletes the database. Keep backups.</li>
          <li>The page is marked no-index for search engines.</li>
        </ul>
      </Card>
    </div>
  );
}
