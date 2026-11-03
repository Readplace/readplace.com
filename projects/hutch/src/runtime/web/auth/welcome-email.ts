import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { EMAIL_POSTAL_ADDRESS } from "../email-copy";
import { PRICE_STATEMENT, SAVES_STAY_STATEMENT } from "../price-statement";
import { UNSUBSCRIBE_LABEL } from "../queue-digest-email";
import { SAVE_SURFACES_PHRASE } from "../shared/client-surface-phrases";
import { render } from "@packages/web-shell";

const WELCOME_EMAIL_TEMPLATE = readFileSync(join(__dirname, "welcome-email.template.html"), "utf-8");
const WELCOME_CONNECTOR_EMAIL_TEMPLATE = readFileSync(join(__dirname, "welcome-connector-email.template.html"), "utf-8");

export function buildWelcomeEmailHtml({
	installUrl,
	avatarUrl,
}: {
	installUrl: string;
	avatarUrl: string;
}): string {
	return render(WELCOME_EMAIL_TEMPLATE, {
		installUrl,
		avatarUrl,
		saveSurfaces: SAVE_SURFACES_PHRASE,
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}

export function buildWelcomeConnectorEmailHtml({
	assistantName,
	installUrl,
	avatarUrl,
	unsubscribeUrl,
}: {
	assistantName: "ChatGPT" | "Claude";
	installUrl: string;
	avatarUrl: string;
	unsubscribeUrl: string;
}): string {
	return render(WELCOME_CONNECTOR_EMAIL_TEMPLATE, {
		assistantName,
		installUrl,
		avatarUrl,
		unsubscribeUrl,
		unsubscribeLabel: UNSUBSCRIBE_LABEL,
		priceStatement: PRICE_STATEMENT,
		savesStayStatement: SAVES_STAY_STATEMENT,
		postalAddress: EMAIL_POSTAL_ADDRESS,
		colors: EMAIL_COLORS,
		fontStack: EMAIL_FONT_STACK,
	});
}
