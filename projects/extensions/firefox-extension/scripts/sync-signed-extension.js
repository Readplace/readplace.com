#!/usr/bin/env node

const assert = require("node:assert");
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HutchLogger, consoleLogger } = require("@packages/hutch-logger");
const { firefoxS3Config } = require("browser-extension-core/s3-config");
const { getBucketName, getBucketBaseUrl } = firefoxS3Config;

const logger = HutchLogger.from(consoleLogger);

const AMO_API_BASE = "https://addons.mozilla.org/api/v5";

const manifestPath = path.join(__dirname, "..", "src", "runtime", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const ADDON_ID = manifest.browser_specific_settings.gecko.id;

function createJwt({ issuer, secret }) {
	const encode = (obj) =>
		Buffer.from(JSON.stringify(obj)).toString("base64url");

	const header = encode({ alg: "HS256", typ: "JWT" });
	const now = Math.floor(Date.now() / 1000);
	const payload = encode({
		iss: issuer,
		jti: crypto.randomUUID(),
		iat: now,
		exp: now + 300,
	});

	const signature = crypto
		.createHmac("sha256", secret)
		.update(`${header}.${payload}`)
		.digest("base64url");

	return `${header}.${payload}.${signature}`;
}

async function main() {
	const issuer = process.env.AMO_JWT_ISSUER;
	const secret = process.env.AMO_JWT_SECRET;
	const stage = "prod";

	assert.ok(issuer, "AMO_JWT_ISSUER is required");
	assert.ok(secret, "AMO_JWT_SECRET is required");

	const token = createJwt({ issuer, secret });
	const bucketName = getBucketName(stage);
	const baseUrl = getBucketBaseUrl(stage);

	let currentUpdateLink = null;
	const updatesUrl = `${baseUrl}/updates.json`;
	const updatesResponse = await fetch(updatesUrl);
	if (updatesResponse.status === 404) {
		logger.info(`No updates.json on S3 yet (first run): ${updatesUrl} ${updatesResponse.status}`);
	} else {
		assert.ok(
			updatesResponse.ok,
			`Failed to read updates.json from S3 (${updatesUrl}): ${updatesResponse.status}`,
		);
		const updates = await updatesResponse.json();
		const addonUpdates = updates.addons?.[ADDON_ID]?.updates;
		if (addonUpdates?.length > 0) {
			currentUpdateLink = addonUpdates[0].update_link;
		}
	}

	const encodedId = encodeURIComponent(ADDON_ID);
	const response = await fetch(
		`${AMO_API_BASE}/addons/addon/${encodedId}/versions/?filter=all_with_unlisted`,
		{ headers: { Authorization: `JWT ${token}` } },
	);

	const amoBody = await response.text();
	assert.ok(response.ok, `AMO API error: ${response.status} ${amoBody}`);

	const data = JSON.parse(amoBody);
	const signedVersion = data.results?.find(
		(v) => v.file?.status === "public",
	);

	if (!signedVersion) {
		logger.info("No signed version found on AMO. Nothing to sync.");
		return;
	}

	assert.ok(
		/^\d+\.\d+\.\d+$/.test(signedVersion.version),
		`Unexpected version format from AMO: ${signedVersion.version}`,
	);

	logger.info(`Latest signed version on AMO: ${signedVersion.version}`);

	const signedFilename = `hutch-signed-${signedVersion.version}.xpi`;
	const expectedLink = `${baseUrl}/${signedFilename}`;

	if (currentUpdateLink === expectedLink) {
		logger.info("S3 already has the latest signed version. Nothing to do.");
		return;
	}

	logger.info("Downloading signed XPI from AMO...");
	const xpiResponse = await fetch(signedVersion.file.url, {
		headers: { Authorization: `JWT ${token}` },
	});

	assert.ok(xpiResponse.ok, `XPI download failed: ${xpiResponse.status}`);

	const tmpDir = "/tmp/sync-signed";
	fs.mkdirSync(tmpDir, { recursive: true });

	try {
		const tmpXpiPath = path.join(tmpDir, signedFilename);
		fs.writeFileSync(
			tmpXpiPath,
			Buffer.from(await xpiResponse.arrayBuffer()),
		);

		logger.info(`Uploading ${signedFilename} to S3...`);
		execSync(
			`aws s3 cp "${tmpXpiPath}" "s3://${bucketName}/${signedFilename}" --content-type "application/x-xpinstall"`,
			{ stdio: "inherit" },
		);

		// Update updates.json before latest.txt so auto-update pointer is
		// consistent before the install page pointer changes
		const updatesJsonPath = path.join(tmpDir, "updates.json");
		fs.writeFileSync(
			updatesJsonPath,
			JSON.stringify(
				{
					addons: {
						[ADDON_ID]: {
							updates: [
								{
									version: signedVersion.version,
									update_link: expectedLink,
								},
							],
						},
					},
				},
				null,
				2,
			),
		);
		execSync(
			`aws s3 cp "${updatesJsonPath}" "s3://${bucketName}/updates.json" --content-type "application/json"`,
			{ stdio: "inherit" },
		);

		const latestTxtPath = path.join(tmpDir, "latest.txt");
		fs.writeFileSync(latestTxtPath, signedFilename);
		execSync(
			`aws s3 cp "${latestTxtPath}" "s3://${bucketName}/latest.txt" --content-type "text/plain"`,
			{ stdio: "inherit" },
		);

		logger.info(
			`Successfully synced signed version ${signedVersion.version} to S3`,
		);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	logger.error("Sync failed:", error.message);
	process.exit(1);
});
