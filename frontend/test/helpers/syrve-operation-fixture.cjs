const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
// Load the real asynchronous adapter; synchronous fixture responses still
// exercise the compatible direct-result branch without a real timer/network.
exports.resolver = api => {
  const loaded = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../src/api/syrveOperation.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: loaded, require: () => ({ api }) });
  return name => name === './syrveOperation' ? loaded : { api };
};
