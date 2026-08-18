import Papa from 'papaparse';

/**
 * Lead-file parsing.
 *
 * Real lead exports are messy: sometimes a single column of addresses with no
 * header, sometimes a full CRM dump where the email is the fourth column, often
 * with duplicates. Rather than demanding a specific column name, we scan every
 * cell for anything that looks like an address. A plain .txt with one address
 * per line falls out of the same code path.
 */

// Deliberately permissive — the backend re-validates with zod, and rejecting a
// valid-but-unusual address here would be worse than passing it through.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export interface ParsedLeads {
  emails: string[];
  /** How many addresses were found before de-duplication. */
  totalFound: number;
  duplicatesRemoved: number;
  rowCount: number;
}

export function extractEmails(text: string): string[] {
  return text.match(EMAIL_PATTERN) ?? [];
}

export async function parseLeadFile(file: File): Promise<ParsedLeads> {
  const text = await file.text();

  // header:false because we cannot assume a header row exists.
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    header: false,
  });

  const found: string[] = [];
  for (const row of result.data) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (typeof cell === 'string') found.push(...extractEmails(cell));
    }
  }

  // Fall back to scanning the raw text if the CSV shape defeated the parser.
  if (found.length === 0) found.push(...extractEmails(text));

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of found) {
    const email = raw.toLowerCase().trim();
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return {
    emails,
    totalFound: found.length,
    duplicatesRemoved: found.length - emails.length,
    rowCount: result.data.length,
  };
}
