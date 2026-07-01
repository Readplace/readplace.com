/**
 * Sync Disposable Email Domains
 *
 * Regenerates the canonical disposable-email blocklist from the upstream
 * disposable-email-domains project (CC0-1.0). Run this script manually to re-sync.
 *
 * Re-syncing only rewrites disposable-email-domains.txt. Hand-maintained
 * additions live in disposable-email-domains.custom.txt and are never touched,
 * so local edits survive an upstream refresh.
 */
const fs = require('fs')
const path = require('path')

const SOURCE_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'

const OUTPUT_FILE = path.join(
  __dirname,
  '../src/runtime/web/auth/disposable-email-domains.txt',
)

const HEADER = [
  '# Disposable email domains — canonical list (generated, do not edit by hand)',
  '#',
  `# Source: ${SOURCE_URL}`,
  '#         disposable-email-domains project, licensed CC0-1.0',
  '# Regenerate: node projects/hutch/scripts/sync-disposable-domains.js',
  '#',
  '# To block an extra domain, add one line to disposable-email-domains.custom.txt',
  '# instead — re-syncing this file never clobbers those edits.',
]

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status} ${response.statusText}`)
  }

  const body = await response.text()
  const domains = new Set()
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      domains.add(trimmed.toLowerCase())
    }
  }

  const sorted = [...domains].sort()
  const contents = `${HEADER.join('\n')}\n\n${sorted.join('\n')}\n`
  fs.writeFileSync(OUTPUT_FILE, contents)
  console.log(
    `Wrote ${sorted.length} domains to ${path.relative(process.cwd(), OUTPUT_FILE)}`,
  )
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
