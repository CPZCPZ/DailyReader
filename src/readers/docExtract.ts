import * as cfb from 'cfb';

/**
 * .doc（Word 97-2003 二进制格式）文本提取。
 * 解析 OLE 复合文档 → WordDocument 流 → FIB → 0/1Table 流中的 piece table（PlcPcd），
 * 按每段的编码（UTF-16LE 或 8-bit ANSI）拼出全文。
 * 这是尽力而为的文本级支持（丢失格式）；完整支持见 Phase 4 服务端 LibreOffice 转换。
 */
export function extractDocText(data: ArrayBuffer): string {
  const cfbFile = cfb.read(new Uint8Array(data), { type: 'array' });
  const wordEntry = cfb.find(cfbFile, 'WordDocument');
  if (!wordEntry?.content) {
    throw new Error('不是有效的 .doc 文件，建议用 Word/WPS/LibreOffice 转存为 .docx');
  }
  const word = wordEntry.content as Uint8Array;
  if (word.length < 0x200) {
    throw new Error('.doc 文件损坏或过短，建议转存为 .docx');
  }

  const dv = new DataView(
    word.buffer,
    word.byteOffset,
    word.byteLength,
  );

  // FIB flags（偏移 0x0A）：bit 9 (0x0200) 决定 table 流是 1Table 还是 0Table
  const flags = dv.getUint16(0x0a, true);
  const tableName = (flags & 0x0200) !== 0 ? '1Table' : '0Table';
  const tableEntry = cfb.find(cfbFile, tableName);
  if (!tableEntry?.content) {
    throw new Error(`.doc 缺少 ${tableName} 流，建议转存为 .docx`);
  }
  const table = tableEntry.content as Uint8Array;

  // FibRgFcLcb97：fcClx @ 0x01A2，lcbClx @ 0x01A6
  const fcClx = dv.getUint32(0x01a2, true);
  const lcbClx = dv.getUint32(0x01a6, true);
  if (lcbClx === 0 || fcClx + lcbClx > table.length) {
    throw new Error('.doc 结构异常（无 piece table），建议转存为 .docx');
  }

  // 解析 Clx：跳过 Prc（0x01 + 2字节长度），找 Pcdt（0x02 + 4字节长度 + PlcPcd）
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  const clxDv = new DataView(
    clx.buffer,
    clx.byteOffset,
    clx.byteLength,
  );
  let pos = 0;
  let plc: Uint8Array | null = null;
  while (pos < clx.length) {
    const tag = clx[pos];
    if (tag === 0x01) {
      const cb = clxDv.getUint16(pos + 1, true);
      pos += 3 + cb;
    } else if (tag === 0x02) {
      const lcb = clxDv.getUint32(pos + 1, true);
      plc = clx.subarray(pos + 5, pos + 5 + lcb);
      break;
    } else {
      break;
    }
  }
  if (!plc) {
    throw new Error('.doc 无有效 piece table，建议转存为 .docx');
  }

  // PlcPcd = aCp[n+1]（u32）+ Pcd[n]（每项 8 字节）
  const n = Math.floor((plc.length - 4) / (4 + 8));
  if (n <= 0) {
    throw new Error('.doc 文本分段为空，建议转存为 .docx');
  }
  const plcDv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
  const pcdBase = (n + 1) * 4;

  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const cpStart = plcDv.getUint32(i * 4, true);
    const cpEnd = plcDv.getUint32((i + 1) * 4, true);
    const count = cpEnd - cpStart;
    if (count <= 0) continue;
    // PCD：2 字节标志 + 4 字节 FC + 2 字节 PRM
    const fc = plcDv.getUint32(pcdBase + i * 8 + 2, true);
    const compressed = (fc & 0x40000000) !== 0;
    const offset = fc & 0x3fffffff;
    if (compressed) {
      // 8-bit 文本（cp1252），实际偏移需除 2
      const start = offset >>> 1;
      const bytes = word.subarray(start, start + count);
      parts.push(cp1252ToUtf8(bytes));
    } else {
      // UTF-16LE
      const start = offset;
      const bytes = word.subarray(start, start + count * 2);
      parts.push(new TextDecoder('utf-16le').decode(bytes));
    }
  }

  const text = parts
    .join('')
    // 控制字符：07=单元格/行结束，0B=换行，0D=段落结束
    .replaceAll('\u0007', '\n')
    .replaceAll('\u000b', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\u000c', '\n')
    .replaceAll('\u001e', '-')
    .replaceAll('\u0000', '')
    .replaceAll('\ufeff', '');

  const cleaned = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

  if (!cleaned) {
    throw new Error('.doc 未能提取到文本，建议转存为 .docx');
  }
  return cleaned;
}

const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

function cp1252ToUtf8(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (CP1252_HIGH[b]) {
      out += CP1252_HIGH[b];
    } else {
      // Latin-1 补充区
      out += String.fromCharCode(b);
    }
  }
  return out;
}
