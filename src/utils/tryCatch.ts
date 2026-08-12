export type TryCatchResult<T> = [null, T] | [Error, null];

export function tryCatch<T>(fn: () => Promise<T>): Promise<TryCatchResult<T>>;
export function tryCatch<T>(fn: () => T): TryCatchResult<T>;

export function tryCatch<T>(fn: () => T | Promise<T>): TryCatchResult<T> | Promise<TryCatchResult<T>> {
  let result: T | Promise<T>;

  try {
    result = fn();
  } catch (error) {
    return [errorify(error), null];
  }

  if (result instanceof Promise) {
    return result.then((value): TryCatchResult<T> => [null, value]).catch((error): TryCatchResult<T> => [errorify(error), null]);
  }

  return [null, result];
}

function errorify(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);

  return new Error(`Invalid error: ${String(error)}`);
}
