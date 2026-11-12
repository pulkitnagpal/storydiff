// Storydiff language v0.3: the parsed handover.

export const KINDS = ['service', 'screen', 'part', 'code', 'endpoint', 'table', 'queue', 'job', 'store', 'external', 'file', 'test', 'user', 'config'] as const;
export type BoxKind = (typeof KINDS)[number];

/** + new, ~ changed, - gone, = kept the same on purpose, ! watch (try before you merge). */
export type MarkKind = 'new' | 'changed' | 'gone' | 'kept' | 'watch';
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
}

export interface Edge {
  from: string;
  to: string;
  born: boolean;
  gone: boolean;
}

export type PinPlace = 'screen' | 'call' | 'step' | 'row' | 'outcome' | 'same';
export interface Pin { on: PinPlace; target: string }
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

export type Show =
  | { kind: 'screen'; path: string; label?: string; hint?: string }
  | { kind: 'call'; method: string; path: string; body?: unknown; label?: string; hint?: string }
  | { kind: 'same'; label: string; what: string }
  | { kind: 'pipeline' | 'recipe'; file: string; label?: string }
  | { kind: 'scenario'; label: string };

export interface Doc {
  pr: string;
  files: number;
  title: string;
  by: string;
  agent: string;
  ask: string;
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
}
