import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "save-error.styles.css");
export const SAVE_ERROR_STYLES = `${ALERT_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
