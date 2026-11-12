// storydiff: the package API. Other modules (capture, plugin, action) build on these.
export { parse, SpecError } from './spec/parse.ts';
export { render, renderPage, uncheckedReport, type RenderOptions } from './render/card.ts';
export { loadCaptures, loadReport } from './render/captures.ts';
export { findBrowser, screenshot, measure } from './shot/index.ts';
export type * from './spec/types.ts';
export type * from './render/types.ts';
