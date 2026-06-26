import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "inbox-email-detail.styles.css");
export const INBOX_EMAIL_DETAIL_STYLES = readFileSync(stylesPath, "utf-8");
