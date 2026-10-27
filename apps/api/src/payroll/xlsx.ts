/**
 * Minimal dependency-free XLSX reader/writer (ZIP via node:zlib).
 * Supports exactly what the timesheet feature needs: multiple sheets, text,
 * numbers, formulas with cached values, and a few number formats.
 */
import zlib from 'node:zlib';

export type XStyle = 'time' | 'bold' | 'money' | 'num2';
export interface XCell {
  v?: string | number | null;
  /** Formula without leading '='. `v` is stored as the cached result. */
  f?: string;
  style?: XStyle;
}
export interface XSheet {
  name: string;
  rows: (XCell | null | undefined)[][];
  colWidths?: number[];
}
export interface ReadSheet {
  name: string;
  cells: Map<string, string | number>;
}

const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_ENTRIES = 300;

// ---------------------------------------------------------------- CRC / ZIP

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function unzipFiles(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Tệp không phải định dạng .xlsx hợp lệ.');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES)
    throw new Error('Tệp .xlsx có quá nhiều thành phần.');
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Tệp .xlsx bị hỏng (central directory).');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    total += usize;
    if (total > MAX_UNCOMPRESSED)
      throw new Error('Tệp .xlsx giải nén quá lớn.');
    if (buf.readUInt32LE(lho) !== 0x04034b50)
      throw new Error('Tệp .xlsx bị hỏng (local header).');
    const start =
      lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8)
      data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNCOMPRESSED });
    else throw new Error('Tệp .xlsx dùng kiểu nén không hỗ trợ.');
    out.set(name.replace(/^\//, ''), data);
  }
  return out;
}

// ---------------------------------------------------------------- XML utils

const esc = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, '&');

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const STYLE_INDEX: Record<XStyle, number> = {
  time: 1,
  bold: 2,
  money: 3,
  num2: 4,
};

// ---------------------------------------------------------------- Writer

export function buildXlsx(sheets: XSheet[]): Buffer {
  const files: { name: string; data: Buffer }[] = [];
  const add = (name: string, xml: string) =>
    files.push({ name, data: Buffer.from(xml, 'utf8') });
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  add(
    '[Content_Types].xml',
    H +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_s, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  );
  add(
    '_rels/.rels',
    H +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  add(
    'xl/workbook.xml',
    H +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    H +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  add(
    'xl/styles.xml',
    H +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="20" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs></styleSheet>',
  );
  sheets.forEach((s, i) => {
    let xml =
      H +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (s.colWidths?.length)
      xml +=
        '<cols>' +
        s.colWidths
          .map(
            (w, k) =>
              `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`,
          )
          .join('') +
        '</cols>';
    xml += '<sheetData>';
    s.rows.forEach((row, r) => {
      const cells = (row ?? [])
        .map((c, k) => {
          if (!c) return '';
          if ((c.v === null || c.v === undefined) && !c.f) return '';
          const ref = `${colName(k)}${r + 1}`;
          const st = c.style ? ` s="${STYLE_INDEX[c.style]}"` : '';
          if (c.f) {
            const cached =
              typeof c.v === 'number'
                ? `<v>${c.v}</v>`
                : typeof c.v === 'string'
                  ? `<v>${esc(c.v)}</v>`
                  : '';
            const t = typeof c.v === 'string' ? ' t="str"' : '';
            return `<c r="${ref}"${st}${t}><f>${esc(c.f)}</f>${cached}</c>`;
          }
          if (typeof c.v === 'number')
            return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
        })
        .join('');
      if (cells) xml += `<row r="${r + 1}">${cells}</row>`;
    });
    xml += '</sheetData></worksheet>';
    add(`xl/worksheets/sheet${i + 1}.xml`, xml);
  });
  return zipFiles(files);
}

// ---------------------------------------------------------------- Reader

export function readXlsx(buf: Buffer): ReadSheet[] {
  const files = unzipFiles(buf);
  const text = (n: string): string | null => {
    const b = files.get(n);
    return b ? b.toString('utf8') : null;
  };
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('Tệp không phải định dạng .xlsx hợp lệ.');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[1]!)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[1]!)?.[1];
    if (id && target)
      relTarget.set(
        id,
        target.startsWith('/') ? target.slice(1) : `xl/${target}`,
      );
  }
  const shared: string[] = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      let s = '';
      for (const t of si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
        s += unesc(t[1]!);
      shared.push(s);
    }
  }
  const sheets: ReadSheet[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    const name = unesc(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const path = relTarget.get(rid);
    const xml = path ? text(path) : null;
    if (!xml) continue;
    const cells = new Map<string, string | number>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1]!;
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(a)?.[1];
      if (!ref || !c[2]) continue;
      const type = /\bt="([^"]*)"/.exec(a)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
      if (type === 'inlineStr') {
        let s = '';
        for (const t of c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
          s += unesc(t[1]!);
        if (s !== '') cells.set(ref, s);
      } else if (v && v[1] !== '') {
        if (type === 's') {
          const s = shared[Number(v[1])];
          if (s !== undefined && s !== '') cells.set(ref, s);
        } else if (type === 'str') cells.set(ref, unesc(v[1] ?? ''));
        else if (type === 'b' || type === 'e') continue;
        else {
          const n = Number(v[1]);
          if (Number.isFinite(n)) cells.set(ref, n);
        }
      }
    }
    sheets.push({ name, cells });
  }
  return sheets;
}
