import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "extend-trial.styles.css");

export const EXTEND_TRIAL_STYLES = readFileSync(stylesPath, "utf-8");
