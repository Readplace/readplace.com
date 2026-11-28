import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "auth.styles.css");
export const AUTH_STYLES = `${ALERT_STYLES}${readFileSync(stylesPath, "utf-8")}`;
