// ストリーム読み込みの CSV（RFC 4180 相当）。巨大な stop_times.txt でも全体をメモリに載せない。
// 対応：UTF-8 の BOM、CRLF/LF、引用符の中の改行・カンマ・二重引用符（""）。
import { createReadStream } from "node:fs";

/** 1 行ずつ（列の配列で）返す。 */
export async function* readCsvRows(path: string): AsyncGenerator<string[]> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let quotePending = false; // 引用符の中で " を見た直後（"" か終わりかを次の文字で判断）
  let first = true;
  for await (const chunkAny of stream) {
    let chunk = chunkAny as string;
    if (first) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      first = false;
    }
    const n = chunk.length;
    let i = 0;
    while (i < n) {
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (chunk[i] === '"') {
            field += '"';
            i++;
            continue;
          }
          inQuotes = false;
          continue; // 引用の終わり。同じ文字を引用の外として処理
        }
        const q = chunk.indexOf('"', i);
        if (q < 0) {
          field += chunk.slice(i);
          i = n;
        } else {
          field += chunk.slice(i, q);
          quotePending = true;
          i = q + 1;
        }
        continue;
      }
      const c = chunk.charCodeAt(i);
      if (c === 34 /* " */) {
        inQuotes = true;
        i++;
      } else if (c === 44 /* , */) {
        row.push(field);
        field = "";
        i++;
      } else if (c === 10 /* \n */) {
        row.push(field);
        field = "";
        if (!(row.length === 1 && row[0] === "")) yield row;
        row = [];
        i++;
      } else if (c === 13 /* \r */) {
        i++;
      } else {
        // 次の区切りまでまとめて取る（速さのため）
        let j = i + 1;
        while (j < n) {
          const d = chunk.charCodeAt(j);
          if (d === 44 || d === 10 || d === 13 || d === 34) break;
          j++;
        }
        field += chunk.slice(i, j);
        i = j;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) yield row;
  }
}

/** 見出し行を使って、列名→値の形で返す。列名の前後の空白は取り除く。 */
export async function* readCsvRecords(path: string): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const row of readCsvRows(path)) {
    if (!header) {
      header = row.map((h) => h.trim());
      continue;
    }
    const rec: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = (row[i] ?? "").trim();
    yield rec;
  }
}
