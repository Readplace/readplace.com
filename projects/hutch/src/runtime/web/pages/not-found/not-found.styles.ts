import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "not-found.styles.css");
export const NOT_FOUND_STYLES = readFileSync(stylesPath, "utf-8");
