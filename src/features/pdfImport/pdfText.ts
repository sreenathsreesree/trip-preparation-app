import { unzlibSync, inflateSync } from 'fflate';

/**
 * Reads the text of a PDF on the device (no upload, no service, no key).
 * Handles compressed (Flate) content and object streams, fonts with
 * ToUnicode maps (what Word, Google Docs and browsers produce) and simple
 * one-byte fonts, page by page in reading order of the page tree.
 * Scanned PDFs contain pictures of text, not text: they yield (almost) no
 * text, and the caller offers to paste the text instead (no OCR on the device).
 */

interface PdfObject {
  dict: string;
  stream: Uint8Array | null;
}

const latin1 = (bytes: Uint8Array, from = 0, to = bytes.length) => {
  let s = '';
  for (let i = from; i < to; i += 8192) s += String.fromCharCode(...bytes.subarray(i, Math.min(to, i + 8192)));
  return s;
};

function decodeStream(dict: string, raw: Uint8Array): Uint8Array | null {
  if (!/\/Filter\s*(\[\s*)?\/FlateDecode/.test(dict)) return /\/Filter/.test(dict) ? null : raw;
  try {
    return unzlibSync(raw);
  } catch {
    try {
      return inflateSync(raw);
    } catch {
      return null;
    }
  }
}

/** All indirect objects, including those inside object streams. */
export function readObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = latin1(bytes);
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const s = body.search(/stream\r?\n/);
    let dict = body;
    let stream: Uint8Array | null = null;
    if (s >= 0) {
      dict = body.slice(0, s);
      const dataStart = start + s + (body.slice(s, s + 8) === 'stream\r\n' ? 8 : 7);
      const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = lenMatch ? dataStart + Number(lenMatch[1]) : text.indexOf('endstream', dataStart);
      if (dataEnd > end || dataEnd < dataStart) dataEnd = text.indexOf('endstream', dataStart);
      const decoded = decodeStream(dict, bytes.subarray(dataStart, dataEnd));
      stream = decoded;
    }
    objects.set(num, { dict, stream });
    re.lastIndex = end;
  }
  // Objects stored inside compressed object streams (PDF 1.5+).
  for (const [, obj] of [...objects]) {
    if (!/\/Type\s*\/ObjStm/.test(obj.dict) || !obj.stream) continue;
    const n = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1] ?? 0);
    const content = latin1(obj.stream);
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2] as number;
      const off = first + (header[i * 2 + 1] as number);
      const next = i + 1 < n ? first + (header[(i + 1) * 2 + 1] as number) : content.length;
      if (!objects.has(num)) objects.set(num, { dict: content.slice(off, next), stream: null });
    }
  }
  return objects;
}

const ref = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};

/** Code → text from a ToUnicode CMap, with the code length in bytes. */
export function parseCMap(cmap: string): { map: Map<number, string>; bytes: number } {
  const map = new Map<number, string>();
  const hexToStr = (hex: string) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) out = String.fromCharCode(parseInt(hex, 16));
    return out;
  };
  const space = /<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>/.exec(/begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap)?.[1] ?? '');
  const bytes = space ? Math.max(1, (space[1] as string).length / 2) : 2;
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of (block[1] as string).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(p[1] as string, 16), hexToStr(p[2] as string));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of (block[1] as string).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1] as string, 16);
      const hi = parseInt(p[2] as string, 16);
      const dst = p[3] as string;
      if (dst.startsWith('[')) {
        const items = [...dst.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexToStr(x[1] as string));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo] as string);
      } else {
        const base = dst.slice(1, -1);
        const start = parseInt(base.slice(-4) || '0', 16);
        const prefix = hexToStr(base.slice(0, -4));
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, prefix + String.fromCharCode(start + (c - lo)));
      }
    }
  }
  return { map, bytes };
}

type Font = { map: Map<number, string>; bytes: number } | null;

/** The /Resources dictionary of a page or form, following references and (for pages) inheritance from parent Pages nodes. */
function resourcesOf(objects: Map<number, PdfObject>, dict: string, inherit = true): string {
  let current: string | null = dict;
  for (let depth = 0; current !== null && depth < 20; depth++) {
    const resRef = ref(current, 'Resources');
    if (resRef !== null) return objects.get(resRef)?.dict ?? '';
    const inline = /\/Resources\s*(<<[\s\S]*)/.exec(current)?.[1];
    if (inline) return inline;
    if (!inherit) return '';
    const parent = ref(current, 'Parent');
    current = parent !== null ? (objects.get(parent)?.dict ?? null) : null;
  }
  return '';
}

/** A sub-dictionary of resources (/Font, /XObject) as name → object number. */
function namedRefs(objects: Map<number, PdfObject>, resources: string, key: string): Map<string, number> {
  let body = new RegExp(`/${key}\\s*<<([\\s\\S]*?)>>`).exec(resources)?.[1] ?? '';
  const r = ref(resources, key);
  if (r !== null && !body) body = objects.get(r)?.dict ?? '';
  const out = new Map<string, number>();
  for (const m of body.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) out.set(m[1] as string, Number(m[2]));
  return out;
}

export interface FontReport {
  /** Fonts using multi-byte codes without a ToUnicode map: their text can't be read. */
  unreadable: number;
}

function fontsFrom(objects: Map<number, PdfObject>, resources: string, report: FontReport): Map<string, Font> {
  const fonts = new Map<string, Font>();
  for (const [name, num] of namedRefs(objects, resources, 'Font')) {
    const fontObj = objects.get(num);
    const tu = fontObj ? ref(fontObj.dict, 'ToUnicode') : null;
    const cmap = tu !== null ? objects.get(tu)?.stream : null;
    if (!cmap && fontObj && /\/Subtype\s*\/Type0/.test(fontObj.dict)) report.unreadable += 1;
    fonts.set(name, cmap ? parseCMap(latin1(cmap)) : null);
  }
  return fonts;
}

/** Text drawn inside form XObjects (used by many design tools and exporters), one level of nesting deep each. */
function xobjectText(objects: Map<number, PdfObject>, resources: string, report: FontReport, depth: number): (name: string) => string {
  const forms = namedRefs(objects, resources, 'XObject');
  return (name: string) => {
    if (depth > 4) return '';
    const num = forms.get(name);
    const form = num !== undefined ? objects.get(num) : undefined;
    if (!form?.stream || !/\/Subtype\s*\/Form/.test(form.dict)) return '';
    const own = resourcesOf(objects, form.dict, false) || resources;
    return contentText(latin1(form.stream), fontsFrom(objects, own, report), xobjectText(objects, own, report, depth + 1));
  };
}

function pageList(objects: Map<number, PdfObject>): number[] {
  const catalog = [...objects.entries()].find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict));
  const root = catalog ? ref(catalog[1].dict, 'Pages') : null;
  const out: number[] = [];
  const walk = (num: number, depth: number) => {
    const o = objects.get(num);
    if (!o || depth > 50) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) {
      out.push(num);
      return;
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? '';
    for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
  };
  if (root !== null) walk(root, 0);
  if (out.length === 0) for (const [n, o] of objects) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) out.push(n);
  return out;
}

function decodeString(raw: string, hex: boolean, font: Font): string {
  let bytes: number[];
  if (hex) {
    const h = raw.replace(/[^0-9a-fA-F]/g, '');
    bytes = [];
    for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2).padEnd(2, '0'), 16));
  } else {
    bytes = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i] as string;
      if (c !== '\\') {
        bytes.push(c.charCodeAt(0) & 0xff);
        continue;
      }
      const n = raw[++i] ?? '';
      const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n in esc) bytes.push(esc[n] as number);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      }
    }
  }
  if (!font) return String.fromCharCode(...bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += font.bytes) {
    let code = 0;
    for (let k = 0; k < font.bytes; k++) code = (code << 8) | (bytes[i + k] ?? 0);
    out += font.map.get(code) ?? (font.bytes === 1 ? String.fromCharCode(code) : '');
  }
  return out;
}

/** Text of one content stream, with line breaks where the text moves to a new line. */
export function contentText(content: string, fonts: Map<string, Font>, xobject: (name: string) => string = () => ''): string {
  let out = '';
  let font: Font = null;
  let lastY: number | null = null;
  const operands: string[] = [];
  const tokens = content.matchAll(/\((?:\\[\s\S]|[^\\)]|\((?:\\[\s\S]|[^\\)])*\))*\)|<[0-9a-fA-F\s]*>|\[(?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|[^\]])*\]|\/[^\s/[\]()<>]+|[-+]?\d*\.?\d+|[A-Za-z'"*]+/g);
  const newline = () => {
    gap = false;
    if (out && !out.endsWith('\n')) out += '\n';
  };
  // Another run on the same line: a word gap, unless the previous run was a
  // lone letter (kerning splits "Visit" into "V" + "isit").
  let gap = false;
  const sameLineGap = () => {
    if (out && !out.endsWith(' ') && !out.endsWith('\n')) gap = true;
  };
  const append = (text: string) => {
    if (gap && text) {
      // "W" + "aterfalls": a kerning split of one word, not two words.
      const split = /(^|[\s(])[A-Z]$/.test(out) && /^[a-z]/.test(text);
      if (!split && !text.startsWith(' ')) out += ' ';
      gap = false;
    }
    out += text;
  };
  const show = (token: string) => {
    if (token.startsWith('(')) append(decodeString(token.slice(1, -1), false, font));
    else if (token.startsWith('<')) append(decodeString(token.slice(1, -1), true, font));
  };
  for (const t of tokens) {
    const tok = t[0];
    if (/^[A-Za-z'"*]+$/.test(tok)) {
      switch (tok) {
        case 'Tf':
          font = fonts.get((operands[operands.length - 2] ?? '').slice(1)) ?? null;
          break;
        case 'Tj':
          show(operands[operands.length - 1] ?? '');
          break;
        case "'":
        case '"':
          newline();
          show(operands[operands.length - 1] ?? '');
          break;
        case 'TJ': {
          const arr = operands[operands.length - 1] ?? '';
          for (const part of arr.matchAll(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|[-+]?\d*\.?\d+/g)) {
            const p = part[0];
            if (/^[-+]?\d/.test(p)) {
              if (Number(p) < -200 && !out.endsWith(' ')) out += ' ';
            } else show(p);
          }
          break;
        }
        case 'Td':
        case 'TD': {
          const ty = Number(operands[operands.length - 1] ?? 0);
          if (Math.abs(ty) > 0.1) newline();
          else sameLineGap();
          break;
        }
        case 'Tm': {
          const y = Number(operands[operands.length - 1] ?? 0);
          if (lastY !== null && Math.abs(y - lastY) > 0.5) newline();
          else if (lastY !== null) sameLineGap();
          lastY = y;
          break;
        }
        case 'T*':
          newline();
          break;
        case 'Do': {
          const inner = xobject((operands[operands.length - 1] ?? '').slice(1));
          if (inner.trim()) {
            newline();
            out += inner;
            newline();
          }
          break;
        }
        case 'ET':
          break;
        case 'BT':
          break;
      }
      operands.length = 0;
    } else operands.push(tok);
  }
  return out;
}

export interface PdfTextResult {
  pages: string[];
  text: string;
  /** Likely a scan (pictures of text): almost no readable letters. */
  looksScanned: boolean;
  /** Fonts whose text can't be decoded (no ToUnicode map); explains missing text that isn't a scan. */
  unreadableFonts: number;
}

export class PdfReadError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_pdf' | 'encrypted' | 'no_pages',
  ) {
    super(message);
  }
}

export function extractPdfText(bytes: Uint8Array): PdfTextResult {
  if (latin1(bytes, 0, Math.min(bytes.length, 1024)).indexOf('%PDF') < 0) throw new PdfReadError('This file is not a PDF.', 'not_pdf');
  const tail = latin1(bytes, Math.max(0, bytes.length - 4096));
  const objects = readObjects(bytes);
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || [...objects.values()].some((o) => /\/Type\s*\/XRef/.test(o.dict) && /\/Encrypt\s/.test(o.dict))) {
    throw new PdfReadError('This PDF is password-protected or encrypted, so its text can’t be read. Open it, copy the itinerary text and paste it below.', 'encrypted');
  }
  const list = pageList(objects);
  if (list.length === 0) throw new PdfReadError('No pages were found in this PDF. It may be damaged — try exporting it again, or paste the text.', 'no_pages');
  const report: FontReport = { unreadable: 0 };
  const pages = list.map((num) => {
    const page = objects.get(num) as PdfObject;
    const resources = resourcesOf(objects, page.dict);
    const fonts = fontsFrom(objects, resources, report);
    const forms = xobjectText(objects, resources, report, 0);
    const contents: number[] = [];
    const single = ref(page.dict, 'Contents');
    if (single !== null) {
      const target = objects.get(single);
      // /Contents may point to an array object of streams.
      if (target && !target.stream && /\[/.test(target.dict)) for (const k of target.dict.matchAll(/(\d+)\s+\d+\s+R/g)) contents.push(Number(k[1]));
      else contents.push(single);
    } else {
      const arr = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1] ?? '';
      for (const k of arr.matchAll(/(\d+)\s+\d+\s+R/g)) contents.push(Number(k[1]));
    }
    return contents
      .map((c) => objects.get(c)?.stream)
      .filter((s): s is Uint8Array => !!s)
      .map((s) => contentText(latin1(s), fonts, forms))
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
  const text = pages.join('\n\n');
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return { pages, text, looksScanned: letters < 20 * Math.max(1, pages.length), unreadableFonts: report.unreadable };
}
