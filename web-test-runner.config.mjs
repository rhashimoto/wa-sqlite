import { jasmineTestRunnerConfig } from 'web-test-runner-jasmine';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...jasmineTestRunnerConfig(),
  testFramework: {
    config: {
      defaultTimeoutInterval: 5000
    },
  },
  nodeResolve: true,
  files: ['./test/*.test.js']
});