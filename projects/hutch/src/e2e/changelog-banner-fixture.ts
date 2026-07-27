import assert from "node:assert/strict";
import { isChangelogVersion, type ChangelogBanner } from "@packages/web-shell";

export const E2E_CHANGELOG_BANNER_HEADER = "x-e2e-changelog-banner";

const E2E_CHANGELOG_VERSION = "e2ec0de1";
assert(
	isChangelogVersion(E2E_CHANGELOG_VERSION),
	"the e2e changelog fixture version must satisfy the shared ChangelogVersion contract",
);

export const E2E_CHANGELOG_BANNER: ChangelogBanner = {
	hook: "Readplace now folds a whole Pocket export into your queue in one pass.",
	href: "/blog/e2e-changelog-fixture",
	version: E2E_CHANGELOG_VERSION,
};
