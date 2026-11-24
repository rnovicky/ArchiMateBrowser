// CSV files of the browser: one format for all of them (the basket, the diagram's elements,
// an impact analysis). Fields are quoted (RFC 4180) and separated by a semicolon, which
// Excel with Czech regional settings (the comma is the decimal mark there) opens in columns.

export const CSV_DELIMITER = ';';

/** Rows (arrays of values) as CSV text: every field quoted, CRLF between rows. */
export function csvText(rows, delimiter = CSV_DELIMITER) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return rows.map(r => r.map(cell).join(delimiter)).join('\r\n');
}

/** CSV text as the content of a file: with a byte order mark, so that Excel reads it as UTF-8. */
export const csvFile = text => '﻿' + text;
