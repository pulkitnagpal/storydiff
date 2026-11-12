// Storydiff language v0.3: the parsed handover.

export const KINDS = ['service', 'screen', 'part', 'code', 'endpoint', 'table', 'queue', 'job', 'store', 'external', 'file', 'test', 'user', 'config'] as const;
export type BoxKind = (typeof KINDS)[number];

/** + new, ~ changed, - gone, = kept the same on purpose, ! watch (try before you merge), x breaks for callers. */
export type MarkKind = 'new' | 'changed' | 'gone' | 'kept' | 'watch' | 'breaks';
export type NodeState = MarkKind | 'base';

export interface Node {
  id: string;
  kind: BoxKind;
  label: string;
  /** Small second line under the label, as it is today. */
  note: string;
  /** The note after the change (`now "..."` under a mark); empty means unchanged. */
  noteAfter: string;
  born: boolean;
  state: NodeState;
  order: number;
  /** The box lives in another repo or PR, like "orchestrator#981". */
  repo?: string;
}

export interface Edge {
  from: string;
  to: string;
  born: boolean;
  gone: boolean;
}

export type PinPlace = 'screen' | 'call' | 'step' | 'row' | 'outcome' | 'same' | 'line';
/** side: which version the pin sits on. Most things only exist after; a failure may only exist before. */
export interface Pin { on: PinPlace; target: string; side: 'before' | 'after' }
export interface Said { at: string; text: string }

export interface Mark {
  mark: MarkKind;
  /** The one line for the list. Empty for arrows and new boxes that only draw on the map. */
  line: string;
  id: string | null;
  edge: Edge | null;
  said: Said[];
  proofs: string[];
  pins: Pin[];
  eng: string;
  /** 1-based list number when the mark has a line. Pins share it. */
  n?: number;
  /** 1-based line in the spec source. */
  src: number;
}

/** One request in a scenario. title and note are templates: {field.path}, {@status}, {@ms}, {@s}, {@count}. */
export interface Step { method: string; path: string; body?: unknown; title: string; note?: string }
export interface Outcome { method: string; path: string; body?: unknown; big: string; small?: string; want?: string }

export type Show =
  | { kind: 'screen'; path: string; label?: string; hint?: string }
  | { kind: 'call'; method: string; path: string; body?: unknown; label?: string; hint?: string }
  | { kind: 'same'; label: string; what: string; body?: unknown }
  | { kind: 'pipeline' | 'recipe'; file: string; label?: string }
  | { kind: 'terminal'; cmd: string; label?: string }
  | { kind: 'scenario'; label: string; steps?: Step[]; then?: Outcome };

export interface Ask { text: string; from?: string; in?: string }
export interface Run { cmd: string; port?: number; env: Record<string, string> }
export interface Request { method: string; path: string; body?: unknown }
/** Small changes the card folds into "+ N smaller changes"; their files count as covered. */
export interface Smaller { line: string; files: string[]; src: number }

export interface Doc {
  pr: string;
  files: number;
  title: string;
  by: string;
  agent: string;
  /** The first ask; all of them are in asks. */
  ask: string;
  asks: Ask[];
  did: string;
  /** Other PRs this one must ship with, like "orchestrator#981". */
  shipsWith: string[];
  chapters: string[];
  chapter: number;
  shows: Show[];
  nodes: Record<string, Node>;
  order: string[];
  edges: Edge[];
  marks: Mark[];
  smaller: Smaller[];
  /** How capture starts the app, and what it sends first. */
  run?: Run;
  setup: Request[];
  /** Test command override for check. */
  runTests?: string;
  /** Later chapters of the same PR (only on the first chapter's doc). */
  rest: Doc[];
}
