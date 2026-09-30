import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

export const ADMIN_NEWSLETTERS_STYLES = ALERT_STYLES + readFileSync(join(__dirname, "admin-newsletters.styles.css"), "utf-8");
