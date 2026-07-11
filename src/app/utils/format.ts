// Shared plain-text formatting for invoice / copy-to-clipboard features.
//
// Standard line format across the app: "INDEX = VALUE" (e.g. "35 = 10000"),
// one entry per line, no thousands separators. Sort mode controls ordering:
//   'index' -> ascending by number (00, 01, ... 99)
//   'value' -> descending by amount (largest first)

export interface IndexValueRow {
  number: string;
  amount: number;
}

export type IndexValueSort = 'index' | 'value';

export function sortIndexValueRows<T extends IndexValueRow>(rows: T[], sortMode: IndexValueSort): T[] {
  return sortMode === 'index'
    ? [...rows].sort((a, b) => a.number.localeCompare(b.number))
    : [...rows].sort((a, b) => b.amount - a.amount);
}

/** Renders rows as bare "NUM = AMOUNT" lines, one per line, no formatting. */
export function formatIndexValueLines(rows: IndexValueRow[], sortMode: IndexValueSort = 'index'): string {
  return sortIndexValueRows(rows, sortMode).map(r => `${r.number} = ${r.amount}`).join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
