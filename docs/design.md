# Storydiff v1 design

Approved direction, 12 Nov 2026. A proof of concept is in `poc/`; its live page is the reference for look and behaviour.

## Why

Agents now write most pull requests. Humans stay the final authority, but they are tired of reviewing long text diffs written by robots. Storydiff makes the robot hand its work over the way a person would explain it on a whiteboard: one picture of what changed, the few places that need human eyes, and the decisions the human made along the way. Every claim in that picture is checked, so the reviewer can trust it.

The bar: **a reviewer with no context understands the PR in one look** — the approach, any regression, and what needs their attention. Not for non-technical readers, but visual enough that most reviewers catch the issues.

## How it works

1. **The agent writes the spec.** At the end of the session that made the change, the coding agent writes `handover.storydiff`, a short text file in the Storydiff language (see `poc/storydiff-guide.md`, the instructions the agent follows, and `poc/core.js`, the parser). It writes it from its own memory of the session: the human's corrections become `said` quotes, its own doubts become `!` watch items.
2. **A checker tests every line,** on the author's machine, where the session log is:
   - `proof file:line` must exist in the new code (and is noted as changed or unchanged in this PR);
   - `proof test <name>` must exist and pass;
   - `said "<quote>"` must match, word for word, something the human typed in the session log, and gets its timestamp;
   - tests run on the base commit and on the new code, so the result says "no regressions" or names the tests that broke.
   The POC checker is `poc/verify.js`. It already catches a fake line number, a made-up test and an invented quote.
3. **Storydiff draws it.** The overview is the default: the after-picture with the five marks, every watch item circled and numbered, and beside it the regression line, "Look here" (only the watch items, one line each), "The ask" and "Decided by the human". The step-by-step walkthrough is behind Play. The spec, the full check list and the Mermaid fallback are under the hood.

## The language (v0, as in the POC)

- Header: `title`, `why`, `from`.
- Today's picture: `kind id "Label"` (kinds: service screen part code endpoint table queue job store external file test user config) and `a -> b "label"`.
- Marks, one step each: `+` new, `~` changed, `-` gone, `=` untouched on purpose, `!` watch. Target is a box declaration, an id, or an arrow.
- Under a mark: `+ / - / ~ item, item` (fields, columns, settings), `say` (plain words), `eng` (engineer words), `proof`, `said @time "quote"`.
- `step "Caption"` groups marks. Arrows with nothing to say join the step before.
- The parser must be forgiving where agents are predictable (a mark that re-declares an existing box points at it) and strict elsewhere, with line-numbered errors.
- Layout is computed once on the union of before and after, so nothing moves between steps.

## What v1 ships (decided)

**1. Claude Code plugin (author side).** A skill that tells the agent when and how to write `handover.storydiff` (the guide), plus a command (`/storydiff`) to run it on demand. After writing, it runs the local checker and fixes or drops lines that fail. It also works for other agents through an `AGENTS.md` snippet, since the guide is plain text.

**2. CLI `storydiff` (npm).** `storydiff check` (the checker; finds the current session log for Claude Code under `~/.claude/projects`), `storydiff render` (SVG of the overview, plus Markdown with the count line, look-here list and Mermaid), `storydiff view` (opens the interactive viewer locally), `storydiff publish` (puts the spec and check result into the PR description, see below).

**3. GitHub Action.** On every push to a PR: reads the spec from the PR, re-runs the code and test checks (quotes cannot be re-checked in CI because the session log stays with the author, so it shows "quotes checked on the author's machine at <commit>"), and posts one comment that updates itself: count line, regression line, look-here list, Mermaid diagram, link to the viewer. A status check fails when a claim does not hold up.

**4. Viewer.** A static web page (no server, no accounts), hosted on GitHub Pages and self-hostable, that renders a spec from a URL fragment or a PR (public repos via the GitHub API; private repos via `storydiff view` locally in v1).

## My calls (change if wrong)

- The spec travels in the PR description as a fenced ` ```storydiff ` block, with the check result in a hidden HTML comment. Nothing is committed to the repo.
- The raw session log never leaves the author's machine. Only the quotes the agent chose to cite are published, and the author sees them before publishing.
- Light theme first (the warm Sparehand palette in `poc/page.html`), dark mode supported. Hand-drawn boxes and arrows (rough.js), crisp text and numbers.
- Plain words are the default reading level, with an Engineer toggle.
- The checker also flags `say` lines over about 25 words, since agents over-write.
- TypeScript, Node 22+, MIT licence, no runtime dependencies beyond rough.js in the viewer.

## Not in v1

Browser extension (a "Story" tab on GitHub PR pages), an MCP app for "Ask Claude" inside the reviewer's Claude, video export, GitLab, semantic checking that a proof line means what the caption says (v1 proves lines exist; it does not judge meaning), and a cached per-repo architecture map for large codebases.

## Known risks

- No study yet shows diagrams improve how many defects reviewers catch. Test it with real reviewers early.
- The picture is only as good as the agent's understanding; on large repos the base picture needs a cached map.
- GitHub, CodeRabbit or Linear could ship something similar. The open, checkable format is the moat.

## Done means

On a fresh repo: install the plugin, make a change with Claude Code, and the PR gets a Storydiff comment whose overview a reviewer can read in one look, with every claim checked and a failing status check when one is not.
