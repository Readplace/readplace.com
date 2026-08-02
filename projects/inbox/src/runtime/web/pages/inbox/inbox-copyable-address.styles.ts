import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "inbox-copyable-address.styles.css");
export const INBOX_COPYABLE_ADDRESS_STYLES = readFileSync(stylesPath, "utf-8");
