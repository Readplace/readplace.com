import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CANARY_REPORT_STYLES = readFileSync(join(__dirname, "canary-report.styles.css"), "utf-8");
