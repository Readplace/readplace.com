import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES, IN_FLIGHT_DOTS_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "account.styles.css");
const billingStylesPath = join(__dirname, "account-billing.styles.css");
const connectedAppsStylesPath = join(__dirname, "account-connected-apps.styles.css");
export const ACCOUNT_STYLES =
	IN_FLIGHT_DOTS_STYLES +
	ALERT_STYLES +
	readFileSync(stylesPath, "utf-8") +
	readFileSync(billingStylesPath, "utf-8") +
	readFileSync(connectedAppsStylesPath, "utf-8");
