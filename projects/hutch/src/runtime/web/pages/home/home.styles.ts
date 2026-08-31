import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "home.styles.css");
export const HOME_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
