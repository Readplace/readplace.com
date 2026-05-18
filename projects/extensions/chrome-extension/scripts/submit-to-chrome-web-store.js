#!/usr/bin/env node
// Uploads the chrome-extension package to the Chrome Web Store via the
// CWS Publish API. Auth is a refresh-token-based OAuth flow keyed by
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN secrets.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CWS_API_BASE = "https://www.googleapis.com";

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	const body = await response.text();
	assert.ok(response.ok, `OAuth2 token refresh failed: ${response.status} ${body}`);
	return JSON.parse(body).access_token;
}

async function uploadExtension({ extensionId, zipPath, accessToken }) {
	const zipBuffer = fs.readFileSync(zipPath);

	const response = await fetch(
		`${CWS_API_BASE}/upload/chromewebstore/v1.1/items/${extensionId}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"x-goog-api-version": "2",
			},
			body: zipBuffer,
		},
	);

	const body = await response.text();
	assert.ok(response.ok, `CWS upload failed: ${response.status} ${body}`);

	const result = JSON.parse(body);

	const notUpdatable = (result.itemError ?? []).some(
		(e) => e.error_code === "ITEM_NOT_UPDATABLE",
	);
	if (notUpdatable) {
		return { skipped: true };
	}

	assert.ok(
		result.uploadState === "SUCCESS",
		`CWS upload state: ${result.uploadState}. Errors: ${JSON.stringify(result.itemError ?? [])}`,
	);

	return result;
}

async function publishExtension({ extensionId, accessToken }) {
	const response = await fetch(
		`${CWS_API_BASE}/chromewebstore/v1.1/items/${extensionId}/publish`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"x-goog-api-version": "2",
			},
		},
	);

	const body = await response.text();
	assert.ok(response.ok, `CWS publish failed: ${response.status} ${body}`);

	const result = JSON.parse(body);
	console.log(`Publish status: ${JSON.stringify(result.status)}`);
	return result;
}

async function main() {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
	const extensionId = process.env.CHROME_EXTENSION_ID;

	assert.ok(clientId, "GOOGLE_CLIENT_ID is required");
	assert.ok(clientSecret, "GOOGLE_CLIENT_SECRET is required");
	assert.ok(refreshToken, "GOOGLE_REFRESH_TOKEN is required");
	assert.ok(extensionId, "CHROME_EXTENSION_ID is required");

	const distDir = path.join(__dirname, "..", "dist-extension-files");
	const files = fs.readdirSync(distDir);
	const prodZip = files.find(
		(f) => f.endsWith(".zip") && !f.includes("-dev"),
	);

	assert.ok(prodZip, `No production .zip found in ${distDir}. Found: ${files.join(", ")}`);

	const zipPath = path.join(distDir, prodZip);

	console.log("Refreshing OAuth2 access token...");
	const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });

	console.log(`Uploading ${prodZip} to Chrome Web Store...`);
	const uploadResult = await uploadExtension({ extensionId, zipPath, accessToken });

	if (uploadResult.skipped) {
		console.warn("Extension is not updatable (pending review or ready to publish). Skipping — the previously submitted version is still being processed by Google.");
		process.exit(0);
	}

	console.log("Publishing extension...");
	await publishExtension({ extensionId, accessToken });

	console.log("Extension submitted to Chrome Web Store for review.");
}

main().catch((error) => {
	console.error("Chrome Web Store submission failed:", error.message);
	process.exit(1);
});
