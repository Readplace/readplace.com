import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "developers.styles.css");
export const DEVELOPERS_STYLES = readFileSync(stylesPath, "utf-8");
