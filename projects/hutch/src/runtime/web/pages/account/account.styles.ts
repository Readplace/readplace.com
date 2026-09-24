import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IN_FLIGHT_DOTS_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "account.styles.css");
export const ACCOUNT_STYLES = IN_FLIGHT_DOTS_STYLES + readFileSync(stylesPath, "utf-8");
