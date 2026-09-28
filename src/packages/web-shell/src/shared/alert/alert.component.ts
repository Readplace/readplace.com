import type { IconName } from "@packages/ui-icons";
import { render } from "../../render";
import {
	ALERT_HIDDEN_TEMPLATE,
	ALERT_HTML_MESSAGE_TEMPLATE,
	ALERT_TEMPLATE,
	ALERT_TEXT_MESSAGE_TEMPLATE,
	ALERT_TITLE_TEMPLATES,
} from "./alert.template";

export { ALERT_STYLES } from "./alert.styles";

export type AlertVariant = "error" | "warning" | "success" | "info";
export type AlertTitle = { text: string; element: "p" | "h1" | "h2" };
export type AlertMessage = { text: string } | { html: string };
export type AlertContent =
	| { variant: AlertVariant; title: AlertTitle; message?: AlertMessage }
	| { variant: AlertVariant; title?: undefined; message: AlertMessage };

const VARIANTS: Record<AlertVariant, { icon: IconName; role: "alert" | "status" }> = {
	error: { icon: "x-circle", role: "alert" },
	warning: { icon: "alert-triangle", role: "status" },
	success: { icon: "check-circle", role: "status" },
	info: { icon: "info", role: "status" },
};

export function renderAlert(input: { key: string; content: AlertContent | undefined }): string {
	const content = input.content;
	if (content === undefined) return render(ALERT_HIDDEN_TEMPLATE, { key: input.key });

	const { icon, role } = VARIANTS[content.variant];
	const titleHtml = content.title === undefined
		? ""
		: render(ALERT_TITLE_TEMPLATES[content.title.element], { text: content.title.text });
	const messageHtml = content.message === undefined
		? ""
		: "html" in content.message
			? render(ALERT_HTML_MESSAGE_TEMPLATE, { html: content.message.html })
			: render(ALERT_TEXT_MESSAGE_TEMPLATE, { text: content.message.text });

	return render(ALERT_TEMPLATE, {
		key: input.key,
		variant: content.variant,
		role,
		iconName: icon,
		titleHtml,
		messageHtml,
	});
}
