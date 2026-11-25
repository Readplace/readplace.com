import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_STYLES, PAGINATION_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "inbox-emails.styles.css");
export const INBOX_EMAILS_STYLES = MENU_STYLES + PAGINATION_STYLES + readFileSync(stylesPath, "utf-8");
