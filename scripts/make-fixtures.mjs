#!/usr/bin/env node
/**
 * 生成各格式测试样书到 fixtures/ 目录（npm run fixtures）。
 * txt(GBK) / md / html 直接生成；epub / docx 用 fflate 打 zip 结构；pdf 手写最小合法 PDF。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import iconv from 'iconv-lite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'fixtures');
mkdirSync(outDir, { recursive: true });

const w = (name, data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  writeFileSync(join(outDir, name), buf);
  console.log(`✓ fixtures/${name} (${buf.length} bytes)`);
};

/* ---------- TXT（GBK 编码中文） ---------- */
const txt = Array.from({ length: 60 }, (_, i) =>
  `第${i + 1}段　这是一段用于测试 GBK 编码检测的中文文本。DailyReader 应当通过 chardet 自动识别编码，并将其正确解码为简体中文。书山有路勤为径，学海无涯苦作舟。`,
).join('\n\n');
w('sample-gbk.txt', iconv.encode(txt, 'gbk'));
w('sample-utf8.txt', 'UTF-8 编码的普通文本。\n\n第二段：Day 1 阅读。'.repeat(30));

/* ---------- Markdown ---------- */
const md = `# Markdown 测试文档

这是一本 **Markdown** 电子书，用于测试 \`MdReader\`。

## 列表

- 支持 GFM 列表
- 支持 [链接](https://example.com)
- 支持表格：

| 格式 | 渲染方案 | 进度 |
|---|---|---|
| EPUB | epub.js | CFI |
| PDF | pdf.js | 页码 |

## 代码

\`\`\`js
console.log('Hello DailyReader');
\`\`\`

> 引用：读书破万卷，下笔如有神。

${Array.from({ length: 40 }, (_, i) => `## 第 ${i + 1} 节\n\n段落内容 ${i + 1}：Lorem ipsum dolor sit amet, consectetur adipiscing elit. 中文内容混排测试。`).join('\n\n')}
`;
w('sample.md', md);

/* ---------- HTML ---------- */
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>HTML 测试文档</title><style>body{font-family:sans-serif}</style></head>
<body>
<h1>HTML 测试文档</h1>
<p>这是一篇用于测试 HTMLReader 的文档。<script>alert('不应执行')</script></p>
<p>包含 <b>加粗</b>、<i>斜体</i>、<a href="https://example.com">链接</a> 与图片：</p>
<img src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#4f46e5"/><text x="60" y="35" text-anchor="middle" fill="white" font-size="14">内嵌图片</text></svg>').toString('base64')}" alt="测试图">
${Array.from({ length: 50 }, (_, i) => `<h2>章节 ${i + 1}</h2><p>章节 ${i + 1} 的内容。重复若干次以产生滚动条。内容内容内容内容内容内容内容内容。</p>`).join('\n')}
</body></html>
`;
w('sample.html', html);

/* ---------- EPUB（epub3 最小结构） ---------- */
const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节</title></head>
<body>
<h1>第一章 起点</h1>
<p>这是一本测试用的 EPUB 电子书。使用 epub.js 渲染，进度通过 CFI 精确同步。</p>
${Array.from({ length: 20 }, (_, i) => `<p>第一章第 ${i + 1} 段。黄昏的天空，在异国的古堡上空，涂抹着layered的血红。</p>`).join('\n')}
</body></html>
`;
const chapter2 = chapter
  .replaceAll('第一章', '第二章')
  .replaceAll('起点', '远行');
const chapter3 = chapter
  .replaceAll('第一章', '第三章')
  .replaceAll('起点', '归来');

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bid">urn:uuid:dailyreader-test-epub</dc:identifier>
    <dc:title>DailyReader 测试电子书</dc:title>
    <dc:creator>DailyReader</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`;

const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>
<li><a href="ch1.xhtml">第一章 起点</a></li>
<li><a href="ch2.xhtml">第二章 远行</a></li>
<li><a href="ch3.xhtml">第三章 归来</a></li>
</ol></nav></body></html>`;

const epubZip = zipSync(
  {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(contentOpf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/ch1.xhtml': strToU8(chapter),
    'OEBPS/ch2.xhtml': strToU8(chapter2),
    'OEBPS/ch3.xhtml': strToU8(chapter3),
  },
  { level: 6 },
);
w('sample.epub', epubZip);

/* ---------- DOCX（最小 OOXML） ---------- */
const docxParas = Array.from(
  { length: 40 },
  (_, i) =>
    `<w:p><w:pPr><w:pStyle w:val="Heading${i % 5 === 0 ? '1' : ''}"/></w:pPr>${
      i % 5 === 0
        ? `<w:r><w:t>第 ${i / 5 + 1} 章</w:t></w:r>`
        : `<w:r><w:t>这是第 ${i} 段。mammoth 应将本 docx 转为 HTML，包含中文与 English 混排，标点！？。，</w:t></w:r>`
    }</w:p>`,
).join('\n');

const docxZip = zipSync(
  {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>DailyReader DOCX 测试文档</w:t></w:r></w:p>
    ${docxParas}
    <w:sectPr/>
  </w:body>
</w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
  </w:style>
</w:styles>`),
  },
  { level: 6 },
);
w('sample.docx', docxZip);

/* ---------- PDF（最小单页，手工构造 xref） ---------- */
function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // content stream, 后填
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const lines = ['BT /F1 22 Tf 72 720 Td (DailyReader PDF Test) Tj ET'];
  for (let i = 0; i < 30; i++) {
    lines.push(
      `BT /F1 11 Tf 72 ${690 - i * 20} Td (Line ${i + 1}: The quick brown fox jumps over the lazy dog. PDF rendering works.) Tj ET`,
    );
  }
  const content = lines.join('\n');
  objects[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}
w('sample.pdf', makePdf());

console.log('\n全部样书生成完毕 → fixtures/');
