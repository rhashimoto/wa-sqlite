import { chromeLauncher } from '@web/test-runner';
import { jasmineTestRunnerConfig } from 'web-test-runner-jasmine';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...jasmineTestRunnerConfig(),
  testFramework: {
    config: {
      defaultTimeoutInterval: 5 * 60 * 1000
    },
  },
  nodeResolve: true,
  files: ['./test/*.test.js'],
  concurrency: 1,
  browsers: [
    chromeLauncher({
      launchOptions: {
        args: [
          '--flag-switches-begin',
          '--enable-features=WebAssemblyExperimentalJSPI',
          '--flag-switches-end'
        ],
      },
    }),
  ],
});