import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ISSUE_LINKS_STYLES = readFileSync(join(__dirname, "issue-links.styles.css"), "utf-8");
