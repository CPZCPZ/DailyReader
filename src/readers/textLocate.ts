/** 在已渲染的正文里按摘录找回位置，并包上 mark。 */

export function clearMarks(root: HTMLElement) {
  root.querySelectorAll('mark[data-hl]').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  root.normalize();
}

function collectText(root: HTMLElement): { nodes: Text[]; starts: number[]; full: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let full = '';
  let node = walker.nextNode();
  while (node) {
    starts.push(full.length);
    nodes.push(node as Text);
    full += node.textContent ?? '';
    node = walker.nextNode();
  }
  return { nodes, starts, full };
}

function pointAt(
  nodes: Text[],
  starts: number[],
  index: number,
): { node: Text; offset: number } | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (index >= starts[i]) {
      return { node: nodes[i], offset: index - starts[i] };
    }
  }
  return null;
}

export function findQuoteRange(
  root: HTMLElement,
  quote: string,
  prefix?: string,
): Range | null {
  if (!quote) return null;
  const { nodes, starts, full } = collectText(root);
  if (!full) return null;
  let start = -1;
  if (prefix) {
    const at = full.indexOf(prefix + quote);
    if (at >= 0) start = at + prefix.length;
  }
  if (start < 0) start = full.indexOf(quote);
  if (start < 0) return null;
  const from = pointAt(nodes, starts, start);
  const to = pointAt(nodes, starts, start + quote.length);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, Math.min(from.offset, from.node.length));
  range.setEnd(to.node, Math.min(to.offset, to.node.length));
  return range;
}

export function wrapQuote(
  root: HTMLElement,
  quote: string,
  prefix: string | undefined,
  attrs: { id: string; className: string; title?: string },
): boolean {
  const range = findQuoteRange(root, quote, prefix);
  if (!range) return false;
  const mark = document.createElement('mark');
  mark.dataset.hl = attrs.id;
  mark.className = attrs.className;
  if (attrs.title) mark.title = attrs.title;
  try {
    range.surroundContents(mark);
  } catch {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
  return true;
}

export function contextAround(
  root: HTMLElement,
  range: Range,
  size = 24,
): { prefix: string; suffix: string } {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return {
    prefix: before.toString().slice(-size),
    suffix: after.toString().slice(0, size),
  };
}
