import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_STYLES } from "../auth/auth.styles";

export const OAUTH_AUTHORIZE_STYLES = `${AUTH_STYLES}\n${readFileSync(join(__dirname, "oauth-authorize.styles.css"), "utf-8")}`;
