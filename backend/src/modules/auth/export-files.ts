import { crc32 } from 'node:zlib';

/**
 * File formats of the data export (RF20, Q11): CSV (RFC 4180) and a ZIP archive whose entries
 * are stored uncompressed. Written here because the export is a handful of small text files:
 * a ZIP of stored entries is three fixed-size records per file, which does not justify a
 * dependency (hard rule 12).
 */

export type CsvRow = Record<string, unknown>;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as string | number | boolean);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The header line is always present, so an empty data set is still a valid CSV file. */
export function toCsv(columns: readonly string[], rows: readonly CsvRow[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const UTF8_NAMES = 0x0800;

/** A ZIP archive with the given files, stored (method 0). */
export function zipStored(files: readonly { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory header signature
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed to extract
    entry.writeUInt16LE(UTF8_NAMES, 8);
    entry.writeUInt16LE(0, 10); // method: stored
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42); // offset of the local header
    directory.push(entry, name);

    offset += local.length + name.length + data.length;
  }

  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
