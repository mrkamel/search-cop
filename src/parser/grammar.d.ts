export interface GrammarLocation {
  start: {
    offset: number;
    line: number;
    column: number;
  },
  end: {
    offset: number;
    line: number;
    column: number;
  },
}

export declare class SyntaxError extends Error {
  expected: unknown;
  found: unknown;
  location: GrammarLocation;
}

export declare function parse(input: string): unknown
