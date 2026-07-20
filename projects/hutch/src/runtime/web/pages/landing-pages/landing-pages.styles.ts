import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "landing-pages.styles.css");
export const LANDING_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
