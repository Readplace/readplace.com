import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "extend-trial.styles.css");

export const EXTEND_TRIAL_STYLES = ALERT_STYLES + readFileSync(stylesPath, "utf-8");
