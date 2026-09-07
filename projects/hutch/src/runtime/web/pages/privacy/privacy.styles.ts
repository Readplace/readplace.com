import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "privacy.styles.css");
export const LEGAL_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
