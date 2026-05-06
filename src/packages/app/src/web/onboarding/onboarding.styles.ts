import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "onboarding.styles.css");
export const ONBOARDING_STYLES = readFileSync(stylesPath, "utf-8");
