import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "import.styles.css");
export const IMPORT_STYLES = `${ALERT_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
