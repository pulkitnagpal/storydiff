// Standalone entry for 'storydiff capture' (used by the tests). The storydiff CLI imports main() from cli.ts instead.
import { main } from './cli.ts';
main(process.argv.slice(2)).then(code => process.exit(code));
