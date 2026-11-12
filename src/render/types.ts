// Data contracts between the modules (docs/v1-build.md). capture writes Captures, check writes Report.

export interface Rect { sel: string; found: boolean; x?: number; y?: number; w?: number; h?: number }
export interface CallSide { status: number; json: unknown }
export type ScenarioStep = [title: string, note: string, tone?: 'watch'];
export interface ScenarioSide { steps: ScenarioStep[]; outcome: { big: string; small: string; tone: 'good' | 'bad' | 'watch' } }

export interface TerminalSide { exit: number | null; lines: string[]; total: number; timedOut?: boolean }
/** One entry in a same capture's diff: the JSON path that differs and both values (a missing side = not there). */
export interface DiffEntry { at: string; before?: unknown; after?: unknown }

/**
 * One entry per `show` line, in order. null = not captured (the card leaves it out).
 * A side that is null is the new form (before null) or the removed form (after null).
 * typed: written from code or notes instead of measured; the card stamps it "illustrative".
 */
export type ShowCapture = ({ typed?: boolean }) & (
  | { kind: 'screen'; app?: string; before: string | null; after: string | null; rects: Rect[]; rectsBefore?: Rect[] }
  | { kind: 'call'; before: CallSide | null; after: CallSide | null }
  | { kind: 'same'; match: boolean; diff: DiffEntry[] | null | unknown }
  | { kind: 'pipeline' | 'recipe'; file: string; before: string | null; after: string | null }
  | { kind: 'terminal'; cmd?: string; before: TerminalSide | null; after: TerminalSide | null }
  | { kind: 'scenario'; before: ScenarioSide | null; after: ScenarioSide | null });

/** .storydiff/captures.json. Screen PNGs are paths relative to that file (or data: URIs). */
export interface Captures { shows: (ShowCapture | null)[] }

export interface Check {
  ref: string;
  kind: 'proof' | 'said';
  /** true holds up, false does not, null could not be checked here. */
  ok: boolean | null;
  why: string;
  /** For said: mm:ss from the start of the session. */
  at?: string;
  /** 1-based spec line of the mark this claim sits under. */
  line?: number;
}

/** .storydiff/report.json, written by `storydiff check`. */
export interface Report {
  /** Tests that passed on base (and so must still pass). null = tests not run. */
  oldPass: number | null;
  /** Tests that pass on head and did not exist or pass on base. */
  newTests: number;
  /** Tests that passed on base and do not pass on head. */
  regressed: string[];
  /** Number of proofs and quotes checked. */
  claims: number;
  /** Claims that do not hold up (ok false). */
  failed: number;
  /** Claims that could not be checked here (ok null), like quotes in CI where the session log is not. */
  unverified?: number;
  /** Old tests that passed before and did not run now: renamed or deleted. */
  missing?: string[];
  checks: Check[];
  /** Every changed file is accounted for by a proof or a smaller line (ignore list aside). */
  coverage?: { files: number; covered: number; uncovered: string[] };
  /** Old tests whose assertions changed in this PR. */
  editedOld?: string[];
  /** No checker run yet: the verdict says "claims cited · not checked yet". */
  unchecked?: boolean;
  /** Replaces "All N old tests still pass" when old tests could not be counted. */
  testsLine?: string;
  /** Extra verdict chips, like "ships with orchestrator#981". */
  extra?: string[];
  /** sha-256 (16 hex) of the spec this report checked; a different spec makes the report stale. */
  specHash?: string;
  base?: string;
  head?: string;
  /** The working tree had uncommitted changes when check ran. */
  dirty?: boolean;
  session?: string | null;
  /** How long the session ran, shown in the header, like "2h" or "25 min". */
  sessionLength?: string;
  /** Where the quotes were checked, for CI: "the author's machine at abc1234". */
  quotesCheckedAt?: string;
}
