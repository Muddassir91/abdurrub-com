import Papa from "papaparse";

export function toCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(rows);
}

export function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  return { rows: res.data, errors: res.errors.map((e) => `${e.message}${e.row != null ? ` (row ${e.row + 2})` : ""}`) };
}

export function downloadBlob(filename: string, content: BlobPart, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

/** Find a column in a loosely formatted CSV header by candidate names (case-insensitive, partial). */
export function pickColumn(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const exact = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (exact) return exact;
  }
  for (const c of candidates) {
    const partial = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()));
    if (partial) return partial;
  }
  return undefined;
}

/** Parse many date formats to YYYY-MM-DD. */
export function normaliseDate(input: string): string | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) {
    // Assume MM/DD/YYYY (US, Whop exports) unless the first part is > 12.
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [mm, dd] = a > 12 ? [b, a] : [a, b];
    return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
