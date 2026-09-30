import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ADMIN_INDEX_STYLES = readFileSync(join(__dirname, "admin-index.styles.css"), "utf-8");
