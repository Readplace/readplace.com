import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "account-invoices.styles.css");
export const ACCOUNT_INVOICES_STYLES = readFileSync(stylesPath, "utf-8");
