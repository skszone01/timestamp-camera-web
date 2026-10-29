#!/usr/bin/env node
/**
 * Timestamp Camera Web — Lightweight Zero-Dependency Test Runner
 * 
 * Supports:
 * - describe / test / it syntax
 * - async / await tests
 * - hooks: beforeEach, afterEach, beforeAll, afterAll
 * - CLI flags:
 *     --tier=1 | 2 | 3 | 4
 *     --filter=<pattern>
 *     --verbose
 * - Colorized summary reports with tier breakdowns
 * - Proper process exit codes (0 for pass, 1 for fail)
 */

import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Terminal ANSI styling
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

class TestHarness {
  constructor() {
    this.suites = [];
    this.currentSuite = null;
    this.currentTier = null;
    this.options = {
      tier: null,
      filter: null,
      verbose: false
    };
  }

  parseArgs(args) {
    for (const arg of args) {
      if (arg.startsWith('--tier=')) {
        this.options.tier = parseInt(arg.split('=')[1], 10);
      } else if (arg.startsWith('--filter=')) {
        this.options.filter = new RegExp(arg.split('=')[1], 'i');
      } else if (arg === '--verbose' || arg === '-v') {
        this.options.verbose = true;
      }
    }
  }

  setTier(tierNumber) {
    this.currentTier = tierNumber;
  }

  describe(name, fn) {
    const parentSuite = this.currentSuite;
    const suite = {
      name,
      tier: this.currentTier || 1,
      tests: [],
      beforeEachHooks: [],
      afterEachHooks: [],
      beforeAllHooks: [],
      afterAllHooks: [],
      parent: parentSuite
    };
    this.suites.push(suite);
    this.currentSuite = suite;
    try {
      fn();
    } finally {
      this.currentSuite = parentSuite;
    }
  }

  test(name, fn) {
    if (!this.currentSuite) {
      this.describe('Default Suite', () => {});
    }
    this.currentSuite.tests.push({
      name,
      fn,
      tier: this.currentSuite.tier,
      suiteName: this.currentSuite.name
    });
  }

  beforeEach(fn) {
    if (this.currentSuite) this.currentSuite.beforeEachHooks.push(fn);
  }

  afterEach(fn) {
    if (this.currentSuite) this.currentSuite.afterEachHooks.push(fn);
  }

  beforeAll(fn) {
    if (this.currentSuite) this.currentSuite.beforeAllHooks.push(fn);
  }

  afterAll(fn) {
    if (this.currentSuite) this.currentSuite.afterAllHooks.push(fn);
  }

  async run() {
    console.log(`\n${COLORS.bold}${COLORS.cyan}====================================================${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan} Timestamp Camera Web — Automated Test Runner ${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}====================================================${COLORS.reset}\n`);

    if (this.options.tier) {
      console.log(`${COLORS.yellow}Filtering by Tier: ${this.options.tier}${COLORS.reset}`);
    }
    if (this.options.filter) {
      console.log(`${COLORS.yellow}Filtering by pattern: ${this.options.filter}${COLORS.reset}`);
    }

    const startTime = Date.now();
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    const failures = [];
    const tierStats = {
      1: { total: 0, passed: 0, failed: 0, skipped: 0, name: 'Tier 1 - Feature Coverage' },
      2: { total: 0, passed: 0, failed: 0, skipped: 0, name: 'Tier 2 - Boundaries & Corner Cases' },
      3: { total: 0, passed: 0, failed: 0, skipped: 0, name: 'Tier 3 - Cross-Feature Combinations' },
      4: { total: 0, passed: 0, failed: 0, skipped: 0, name: 'Tier 4 - Realistic User Scenarios' }
    };

    for (const suite of this.suites) {
      const suiteTier = suite.tier || 1;
      if (this.options.tier && suiteTier !== this.options.tier) {
        continue;
      }

      // Run beforeAll hooks
      for (const hook of suite.beforeAllHooks) {
        try {
          await hook();
        } catch (err) {
          console.error(`${COLORS.red}Error in beforeAll hook for ${suite.name}: ${err.message}${COLORS.reset}`);
        }
      }

      let suiteHeaderPrinted = false;

      for (const t of suite.tests) {
        if (this.options.filter && !this.options.filter.test(t.name) && !this.options.filter.test(suite.name)) {
          skippedTests++;
          tierStats[suiteTier].skipped++;
          continue;
        }

        if (!suiteHeaderPrinted && this.options.verbose) {
          console.log(`\n${COLORS.bold}${COLORS.magenta}[Tier ${suiteTier}] ${suite.name}${COLORS.reset}`);
          suiteHeaderPrinted = true;
        }

        totalTests++;
        tierStats[suiteTier].total++;
        const testStart = Date.now();

        // Run beforeEach hooks
        for (const hook of suite.beforeEachHooks) {
          await hook();
        }

        try {
          await t.fn();
          const duration = Date.now() - testStart;
          passedTests++;
          tierStats[suiteTier].passed++;
          if (this.options.verbose) {
            console.log(`  ${COLORS.green}✔${COLORS.reset} ${t.name} ${COLORS.gray}(${duration}ms)${COLORS.reset}`);
          }
        } catch (err) {
          const duration = Date.now() - testStart;
          failedTests++;
          tierStats[suiteTier].failed++;
          failures.push({
            tier: suiteTier,
            suite: suite.name,
            name: t.name,
            error: err,
            duration
          });
          if (this.options.verbose) {
            console.log(`  ${COLORS.red}✖ ${t.name} (${duration}ms)${COLORS.reset}`);
            console.log(`    ${COLORS.dim}${err.message}${COLORS.reset}`);
          }
        }

        // Run afterEach hooks
        for (const hook of suite.afterEachHooks) {
          await hook();
        }
      }

      // Run afterAll hooks
      for (const hook of suite.afterAllHooks) {
        try {
          await hook();
        } catch (err) {
          console.error(`${COLORS.red}Error in afterAll hook for ${suite.name}: ${err.message}${COLORS.reset}`);
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    // Print Tier Breakdown Table
    console.log(`\n${COLORS.bold}=================== Tier Summary ===================${COLORS.reset}`);
    for (const [tierNum, stats] of Object.entries(tierStats)) {
      if (stats.total > 0 || (this.options.tier && parseInt(tierNum, 10) === this.options.tier)) {
        const passRate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : '0.0';
        const statusColor = stats.failed === 0 && stats.total > 0 ? COLORS.green : (stats.failed > 0 ? COLORS.red : COLORS.gray);
        console.log(
          `  ${COLORS.bold}Tier ${tierNum}${COLORS.reset} (${stats.name}): ` +
          `${statusColor}${stats.passed}/${stats.total} passed (${passRate}%)${COLORS.reset}` +
          (stats.failed > 0 ? ` | ${COLORS.red}${stats.failed} failed${COLORS.reset}` : '') +
          (stats.skipped > 0 ? ` | ${COLORS.yellow}${stats.skipped} skipped${COLORS.reset}` : '')
        );
      }
    }

    // Print Failures if any
    if (failures.length > 0) {
      console.log(`\n${COLORS.bold}${COLORS.red}=================== Failures (${failures.length}) ===================${COLORS.reset}`);
      failures.forEach((f, idx) => {
        console.log(`\n${COLORS.bold}${idx + 1}) [Tier ${f.tier}] ${f.suite} > ${f.name}${COLORS.reset}`);
        console.log(`   ${COLORS.red}${f.error.name || 'Error'}: ${f.error.message}${COLORS.reset}`);
        if (f.error.stack) {
          const cleanStack = f.error.stack
            .split('\n')
            .slice(1, 4)
            .map(line => `   ${COLORS.dim}${line.trim()}${COLORS.reset}`)
            .join('\n');
          console.log(cleanStack);
        }
      });
    }

    // Final Overall Summary
    console.log(`\n${COLORS.bold}=================== Overall Result ===================${COLORS.reset}`);
    console.log(`  Total Tests:    ${COLORS.bold}${totalTests}${COLORS.reset}`);
    console.log(`  Passed:         ${COLORS.green}${passedTests}${COLORS.reset}`);
    console.log(`  Failed:         ${COLORS.red}${failedTests}${COLORS.reset}`);
    if (skippedTests > 0) {
      console.log(`  Skipped:        ${COLORS.yellow}${skippedTests}${COLORS.reset}`);
    }
    console.log(`  Total Duration: ${totalDuration}ms`);

    const allPassed = failedTests === 0 && totalTests > 0;
    if (allPassed) {
      console.log(`\n${COLORS.bold}${COLORS.green}✔ ALL TESTS PASSED SUCCESSFULLY!${COLORS.reset}\n`);
    } else {
      console.log(`\n${COLORS.bold}${COLORS.red}✖ TEST RUN COMPLETED WITH FAILURES.${COLORS.reset}\n`);
    }

    return {
      total: totalTests,
      passed: passedTests,
      failed: failedTests,
      skipped: skippedTests,
      duration: totalDuration,
      allPassed,
      tierStats
    };
  }
}

// Global harness singleton
export const harness = new TestHarness();
export const describe = (name, fn) => harness.describe(name, fn);
export const test = (name, fn) => harness.test(name, fn);
export const it = test;
export const beforeEach = (fn) => harness.beforeEach(fn);
export const afterEach = (fn) => harness.afterEach(fn);
export const beforeAll = (fn) => harness.beforeAll(fn);
export const afterAll = (fn) => harness.afterAll(fn);

// CLI Entrypoint
if (process.argv[1] && (process.argv[1].endsWith('test-runner.js') || process.argv[1].endsWith('test-runner'))) {
  harness.parseArgs(process.argv.slice(2));

  // Load all test tier files
  const tierFiles = [
    'tier1-features.test.js',
    'tier2-boundaries.test.js',
    'tier3-combinations.test.js',
    'tier4-scenarios.test.js'
  ];

  (async () => {
    for (let i = 0; i < tierFiles.length; i++) {
      harness.setTier(i + 1);
      const filePath = path.join(__dirname, tierFiles[i]);
      const fileUrl = url.pathToFileURL(filePath).href;
      await import(fileUrl);
    }

    const result = await harness.run();
    process.exit(result.allPassed ? 0 : 1);
  })().catch(err => {
    console.error(`${COLORS.red}Fatal Runner Error: ${err.stack || err}${COLORS.reset}`);
    process.exit(1);
  });
}
