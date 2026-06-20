export const meta = {
  name: 'audit-fix-author',
  description: 'Author surgical, proportionate fixes (or defer decisions) for clean audit findings, one agent per file',
  phases: [{ title: 'Author' }],
}

const FILES = __FILES_JSON__

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'decision', 'rationale'],
  properties: {
    file: { type: 'string' },
    decision: { type: 'string', enum: ['fix', 'defer'] },
    rationale: { type: 'string', description: 'Why fix is proportionate, or why deferred (ripple/judgment/disproportionate)' },
    label: { type: 'string', enum: ['high priority', 'medium priority', 'low priority'] },
    branch: { type: 'string', description: 'kebab-case branch suffix, e.g. account-locked-use-i-not-we' },
    commitTitle: { type: 'string', description: 'Conventional-commit title line' },
    commitBody: { type: 'string', description: 'Commit body explaining the why + rule' },
    prTitle: { type: 'string' },
    prBody: { type: 'string', description: 'Markdown PR body citing rule, source, file, change' },
    edits: {
      type: 'array',
      description: 'Exact string replacements. Empty when decision=defer.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['oldString', 'newString'],
        properties: {
          oldString: { type: 'string', description: 'Exact substring currently in the file (verbatim, with whitespace), unique enough to match once' },
          newString: { type: 'string', description: 'Replacement' },
        },
      },
    },
  },
}

function prompt(item) {
  return [
    'You are a precise, read-only fix author for the Readplace monorepo. You MUST NOT edit any file — you only PROPOSE an exact diff that someone else will apply.',
    '',
    `TARGET FILE: ${item.file}  (project: ${item.project}, severity: ${item.sev})`,
    '',
    'FINDINGS to address in this file:',
    JSON.stringify(item.findings, null, 2),
    '',
    'STEP 1 — Read the cited rule docs IN FULL before deciding. At minimum read CLAUDE.md. Also read the relevant skill/brand doc if the finding cites one (e.g. BRAND_GUIDELINES.md for "I not we"/emoji/hex, .claude/skills/web/SKILL.md for SSR/bundling, .claude/skills/e2e-testing/SKILL.md for test assertions).',
    'STEP 2 — Read the TARGET FILE in full. Find the exact code each finding refers to.',
    'STEP 3 — Decide:',
    '  - decision="fix" ONLY IF the fix is a proportionate, self-contained, single-file change that will NOT ripple to other files and will NOT break the build or the 100% coverage/type/lint gate. Produce exact "edits" (verbatim oldString from the file → newString).',
    '  - decision="defer" if the proper fix would: touch other files (changing an exported signature/type/dep used elsewhere), require new tests, require restructuring (event-bus typing, POST-Redirect-GET, bundling pipeline), be a documented allowed exception (as const, isolated Node wrapper, playwright.config process.env, SwiftUI names, thin AWS SDK wrapper c8-ignore), or where "fixing" would degrade a legitimately-good comment/doc. Give a crisp rationale. Leave edits empty.',
    '',
    'RULES FOR EDITS:',
    '  - oldString MUST be copied verbatim from the file (exact whitespace/indentation) and be unique enough to match exactly once. Include enough surrounding context to be unique.',
    '  - Keep the change minimal and idiomatic to the surrounding code. Match its style.',
    '  - For "I not we" copy: change first-person-plural to first-person-singular only where it refers to Readplace/the author (Fayner Brack, solo-built), not where "we/us" legitimately means the user + author or is a quote.',
    '  - For hardcoded hex: only fix if there is an existing CSS custom property (--color-*) that is the correct semantic match — read the stylesheet/brand tokens to confirm. If no matching token exists, DEFER.',
    '  - For assert: replace if/throw of an invariant with node:assert (production: "node:assert"; test: "node:assert/strict") only if it does not change behaviour or coverage shape.',
    '  - For comments: remove/rewrite only the time/plan-bound or what-not-why portion; preserve genuine why.',
    '',
    'STEP 4 — If decision="fix", also produce: label (matching severity), a kebab-case branch suffix, a conventional-commit title + body, and a PR title + markdown body citing the rule, its source doc, the file, and the change. The PR body must end with the line: "🤖 Part of the guidelines & skills audit. One PR per file."',
    '',
    'Return ONLY the structured object.',
  ].join('\n')
}

phase('Author')
log(`Authoring fixes for ${FILES.length} non-test files`)

const results = await parallel(
  FILES.map((item) => () => agent(prompt(item), { label: `author:${item.file.split('/').slice(-2).join('/')}`, phase: 'Author', schema: SCHEMA, effort: 'high' })),
)

const proposals = results.filter(Boolean)
const fixes = proposals.filter((p) => p.decision === 'fix')
const defers = proposals.filter((p) => p.decision === 'defer')
log(`Authored: ${fixes.length} fix proposals, ${defers.length} defer decisions`)

return { total: proposals.length, fixes, defers }
