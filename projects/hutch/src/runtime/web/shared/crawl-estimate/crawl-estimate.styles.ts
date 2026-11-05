import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CRAWL_ESTIMATE_STYLES = readFileSync(join(__dirname, "crawl-estimate.styles.css"), "utf-8");
