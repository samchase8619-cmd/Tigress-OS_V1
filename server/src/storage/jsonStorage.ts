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

export function readAll<T>(subdir: string): T[] {
  const dirPath = path.join(STORAGE_PATH, subdir);
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(dirPath, f), 'utf-8');
    return JSON.parse(content) as T;
  });
}

export function readOne<T>(subdir: string, id: string): T | null {
  const filePath = path.join(STORAGE_PATH, subdir, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function writeOne(subdir: string, id: string, data: unknown): void {
  ensureDir();
  const filePath = path.join(STORAGE_PATH, subdir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function deleteOne(subdir: string, id: string): void {
  const filePath = path.join(STORAGE_PATH, subdir, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
