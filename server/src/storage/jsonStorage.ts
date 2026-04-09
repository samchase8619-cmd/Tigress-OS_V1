import fs from 'fs';
import path from 'path';

const STORAGE_PATH = path.join(process.cwd(), 'data');

const SUBDIRS = ['graphs', 'simulations', 'sessions'];

export function ensureDir(): void {
  if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
  }
  for (const sub of SUBDIRS) {
    const subPath = path.join(STORAGE_PATH, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
    }
  }
}

/**
 * Resolve a file path for the given subdir + id, and verify it stays
 * within the expected base directory (prevents path-traversal attacks).
 * Also requires id to be alphanumeric/hyphen/underscore (UUID-safe).
 */
function resolveFilePath(subdir: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
  const base = path.resolve(STORAGE_PATH, subdir);
  const resolved = path.resolve(base, `${id}.json`);
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

export function readAll<T>(subdir: string): T[] {
  const dirPath = path.resolve(STORAGE_PATH, subdir);
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  return files.map(f => {
    // f comes from readdirSync — only read files that end with .json and contain no separators
    if (f.includes(path.sep) || f.includes('/')) return null;
    const filePath = path.resolve(dirPath, f);
    if (!filePath.startsWith(dirPath + path.sep)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  }).filter((item): item is T => item !== null);
}

export function readOne<T>(subdir: string, id: string): T | null {
  const filePath = resolveFilePath(subdir, id);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function writeOne(subdir: string, id: string, data: unknown): void {
  ensureDir();
  const filePath = resolveFilePath(subdir, id);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function deleteOne(subdir: string, id: string): void {
  const filePath = resolveFilePath(subdir, id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
