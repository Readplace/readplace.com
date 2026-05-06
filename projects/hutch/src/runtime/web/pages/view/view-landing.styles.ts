import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "view-landing.styles.css");
export const VIEW_LANDING_STYLES = readFileSync(stylesPath, "utf-8");
