import assert from "node:assert";
import { type SaveableUrl, validateSaveableUrl } from "@packages/domain/article";

export function saveableUrlFixture(value: string): SaveableUrl {
	const result = validateSaveableUrl(value);
	assert(result.status === "SUCCESS", "a saveable URL fixture must pass validateSaveableUrl");
	return result.url;
}
