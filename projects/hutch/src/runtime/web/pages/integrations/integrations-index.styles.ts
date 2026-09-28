import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "integrations-index.styles.css");
export const INTEGRATIONS_INDEX_STYLES = ALERT_STYLES + readFileSync(stylesPath, "utf-8");
