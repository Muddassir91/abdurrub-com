# CFoh! (Finance OS) · Retention Rules

Personal CFO and agency financial operating system for a solo marketing agency, built on Profit First allocations, zero-based budgeting, contribution-margin analysis, cash-flow management and rolling forecasting.

It is a complete single-page application: Next.js 16, TypeScript, Tailwind 4, Recharts, Drizzle ORM over **SQLite running in the browser** (sql.js / WebAssembly). The database is persisted to IndexedDB after every change, optionally encrypted with a passphrase. Nothing leaves the device; the deployed site is static files.

Live URL once merged to `main`: **https://abdurrub.com/cfoh/** (served by GitHub Pages from the `cfoh/` folder at the repo root).

---

## Run locally

```bash
cd finance-os
npm install --legacy-peer-deps   # peer-dependency noise from vitest/vite only
npm run dev                      # http://localhost:3000/cfoh/
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the financial engine and database tests (Vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run build` | Static export to `out/`. |
| `npm run export:site` | Build and copy the export into `../cfoh/` for GitHub Pages. |
| `npm run db:generate` | Regenerate SQL migrations from `src/db/schema.ts` and bundle them for the browser. |
| `node scripts/e2e-smoke.mjs` | Browser smoke test against the exported site (needs Playwright). |

### Deploying

The portfolio site deploys from `main` (root) on GitHub Pages. The app is committed as a built static export in `cfoh/`, plus a `.nojekyll` marker at the repo root so Pages serves the `_next/` folder. To ship a change:

```bash
cd finance-os && npm run export:site
git add ../cfoh ../.nojekyll finance-os
git commit -m "Update Finance OS" && git push
```

Merging to `main` publishes it at `https://abdurrub.com/cfoh/`.

### Workspaces (sign-up)

On first open the app shows a sign-up screen that creates a **workspace**. A workspace is one business or one person: its own SQLite database, its own policy, accounts, clients, settings and optional passphrase. Two templates exist: *Retention Rules* (pre-filled with the agency profile) and *Another business or person* (clean scaffolding). Add more from the switcher at the top of the sidebar or under *Settings → Workspaces*, and switch between them there. Workspaces never share data; move one to another device with its backup file.

There is no server, so there are no online accounts: "sign up" creates a local workspace in this browser. If you later want the same workspace shared across devices or people, the next step would be a hosted database with authentication; the engine and UI are built to make that an addition, not a rewrite.

### Appearance

*Settings → Appearance* chooses **Follow system**, **Light** or **Dark**. The sun/moon button in the top bar is a quick toggle. The preference is stored per browser and applied before first paint, so there is no flash.

**Privacy.** The URL is public but shows only the sign-up screen to anyone else. Your data exists solely in the browser profile where you entered it. Turn on the passphrase lock in *Settings → Privacy lock* to encrypt it at rest (AES-256-GCM, PBKDF2 key derivation); the app then locks when the tab is closed. Keep backups: there is no recovery for a lost passphrase.

---

## Architecture

```
finance-os/
├── src/lib/            money.ts (decimal-safe arithmetic), dates, constants, csv, ids
├── src/db/             schema.ts (Drizzle), client.ts (sql.js), persistence.ts (IndexedDB + crypto),
│                       seed.ts (your starting position), repo.ts (all mutations), migrations.ts (bundled SQL)
├── src/engine/         pure financial engine, no React:
│   ├── allocation.ts   policy validation, exact-sum allocation, policy selection by revenue band
│   ├── revenue.ts      earned / invoiced / collected / fees / net distributable / allocatable
│   ├── ledger.ts       account balances, envelope balances, bucket attribution
│   ├── expenses.ts     ceiling, ratios, overhead vs delivery, margins, essential cost, renewals
│   ├── owner.ts        owner compensation, household, discretionary, savings
│   ├── reserves.ts     coverage, target, projected date
│   ├── clients.ts      commission, concentration, client profitability, MRR
│   ├── processor.ts    Whop fee lines, payout fees, reserve release schedule
│   ├── investment.ts   new-expense and hiring evaluation
│   ├── scenarios.ts    revenue simulator
│   ├── forecast.ts     rolling cash-flow forecast
│   ├── alerts.ts       alert engine (what / why / impact / action, three levels)
│   ├── monthClose.ts   month-end report, variances, recommendations
│   └── snapshot.ts     composes everything into a MonthSnapshot
├── src/store/          FinanceProvider: owns the database, exposes data, snapshot, alerts, mutate()
├── src/components/     UI primitives, charts, shell, transaction form
├── src/app/            one route per module (dashboard, transactions, expenses, clients, whop,
│                       personal, accounts, reserves, tax, growth, scenarios, forecast, alerts,
│                       month-end, settings)
├── tests/              Vitest: allocation, snapshot/engine, database round trip
├── drizzle/            generated SQL migration
└── scripts/            bundle-migrations, copy-export, e2e-smoke
```

Everything is derived from one ledger (`transactions`) plus a handful of reference tables. Every figure on every page recomputes from the data on each render; there are no cached totals.

---

## Database schema

All money columns are **integer minor units** (USD cents, PKR paisa). Percentages and FX rates are decimal **strings**. Dates are `YYYY-MM-DD`; months are `YYYY-MM`.

| Table | Purpose |
| --- | --- |
| `settings` | Singleton: business/owner names, currencies, default PKR/USD rate, household budget ceiling ($1,000), discretionary goal ($5,000), gross-margin targets (65–75%), reserve months (3–6), concentration thresholds (50/75%), operating-ceiling override + justification, reminder windows, pinned policy. |
| `allocation_policies` | Profit First percentages (opex, owner, tax, profit, reserve, growth) with the revenue band they apply from. Seeded: 25/35/15/10/10/5. Validated to sum to exactly 100. |
| `entities` | Pakistani individual registration, Abdullah LLC (Wyoming). |
| `accounts` | Real and processor accounts with a role (operating, tax, profit, savings, growth, personal, processor_available, processor_restricted), currency, opening balance + date. |
| `transactions` | The ledger. `type` is one of 22 kinds (client_payment, expense, contractor/employee payment, growth_investment, household/personal expense, refund, chargeback, processing/conversion/payout/platform fee, reserve_hold/release, payout, owner_draw, profit_distribution, tax_payment, transfer, balance_adjustment). Stores original amount + currency + rate + USD amount, account (and destination for two-sided rows), client, invoice, processor, vendor, recurring link, batch `group_id`, `cost_type` (overhead vs direct_delivery), `bucket` (envelope), essential/recurring flags. |
| `recurring_expenses` | Subscriptions: amount, currency, frequency, category, cost type, envelope, renewal date, status (active / proposed / needs_config / paused / cancelled), essential flag, justification, ROI estimate. |
| `categories` | Business and personal categories (seeded from the spec), with an "essential" default. |
| `vendors` | Vendor directory. |
| `clients` | Agreement type, dates, revenue-share %, retainer, fixed fee, status, payment terms. |
| `client_revenue_periods` | Revenue **earned** per client per month: client-attributable revenue, share %, commission (computed), retainer, fixed fees. |
| `invoices` | Receivables with issue/due/expected dates; status derived from linked payments. |
| `household_budget_lines` | PKR budget lines (food, brother, parents, internet, electricity…). |
| `processors` | Whop with all fee defaults (domestic %, fixed, international surcharge, conversion, platform, ACH/wire/international/instant payout, default reserve %). |
| `processor_reserves` | Each hold: amount, date withheld, expected release, released date, status, reason, linked ledger rows. |
| `fx_rates` | Dated manual exchange rates. |
| `allocation_entries` | Virtual envelope credits/debits booked at month close or by explicit reassignment. |
| `month_closes` | Closed months with the frozen report JSON and checklist; `reopened` status withdraws bookings. |
| `tax_profiles` | Pakistan business, Wyoming LLC, owner personal. All marked estimates. |
| `compliance_items` | EIN, Form 5472, pro forma 1120, Wyoming annual report, registered agent, Pakistani return and registration, other deadlines. |
| `growth_proposals` | Evaluated subscriptions, hires, one-time investments and channels with the saved evaluation and decision. |
| `alert_snoozes` | Snoozed alert keys. |

Generated SQL lives in `drizzle/0000_*.sql`; the browser runs it from `src/db/migrations.ts` on first open, tracked in a `__migrations` table.

---

## Financial calculations

**Revenue** (per month, USD cents, each ledger row counted once)

```
collected          = Σ client_payment + income
net distributable  = collected − refunds − chargebacks − processing − conversion − platform − payout fees
allocatable        = max(0, net distributable − reserve holds this month + reserve releases this month)
```

Earned (accrual) and invoiced revenue are reported alongside but **never allocated**. Processor-restricted balances are excluded until a release row exists.

**Allocation.** The active policy (pinned, or highest revenue band reached) is applied to `allocatable` with a largest-remainder split so the six parts add up to the base exactly, to the cent. The operating share is a **ceiling**; an approved override in Settings can raise it, never lower it. Unspent allowance stays in business cash and can be reassigned to reserve or profit only by an explicit action at month end.

**Expenses**

```
overhead            = business spend with cost_type overhead (not growth envelope)
direct delivery     = business spend with cost_type direct_delivery
operating expense ratio = overhead / net distributable
gross profit        = net distributable − direct delivery;  gross margin = gross profit / net distributable
operating result    = gross profit − overhead − growth spend
net result after owner pay = operating result − owner draws
essential monthly   = trailing 3-month average of essential overhead, else essential active subscriptions
```

**Owner compensation**

```
owner target        = owner % × allocatable
discretionary available = owner target − actual household expenses
remaining personal budget = owner target − household − discretionary spend
personal savings    = owner draws − household − discretionary spend
```

Draws are transfers (business → personal); household and personal expenses are paid from the personal account. Nothing is double counted and personal budgets never scale with revenue.

**Reserves**

```
target            = essential monthly × target months (default 3, configurable 3–6)
coverage (months) = reserve envelope balance / essential monthly
months to target  = ceil((target − balance) / this month's reserve allocation)
```

**Envelopes.** Virtual balances = Σ allocation entries − Σ ledger rows charged to that envelope. The dashboard also shows the real balance of the matching account (tax, profit, savings, growth) so underfunded envelopes are visible.

**Clients.** Commission = client-attributable revenue × share %. Concentration = largest client's earned (or collected) share; alerts at 50% and 75%. Client profit = earned − associated expenses.

**Whop.** Per sale: processing = gross × domestic % + fixed (+ international surcharge if ticked); conversion and platform fees only if ticked; reserve hold moves `net × reserve %` to the restricted account. Every component can be overridden with the statement figure.

**Investment evaluation.** New opex ratio, revenue needed to carry the cost inside the ceiling (`cost / opex %`), monthly break-even, break-even months for one-time cost, projected gross margin for hires, reserve coverage gate (≥ 1 month). Verdict: affordable / conditional / not recommended. Available growth budget alone never yields "affordable".

**Scenarios.** Same allocation function at a chosen revenue; household budget fixed; discretionary capped at the goal; projected accumulation = (profit + reserve + unspent opex) × months.

**Forecast.** Per future month: dated open invoices + dated reserve releases + recurring revenue estimate (retainers + trailing commission) − active subscriptions − planned owner comp at policy %.

---

## Tests

```bash
npm test
```

30 tests across three files:

- `tests/allocation.test.ts` — Scenarios A ($4,000), B ($10,000), C ($20,000) produce exactly 1,000/1,400/600/400/400/200, 2,500/3,500/1,500/1,000/1,000/500 and 5,000/7,000/3,000/2,000/2,000/1,000, each summing to the base; awkward amounts and 33.33/33.33/33.34 splits still sum exactly; invalid policies rejected; zero/negative revenue yields zero targets; policy selection by band and pin; money parsing, PKR conversion, formatting.
- `tests/snapshot.test.ts` — pending payments not allocated and flagged overdue; refunds, chargebacks and every fee subtracted once; payouts and transfers are neither revenue nor expense; processor reserves excluded until released and projected in the forecast; zero-revenue month with spending; PKR household spend at per-transaction rates with no double counting of draws; ceiling / remaining / ratio / margins; approved ceiling override; over-ceiling alert; commission math; concentration at 60% and 75%; Whop fee and payout math; subscription evaluation; hire rejected without reserves/revenue and accepted with them; simulator never scales personal spending; reserve coverage/target/date; month report variances; scale-stage policy switch.
- `tests/database.test.ts` — real SQLite: migrations run, seed matches the profile ($831 known subscriptions, PKR 195,000 household, 20% client), insert, export, reopen, engine produces Scenario A from the stored data.

The browser smoke test (`scripts/e2e-smoke.mjs`) boots the exported site in Chromium, records USD and PKR transactions, verifies dashboard numbers, persistence across reload, dark mode, scenarios, a Whop sale with fee lines, a month close, envelope booking and backup download, and checks every route for runtime errors.

---

## Backup and restore

- **Backup:** *Settings → Backup & restore → Download backup (.sqlite)*. The file is a standard SQLite database.
- **Restore:** same tab, choose the file, *Restore from file*. The current database is replaced after the file is validated.
- **Transactions CSV:** *Transactions → Export CSV / Import CSV* (same column layout both ways).
- **Monthly reports:** *Month-end → Reports → download JSON*.
- **Reset:** *Settings → Backup & restore → Reset to starting seed*.

Data lives only in the browser profile that created it. Clearing site data deletes it; a different browser starts empty. Back up before clearing anything, and after every month close.

---

## Safeguards built in

Uncollected revenue is never allocated; restricted processor funds are never spendable; each fee row is subtracted once; transfers, draws and payouts never count as income or expense; a client's store revenue is never agency revenue; unspent allowance is never treated as income; accounting profit is reported separately from cash; personal budgets never rise automatically with revenue; tax is a provision marked as an estimate, and the Wyoming LLC is never treated as tax-free.
