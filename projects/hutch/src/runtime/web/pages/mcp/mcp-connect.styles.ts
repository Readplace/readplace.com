import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "mcp-connect.styles.css");
export const MCP_CONNECT_STYLES = readFileSync(stylesPath, "utf-8");
