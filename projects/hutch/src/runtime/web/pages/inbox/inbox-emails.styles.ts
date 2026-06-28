import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "inbox-emails.styles.css");
export const INBOX_EMAILS_STYLES = readFileSync(stylesPath, "utf-8");
