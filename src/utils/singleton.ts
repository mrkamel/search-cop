import { version } from '../version.js';

const globalScope = globalThis as typeof globalThis & Record<symbol, unknown>;

export function singleton<T>(name: string, create: () => T): T {
  const key = Symbol.for(`search-cop@${version}:${name}`);

  return (globalScope[key] ??= create()) as T;
}
