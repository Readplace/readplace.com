import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "wizard.styles.css");
export const WIZARD_STYLES = readFileSync(stylesPath, "utf-8");
