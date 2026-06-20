// Apply one proposal's edits to disk + emit ship metadata. Fails loud if any oldString isn't a unique match.
// Usage: node .audit-apply.cjs <file>
// Side effects: writes the file, /tmp/audit-commit.txt, /tmp/audit-pr.txt
// Prints: BRANCH=, LABEL=, PROJECT=, PRTITLE= for the shell to consume.
const fs = require("node:fs");
const assert = require("node:assert");

const ROOT = "/Users/fagnerbrack/Git/mike-hutch-app";
const targetFile = process.argv[2];
const proposals = require(`${ROOT}/.audit-proposals.json`);
const p = proposals.fixes.find((x) => x.file === targetFile);
assert(p, `No fix proposal for ${targetFile}`);

function nxProject(file) {
  if (file.startsWith("src/packages/")) return `@packages/${file.split("/")[2]}`;
  if (file.startsWith("projects/extensions/")) return file.split("/")[2];
  if (file.startsWith("projects/")) return file.split("/")[1];
  return "root";
}

const abs = `${ROOT}/${p.file}`;
let content = fs.readFileSync(abs, "utf8");
assert(Array.isArray(p.edits) && p.edits.length > 0, `No edits for ${p.file}`);
for (let i = 0; i < p.edits.length; i++) {
  const { oldString, newString } = p.edits[i];
  const count = content.split(oldString).length - 1;
  assert.equal(count, 1, `edit[${i}] for ${p.file}: oldString matched ${count} times (need exactly 1)\n--- oldString ---\n${oldString}`);
  content = content.replace(oldString, newString);
}
fs.writeFileSync(abs, content);

const commitMsg = `${p.commitTitle}\n\n${p.commitBody}`;
fs.writeFileSync("/tmp/audit-commit.txt", commitMsg);
fs.writeFileSync("/tmp/audit-pr.txt", p.prBody);

console.log(`Applied ${p.edits.length} edit(s) to ${p.file}`);
console.log(`BRANCH=audit/${p.branch}`);
console.log(`LABEL=${p.label}`);
console.log(`PROJECT=${nxProject(p.file)}`);
console.log(`PRTITLE=${p.prTitle}`);
