import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "home-b.styles.css");
export const HOME_B_STYLES = readFileSync(stylesPath, "utf-8");
