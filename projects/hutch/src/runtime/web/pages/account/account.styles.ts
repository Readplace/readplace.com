import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "account.styles.css");
export const ACCOUNT_STYLES = readFileSync(stylesPath, "utf-8");
