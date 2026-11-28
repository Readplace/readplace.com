import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchApi } from "@packages/translations/hutch-api";
import { type SirenEntity, sirenMessages, sirenWarning } from "./siren";

const { t } = translator(hutchApi, DEFAULT_LOCALE);

type AgeAccessRefusal = "refusedUnder13" | "refusedParentalApproval" | "accountPaused";

export function ageAccessSirenError(refusal: AgeAccessRefusal): SirenEntity {
	return sirenMessages([sirenWarning(t(`ageAccess.${refusal}`))]);
}
