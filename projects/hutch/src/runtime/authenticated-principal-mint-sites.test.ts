import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `authenticatedUserIdFrom` is the sole producer of an `AuthenticatedUserId` —
 * the id a request runs as. It may be called only where a validated session
 * cookie or OAuth bearer token is turned into a principal, never on a value
 * read off a row, an event payload, or a tool argument. The branded type stops
 * a plain `UserId` from being used as the principal at compile time; this test
 * closes the remaining gap — minting a principal from caller-supplied input —
 * by failing the moment a non-test call site appears that is not a deliberate,
 * reviewed auth boundary added to the allowlist below.
 */
const REPO_ROOT = join(__dirname, "../../../..");
const SCAN_ROOTS = ["projects/hutch/src", "src/packages"];
const MINT_IDENTIFIER = "authenticatedUserIdFrom";

const ALLOWED_MINT_SITES = [
	"src/packages/domain/src/user/user.schema.ts", // defines the mint
	"src/packages/domain/src/user/index.ts", // re-exports it
	"src/packages/test-fixtures/src/providers/oauth/validate-access-token.ts", // bearer-token boundary
	"src/packages/test-fixtures/src/providers/auth/in-memory-auth.ts", // session boundary (in-memory)
	"projects/hutch/src/runtime/providers/auth/dynamodb-auth.ts", // session boundary (DynamoDB)
];

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".nx") {
				continue;
			}
			yield* sourceFiles(full);
		} else if (
			entry.name.endsWith(".ts") &&
			!entry.name.endsWith(".d.ts") &&
			!entry.name.endsWith(".test.ts")
		) {
			yield full;
		}
	}
}

describe("AuthenticatedUserId mint sites", () => {
	it("mints the request principal only at request-auth boundaries", () => {
		const found: string[] = [];
		for (const root of SCAN_ROOTS) {
			for (const file of sourceFiles(join(REPO_ROOT, root))) {
				if (readFileSync(file, "utf8").includes(MINT_IDENTIFIER)) {
					found.push(relative(REPO_ROOT, file));
				}
			}
		}
		expect(found.sort()).toEqual([...ALLOWED_MINT_SITES].sort());
	});
});
