import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "upload.styles.css");
export const UPLOAD_STYLES = `${ALERT_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
