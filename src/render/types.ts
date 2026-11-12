// Data contracts between the modules (docs/v1-build.md). capture writes Captures, check writes Report.

export interface Rect { sel: string; found: boolean; x?: number; y?: number; w?: number; h?: number }
export interface CallSide { status: number; json: unknown }
export type ScenarioStep = [title: string, note: string, tone?: 'watch'];
export interface ScenarioSide { steps: ScenarioStep[]; outcome: { big: string; small: string; tone: 'good' | 'bad' | 'watch' } }

/** One entry per `show` line, in order. null = not captured (the card leaves it out). */
export type ShowCapture =
  | { kind: 'screen'; app?: string; before: string; after: string; rects: Rect[] }
  | { kind: 'call'; before: CallSide; after: CallSide }
  | { kind: 'same'; match: boolean; diff: unknown }
  | { kind: 'pipeline' | 'recipe'; file: string; before: string | null; after: string | null }
  | { kind: 'scenario'; before: ScenarioSide; after: ScenarioSide };

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
  /** Claims that do not hold up (ok false or null). */
  failed: number;
  checks: Check[];
  /** No checker run yet: the verdict says "claims cited · not checked yet". */
  unchecked?: boolean;
  /** Replaces "All N old tests still pass" when old tests could not be counted. */
  testsLine?: string;
  /** Extra verdict chips, like "ships with orchestrator#981". */
  extra?: string[];
  base?: string;
  head?: string;
  session?: string | null;
  /** How long the session ran, shown in the header, like "2h" or "25 min". */
  sessionLength?: string;
  /** Where the quotes were checked, for CI: "the author's machine at abc1234". */
  quotesCheckedAt?: string;
}
