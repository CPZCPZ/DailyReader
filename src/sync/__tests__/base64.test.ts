import { describe, expect, it } from 'vitest';

/**
 * base64 工具在浏览器（btoa/atob）与 Node（Buffer）行为一致性测试。
 * 源码运行在浏览器，这里用等价的 Node 实现验证数据往返与分块逻辑的正确性。
 */

function bytesToBase64Node(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function base64ToBytesNode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('base64 往返', () => {
  it('随机字节往返无损（覆盖 >64KB 分块边界）', () => {
    // 模拟浏览器实现中的 0x8000 分块逻辑
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) & 0xff;

    // 分块转 binary string（与浏览器实现一致）
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    // Node 侧等价 btoa
    const b64 = Buffer.from(bin, 'binary').toString('base64');
    expect(b64).toBe(bytesToBase64Node(bytes));

    const back = base64ToBytesNode(b64);
    expect(back).toEqual(bytes);
  });

  it('base64 含换行（GitHub Contents API 返回格式）可清洗', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    let b64 = Buffer.from(bytes).toString('base64');
    b64 = b64.slice(0, 3) + '\n' + b64.slice(3); // 注入换行
    const cleaned = b64.replace(/\s/g, '');
    expect(Buffer.from(cleaned, 'base64').toString()).toBe('hello');
  });
});

describe('GitHubSyncProvider 路径约定', () => {
  // 与 GitHubSyncProvider.bookPath / progressPath 保持一致
  const bookPath = (m: { id: string; format: string }) => `books/${m.id}.${m.format}`;
  const progressPath = (id: string) => `progress/${id}.json`;

  it('书籍与进度文件路径稳定（同步两侧依赖此约定）', () => {
    expect(bookPath({ id: 'abc-1', format: 'epub' })).toBe('books/abc-1.epub');
    expect(bookPath({ id: 'x', format: 'pdf' })).toBe('books/x.pdf');
    expect(progressPath('abc-1')).toBe('progress/abc-1.json');
  });
});
