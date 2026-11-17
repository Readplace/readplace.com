import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ADMIN_MFA_STYLES = readFileSync(join(__dirname, "admin-mfa.styles.css"), "utf-8");
