import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "integrations-index.styles.css");
export const INTEGRATIONS_INDEX_STYLES = readFileSync(stylesPath, "utf-8");
