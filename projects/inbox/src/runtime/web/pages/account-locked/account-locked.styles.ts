import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "account-locked.styles.css");
export const ACCOUNT_LOCKED_STYLES = readFileSync(stylesPath, "utf-8");
