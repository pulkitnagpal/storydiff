// storydiff: the package API. Other modules (capture, plugin, action) build on these.
export { parse, SpecError } from './spec/parse.ts';
export { render, renderPage, uncheckedReport, type RenderOptions } from './render/card.ts';
export { loadCaptures, loadReport } from './render/captures.ts';
export { check, specHash, findSession, humanMessages, defaultBase, runTests, parseResults, detectTestCmd, testMatches, ignoreMatcher, DEFAULT_IGNORE, quoteIn, normQuote, type CheckOptions } from './check/index.ts';
export { renderMarkdown, mermaid, verdictLine, MARKER, type MarkdownOptions } from './render/markdown.ts';
export { upsertBlock, extractSpec, block as prBlock } from './cli/publish.ts';
export { main as cli } from './cli/index.ts';
export { findBrowser, screenshot, measure } from './shot/index.ts';
export type * from './spec/types.ts';
export type * from './render/types.ts';
