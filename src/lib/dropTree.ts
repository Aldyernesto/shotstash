// Walk dropped OS items (files + folders, with nesting) into a tree.
// Handles empty folders, multi-folder drops, and arbitrary nesting depth.

export type DropNode =
  | { type: 'file'; file: File }
  | { type: 'folder'; name: string; children: DropNode[] };

async function walkEntry(entry: any): Promise<DropNode> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return { type: 'file', file };
  }
  const reader = entry.createReader();
  const children: DropNode[] = [];
  while (true) {
    const batch = await new Promise<any[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    if (batch.length === 0) break;
    for (const sub of batch) {
      try {
        children.push(await walkEntry(sub));
      } catch (err) {
        console.warn('[dropTree] entry read failed', sub?.name, err);
      }
    }
  }
  return { type: 'folder', name: entry.name, children };
}

export async function readDropAsTrees(dt: DataTransfer): Promise<DropNode[]> {
  const items = Array.from(dt.items);
  const entries = items
    .map(item => (item as any).webkitGetAsEntry?.())
    .filter(Boolean) as any[];

  if (entries.length > 0) {
    const trees: DropNode[] = [];
    for (const entry of entries) {
      try {
        trees.push(await walkEntry(entry));
      } catch (err) {
        console.warn('[dropTree] walk failed', err);
      }
    }
    return trees;
  }

  // Fallback: browsers without webkitGetAsEntry (Firefox older, etc.) — flat files only
  return Array.from(dt.files)
    .filter(f => f.size > 0 || f.type)
    .map(f => ({ type: 'file', file: f } as DropNode));
}

// Returns true if `node` contains at least one file (recursively)
export function treeHasFiles(node: DropNode): boolean {
  if (node.type === 'file') return true;
  return node.children.some(treeHasFiles);
}

// Count files across a list of trees
export function countFiles(trees: DropNode[]): number {
  let n = 0;
  const walk = (n2: DropNode) => {
    if (n2.type === 'file') n++;
    else n2.children.forEach(walk);
  };
  trees.forEach(walk);
  return n;
}
