import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { shell } from "@packages/translations/shell";
import { NOT_FOUND_STYLES } from "./not-found.styles";
import { NOT_FOUND_TEMPLATE } from "./not-found.template";
import type { PageBody } from "./page-body.types";
import { render } from "./render";

const { t } = translator(shell, DEFAULT_LOCALE);

export function NotFoundPage(params: { trackSource: string }): PageBody {
	return {
		seo: {
			title: t("notFound.seo.title"),
			description: t("notFound.seo.description"),
			canonicalUrl: "https://readplace.com",
			robots: "noindex, nofollow",
		},
		styles: NOT_FOUND_STYLES,
		bodyClass: "page-not-found",
		content: { html: render(NOT_FOUND_TEMPLATE, { trackSource: params.trackSource }) },
		statusCode: 404,
	};
}
