#!/usr/bin/env node
process.env.STORYDIFF_BIN = '1';
await import('../dist/cli.js');
