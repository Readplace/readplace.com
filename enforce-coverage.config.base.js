/**
 * Base Coverage Enforcement Configuration
 *
 * This module exists because c8's built-in coverage checking (`c8 check-coverage`)
 * doesn't work properly with Playwright. When running coverage with Playwright tests,
 * c8 generates the coverage data correctly but fails to enforce thresholds, allowing
 * tests to pass even when coverage is below the configured thresholds.
 *
 * Additionally, c8's include/exclude options only affect the terminal reporter display,
 * not the JSON summary totals. The coverage-summary.json includes ALL collected files,
 * causing percentages to differ from what's shown in the terminal.
 *
 * Observed in: c8@10.1.3
 * Related issue: https://github.com/bcoe/c8/issues/204
 *   "include/exclude only affect reporting, not collection"
 *
 * This module:
 * 1. Provides shared exclude patterns and thresholds
 * 2. Exports an enforceCoverage function that projects call with optional overrides
 * 3. Reads coverage-summary.json, filters files, validates against thresholds
 * 4. Fails the build with exit code 1 when coverage is insufficient
 *
 * IMPORTANT: Do NOT use c8's include/exclude/thresholds options in .c8rc.json.
 * They don't work correctly with the JSON summary. Define all patterns here.
 */
const fs = require('fs')
const path = require('path')
const { minimatch } = require('minimatch')

// Coverage thresholds — aim for maximum coverage.
// Thresholds are set slightly below 100% because:
// - V8 coverage instrumentation quirks (function counting, ternary branches)
// See: https://github.com/bcoe/c8/issues/126, https://github.com/bcoe/c8/issues/204
const DEFAULT_THRESHOLDS = {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
}

// Files to include in coverage
const INCLUDE_PATTERNS = ['src/**/*.ts']

// Base exclusion patterns shared across all projects
const BASE_EXCLUDE_PATTERNS = [
  // Type definitions — compile to empty module boilerplate, no runtime logic
  '**/*.types.ts',

  // Test files — c8's V8 coverage instrumentation doesn't work with Jest's worker model
  // See: https://github.com/bcoe/c8/issues/126 and https://github.com/jestjs/jest/issues/11188
  '**/*.test.ts',

  // Integration test files exist to exercise other code, not to be exercised,
  // but use a distinct suffix so the test runner can phase them separately.
  // Excluded from coverage for the same reason as test files.
  '**/*.integration.ts',

  // Barrel re-exports — no logic, just re-export statements
  '**/index.ts',

  // Entry points — side-effectful bootstrap code with no logic to unit test
  '**/*.main.ts',

  // Browser-only code — WebExtension APIs, Canvas, DOM; not runnable in Node.js
  '**/*.browser.ts',

  // E2E source — only exercised by e2e tests, which are skipped in
  // CLAUDE_CODE_REMOTE environments (see test-phase-runner). When skipped,
  // these files would otherwise tank coverage to 0%.
  ...(process.env.CLAUDE_CODE_REMOTE === 'true' ? ['src/e2e/**'] : []),
]

function validateC8Config(projectRoot) {
  const c8ConfigPath = path.join(projectRoot, '.c8rc.json')
  if (!fs.existsSync(c8ConfigPath)) return

  const c8Config = JSON.parse(fs.readFileSync(c8ConfigPath, 'utf8'))
  const problematicKeys = ['include', 'exclude', 'thresholds'].filter(
    key => c8Config[key] !== undefined
  )

  if (problematicKeys.length > 0) {
    console.error('❌ ERROR: .c8rc.json contains unsupported options:', problematicKeys.join(', '))
    console.error('')
    console.error('c8 has a known issue where include/exclude options only affect reporting,')
    console.error('not the JSON summary totals. This causes coverage percentages to differ')
    console.error('between terminal output and coverage-summary.json.')
    console.error('')
    console.error('Observed in: c8@10.1.3')
    console.error('')
    console.error('Example of the problem:')
    console.error('  Terminal output: 100% coverage (filters applied to display)')
    console.error('  JSON summary:    85% coverage (totals include ALL collected files)')
    console.error('')
    console.error('Solution: Remove these options from .c8rc.json and define them in')
    console.error('scripts/enforce-coverage.js instead. This script handles filtering correctly.')
    console.error('')
    console.error('Related issue: https://github.com/bcoe/c8/issues/204')
    console.error('  "include/exclude only affect reporting, not collection"')
    process.exit(1)
  }
}

function shouldIncludeFile(filePath, includePatterns, excludePatterns) {
  let relativePath = path.relative(process.cwd(), filePath)

  // c8 with source-map should report original TS paths, but handle
  // dist/ paths as fallback (map back to src/)
  if (relativePath.startsWith('dist/')) {
    relativePath = relativePath.replace(/^dist\//, 'src/')
    // Only convert .js to .ts for compiled TypeScript files
    // Keep .client.js as-is (they're JavaScript, not compiled from TS)
    if (!relativePath.endsWith('.client.js')) {
      relativePath = relativePath.replace(/\.js$/, '.ts')
    }
  }

  const included = includePatterns.some(pattern =>
    minimatch(relativePath, pattern, { dot: true })
  )
  if (!included) return false

  const excluded = excludePatterns.some(pattern =>
    minimatch(relativePath, pattern, { dot: true })
  )
  return !excluded
}

function getUncoveredLineRanges(fileDetail) {
  if (!fileDetail || !fileDetail.statementMap || !fileDetail.s) return ''

  const uncoveredLines = new Set()
  for (const [id, count] of Object.entries(fileDetail.s)) {
    if (count === 0) {
      const loc = fileDetail.statementMap[id]
      if (!loc) continue
      for (let line = loc.start.line; line <= loc.end.line; line++) {
        uncoveredLines.add(line)
      }
    }
  }

  if (uncoveredLines.size === 0) return ''

  const sorted = [...uncoveredLines].sort((a, b) => a - b)
  const ranges = []
  let rangeStart = sorted[0]
  let rangeEnd = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i]
    } else {
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)
      rangeStart = sorted[i]
      rangeEnd = sorted[i]
    }
  }
  ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)

  return ranges.join(',')
}

function formatCoverageTable(coverage, includePatterns, excludePatterns, detailedCoverage) {
  const rows = []

  for (const [filePath, data] of Object.entries(coverage)) {
    if (filePath === 'total') continue
    if (!shouldIncludeFile(filePath, includePatterns, excludePatterns)) continue

    const hasGap = data.statements.pct < 100 || data.branches.pct < 100 ||
      data.functions.pct < 100 || data.lines.pct < 100
    const uncoveredLines = hasGap && detailedCoverage
      ? getUncoveredLineRanges(detailedCoverage[filePath])
      : ''

    rows.push({
      file: path.relative(process.cwd(), filePath),
      stmts: data.statements.pct,
      branch: data.branches.pct,
      funcs: data.functions.pct,
      lines: data.lines.pct,
      uncoveredLines,
    })
  }

  rows.sort((a, b) => a.file.localeCompare(b.file))

  const totals = calculateTotals(coverage, includePatterns, excludePatterns)
  const hasAnyUncovered = rows.some(r => r.uncoveredLines)

  const summaryLabel = `All files (${rows.length})`
  const fileWidth = Math.max(
    'File'.length,
    summaryLabel.length,
    ...rows.map(r => r.file.length)
  )

  const uncoveredWidth = hasAnyUncovered
    ? Math.max('Uncovered Lines'.length, ...rows.map(r => r.uncoveredLines.length))
    : 0

  const fmt = (pct) => String(Number(pct.toFixed(2))).padStart(8)

  const sep = '-'.repeat(fileWidth + 1) + '|' +
    '-'.repeat(9) + '|' +
    '-'.repeat(10) + '|' +
    '-'.repeat(9) + '|' +
    '-'.repeat(9) + '|' +
    (hasAnyUncovered ? '-'.repeat(uncoveredWidth + 2) + '|' : '')

  const header = ' ' + 'File'.padEnd(fileWidth) + '|' +
    ' % Stmts' + ' |' +
    '  % Branch' + ' |' +
    ' % Funcs' + ' |' +
    ' % Lines' + ' |' +
    (hasAnyUncovered ? ' ' + 'Uncovered Lines'.padEnd(uncoveredWidth) + ' |' : '')

  const lines = [sep, header, sep]

  for (const row of rows) {
    lines.push(
      ' ' + row.file.padEnd(fileWidth) + '|' +
      fmt(row.stmts) + ' |' +
      fmt(row.branch).padStart(10) + ' |' +
      fmt(row.funcs) + ' |' +
      fmt(row.lines) + ' |' +
      (hasAnyUncovered ? ' ' + row.uncoveredLines.padEnd(uncoveredWidth) + ' |' : '')
    )
  }

  lines.push(sep)
  lines.push(
    ' ' + summaryLabel.padEnd(fileWidth) + '|' +
    fmt(totals.statements.pct) + ' |' +
    fmt(totals.branches.pct).padStart(10) + ' |' +
    fmt(totals.functions.pct) + ' |' +
    fmt(totals.lines.pct) + ' |' +
    (hasAnyUncovered ? ' '.repeat(uncoveredWidth + 2) + '|' : '')
  )
  lines.push(sep)

  return lines.join('\n')
}

function calculateTotals(coverage, includePatterns, excludePatterns) {
  const totals = {
    statements: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    lines: { total: 0, covered: 0 },
  }

  for (const [filePath, data] of Object.entries(coverage)) {
    if (filePath === 'total') continue
    if (!shouldIncludeFile(filePath, includePatterns, excludePatterns)) continue

    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      totals[metric].total += data[metric].total
      totals[metric].covered += data[metric].covered
    }
  }

  const result = {}
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const { total, covered } = totals[metric]
    result[metric] = { pct: total > 0 ? (covered / total) * 100 : 100 }
  }
  return result
}

/**
 * Enforce coverage thresholds.
 *
 * @param {Object} options
 * @param {string} options.projectRoot - Absolute path to the project directory
 * @param {Object} [options.thresholds] - Override default thresholds
 * @param {string[]} [options.extraExcludePatterns] - Additional exclude patterns beyond base
 * @param {boolean} [options.showTextTable] - Print a per-file coverage table (filtered by include/exclude patterns)
 */
function enforceCoverage(options = {}) {
  const {
    projectRoot = process.cwd(),
    thresholds = DEFAULT_THRESHOLDS,
    extraExcludePatterns = [],
    showTextTable = false,
  } = options

  const excludePatterns = [...BASE_EXCLUDE_PATTERNS, ...extraExcludePatterns]

  console.log('🎯 Enforcing Coverage Thresholds')
  console.log('================================')

  try {
    validateC8Config(projectRoot)

    const coverageFile = path.join(projectRoot, 'coverage/coverage-summary.json')
    if (!fs.existsSync(coverageFile)) {
      console.error('❌ No coverage summary found. Run tests first.')
      process.exit(1)
    }

    const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))

    const detailedCoverageFile = path.join(projectRoot, 'coverage/coverage-final.json')
    const detailedCoverage = fs.existsSync(detailedCoverageFile)
      ? JSON.parse(fs.readFileSync(detailedCoverageFile, 'utf8'))
      : null

    const printTable = () => {
      if (showTextTable) {
        console.log(formatCoverageTable(coverage, INCLUDE_PATTERNS, excludePatterns, detailedCoverage))
        console.log('')
      }
    }

    const totals = calculateTotals(coverage, INCLUDE_PATTERNS, excludePatterns)

    let failed = false
    const results = []

    Object.entries(thresholds).forEach(([metric, threshold]) => {
      const actual = totals[metric]?.pct
      if (actual === undefined) {
        console.error(`❌ Metric '${metric}' not found in coverage data`)
        failed = true
        return
      }

      const actualRounded = Number(actual.toFixed(2))
      const status = actualRounded >= threshold ? '✅' : '❌'
      const message = `${status} ${metric}: ${actualRounded}% (threshold: ${threshold}%)`

      console.log(message)
      results.push({ metric, actual: actualRounded, threshold, passed: actualRounded >= threshold })

      if (actualRounded < threshold) {
        failed = true
      }
    })

    if (failed) {
      printTable()
      console.log('\n🚨 COVERAGE THRESHOLD FAILURE')
      console.log('==============================')

      results.forEach(({ metric, actual, threshold, passed }) => {
        if (!passed) {
          const gap = (threshold - actual).toFixed(2)
          console.log(`❌ ${metric}: ${actual}% < ${threshold}% (gap: ${gap}%)`)
        }
      })

      console.log('\n💡 Fix by:')
      console.log('   1. Adding tests for uncovered lines')
      console.log('   2. Removing dead code')
      process.exit(1)
    } else {
      // Local dev keeps the per-file table visible; CI suppresses it on success
      // since every row is at 100% and the noise pushes real failures out of view.
      if (process.env.CI !== 'true') printTable()
      console.log('\n🎉 ALL COVERAGE THRESHOLDS MET!')
    }
  } catch (error) {
    console.error('❌ Error reading coverage data:', error.message)
    process.exit(1)
  }
}

module.exports = {
  DEFAULT_THRESHOLDS,
  INCLUDE_PATTERNS,
  BASE_EXCLUDE_PATTERNS,
  enforceCoverage,
}
