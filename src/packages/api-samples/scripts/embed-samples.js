const fs = require("node:fs");
const path = require("node:path");

const samplesDir = path.resolve(__dirname, "../src/samples");
const target = path.resolve(__dirname, "../src/sample-text.generated.ts");

const SAMPLES = [
  ["typescript", [["discover", "typescript/discover.ts"], ["saveArticle", "typescript/save-article.ts"]]],
  ["swift", [["discover", "swift/Discover.swift"], ["saveArticle", "swift/SaveArticle.swift"]]],
];

const lines = ["export const SAMPLE_TEXT = {"];
for (const [language, entries] of SAMPLES) {
  lines.push(`\t${language}: {`);
  for (const [name, file] of entries) {
    const text = fs.readFileSync(path.join(samplesDir, file), "utf8");
    lines.push(`\t\t${name}: ${JSON.stringify(text)},`);
  }
  lines.push("\t},");
}
lines.push("};");
const content = `${lines.join("\n")}\n`;

const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
if (current !== content) {
  fs.writeFileSync(target, content);
}
