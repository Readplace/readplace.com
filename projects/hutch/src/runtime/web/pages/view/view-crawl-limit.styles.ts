import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "view-crawl-limit.styles.css");
export const VIEW_CRAWL_LIMIT_STYLES = readFileSync(stylesPath, "utf-8");
