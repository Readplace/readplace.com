import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ADMIN_DASHBOARD_STYLES = readFileSync(join(__dirname, "admin-dashboard.styles.css"), "utf-8");
