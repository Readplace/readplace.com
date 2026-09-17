import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "onboarding-design.styles.css");
export const ONBOARDING_DESIGN_STYLES = readFileSync(stylesPath, "utf-8");
