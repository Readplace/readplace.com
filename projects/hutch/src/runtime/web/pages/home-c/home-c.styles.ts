import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HOME_C_STYLES = readFileSync(join(__dirname, "home-c.styles.css"), "utf-8");
