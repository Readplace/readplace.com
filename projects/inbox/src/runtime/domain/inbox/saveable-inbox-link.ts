import { type ValidateSaveableUrl, validateSaveableUrl, withPrivateItemRefusal } from "@packages/domain/article";

export const validateSaveableInboxLink: ValidateSaveableUrl = withPrivateItemRefusal(validateSaveableUrl);
