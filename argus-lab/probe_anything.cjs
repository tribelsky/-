// Isolated, bounded reproduction of AnythingLLM's original function.
// The upstream module is loaded in a VM with mock dependencies and no process,
// filesystem, network, or GitHub credentials in its context.
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const source = fs.readFileSync(process.argv[2], 'utf8');
  const sandbox = {
    module: {exports: {}},
    require: (id) => {
      if (id === '../utils/prisma') return {};
      if (id === 'moment') return () => ({format: () => 'MOCKED_DATE'});
      throw new Error('Unexpected import: ' + id);
    },
    console: {error: () => {}}
  };
  vm.runInNewContext(source, sandbox, {
    timeout: 1500,
    filename: 'pinned-systemPromptVariables.js'
  });
  const sut = sandbox.module.exports.SystemPromptVariables;
  if (!sut || typeof sut.expandSystemPromptVariables !== 'function') {
    throw new Error('Upstream function not available');
  }
  sut.getAll = async () => [
    {key: 'first', value: 'X {second}', type: 'static'},
    {key: 'second', value: 'Y', type: 'static'}
  ];
  const input = '{first} {second}';
  const expected = 'X {second} Y';
  const actual = await sut.expandSystemPromptVariables(input);
  process.stdout.write(JSON.stringify({
    status: 'isolated_upstream_function_executed',
    input, expected, actual,
    mismatch_reproduced: actual !== expected,
    scope: 'Upstream expandSystemPromptVariables in dependency-mocked JS VM; not product end-to-end'
  }) + '\n');
}
main().catch(error => {
  process.stderr.write(String(error && error.stack || error));
  process.exitCode = 1;
});
