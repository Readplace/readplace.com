import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchApi } from "@packages/translations/hutch-api";
import { type SirenEntity, sirenMessages, sirenWarning } from "./siren";

const { t } = translator(hutchApi, DEFAULT_LOCALE);

export function paidFeatureSirenError(): SirenEntity {
	return sirenMessages([sirenWarning(t("paidFeature.refused"))]);
}
