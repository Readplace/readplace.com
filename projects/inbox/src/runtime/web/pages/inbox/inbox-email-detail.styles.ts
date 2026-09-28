import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES, IN_FLIGHT_DOTS_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "inbox-email-detail.styles.css");
export const INBOX_EMAIL_DETAIL_STYLES = IN_FLIGHT_DOTS_STYLES + ALERT_STYLES + readFileSync(stylesPath, "utf-8");
