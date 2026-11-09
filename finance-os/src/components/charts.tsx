"use client";

import React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, type Minor } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import { BUCKET_SHORT, type Bucket } from "@/lib/constants";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
export const BUCKET_COLORS: Record<Bucket, string> = { opex: "var(--chart-3)", owner: "var(--chart-1)", tax: "var(--chart-5)", profit: "var(--chart-6)", reserve: "var(--chart-2)", growth: "var(--chart-4)" };

const usd = (v: number) => formatMoney(v, "USD", { compact: true, decimals: 0 });
const usdFull = (v: number) => formatMoney(v, "USD");

const axisProps = { tick: { fill: "var(--fg-faint)", fontSize: 11 }, axisLine: { stroke: "var(--border)" }, tickLine: false as const };

export function RevenueExpenseChart({ data, height = 260 }: { data: { month: string; net: Minor; collected: Minor; overhead: Minor; direct: Minor; growth: Minor; ownerDrawn: Minor; profit: Minor }[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month), spend: d.overhead + d.direct + d.growth }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={usd} width={56} />
        <Tooltip formatter={(v) => usdFull(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--fg-muted)" }} />
        <Bar name="Net revenue" dataKey="net" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Bar name="Business spend" dataKey="spend" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
        <Bar name="Owner draws" dataKey="ownerDrawn" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
        <Line type="monotone" name="Net result" dataKey="profit" stroke="var(--chart-6)" dot={false} strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AllocationDonut({ allocations, height = 220 }: { allocations: Record<Bucket, Minor>; height?: number }) {
  const rows = (Object.keys(allocations) as Bucket[]).map((b) => ({ name: BUCKET_SHORT[b], value: allocations[b], bucket: b })).filter((r) => r.value > 0);
  if (rows.length === 0) return <div className="flex h-[220px] items-center justify-center text-xs text-fg-faint">No allocatable revenue yet this month.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="var(--surface)" isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.bucket} fill={BUCKET_COLORS[r.bucket]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => usdFull(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--fg-muted)" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, series, height = 220, stacked }: { data: Record<string, number | string>[]; series: { key: string; name: string; color?: string }[]; height?: number; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={usd} width={56} />
        <Tooltip formatter={(v) => usdFull(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--fg-muted)" }} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stackId={stacked ? "a" : undefined} stroke={s.color ?? COLORS[i % COLORS.length]} fill={s.color ?? COLORS[i % COLORS.length]} fillOpacity={0.15} strokeWidth={2} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, height = 220, color = "var(--chart-1)", name = "Amount" }: { data: { label: string; value: number }[]; height?: number; color?: string; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis type="number" {...axisProps} tickFormatter={usd} />
        <YAxis type="category" dataKey="label" {...axisProps} width={120} />
        <Tooltip formatter={(v) => usdFull(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut of spending by category with the total in the middle. Amounts are already in display units. */
export function CategoryDonut({ rows, total, currency, height = 220 }: { rows: { name: string; value: number }[]; total: number; currency: string; height?: number }) {
  const fmt = (v: number) => formatMoney(v, currency as Parameters<typeof formatMoney>[1], { decimals: 0 });
  if (rows.length === 0 || total <= 0) return <div className="flex items-center justify-center text-xs text-fg-faint" style={{ height }}>Nothing spent yet this month.</div>;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="var(--surface)" isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={r.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => fmt(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] font-medium text-fg-muted">Spent</div>
        <div className="tabular text-lg font-semibold text-fg">{fmt(total)}</div>
      </div>
    </div>
  );
}

export const CATEGORY_COLORS = COLORS;

/** Compact in/out bars for the last few periods. Values are display units. */
export function InOutBars({ data, currency, height = 180 }: { data: { label: string; in: number; out: number }[]; currency: string; height?: number }) {
  const fmt = (v: number) => formatMoney(v, currency as Parameters<typeof formatMoney>[1], { compact: true, decimals: 0 });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={3}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} interval={0} />
        <YAxis {...axisProps} tickFormatter={fmt} width={48} />
        <Tooltip formatter={(v) => formatMoney(Number(v), currency as Parameters<typeof formatMoney>[1])} cursor={{ fill: "var(--surface-2)" }} />
        <Bar name="In" dataKey="in" fill="var(--chart-6)" radius={[4, 4, 0, 0]} />
        <Bar name="Out" dataKey="out" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CashProjection({ data, height = 240 }: { data: { label: string; cash: number; inflow: number; outflow: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={usd} width={56} />
        <Tooltip formatter={(v) => usdFull(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--fg-muted)" }} />
        <Line type="monotone" dataKey="cash" name="Projected cash" stroke="var(--chart-1)" strokeWidth={2} dot />
        <Line type="monotone" dataKey="inflow" name="Expected inflows" stroke="var(--chart-6)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        <Line type="monotone" dataKey="outflow" name="Planned outflows" stroke="var(--chart-3)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}
