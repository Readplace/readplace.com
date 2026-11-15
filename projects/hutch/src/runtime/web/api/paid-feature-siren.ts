import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchApi } from "@packages/translations/hutch-api";
import { type SirenEntity, sirenMessages } from "./siren";

const { t } = translator(hutchApi, DEFAULT_LOCALE);

export function paidFeatureSirenError(): SirenEntity {
	return sirenMessages([
		{
			type: "warning",
			content: {
				type: "text/html",
				body: t("paidFeature.refused"),
			},
		},
	]);
}
