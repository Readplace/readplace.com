import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HOME_B_COMPARE_STYLES = readFileSync(join(__dirname, "home-b-compare.styles.css"), "utf-8");
