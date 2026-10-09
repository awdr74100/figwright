// Imported first by index.ts, for its side effect alone: modules are evaluated in import order, so
// this puts the guard in place before any other module runs — including anything a dependency
// does while it loads. See process-guard.ts for what each part protects.
import { consoleToStderr, guardProcess, muteStreamErrors } from './process-guard.js';

consoleToStderr(console, process.stderr);
muteStreamErrors(process.stdout, process.stderr);
guardProcess(process, text => {
  process.stderr.write(text);
});
