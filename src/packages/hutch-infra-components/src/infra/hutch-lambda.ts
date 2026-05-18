import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { build, type Loader, type Plugin } from "esbuild";
import assert from "node:assert";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const esbuildLoaders: Record<string, Loader> = { ".ts": "ts" };
const bundledExtensions = Object.keys(esbuildLoaders);

function copyAssetFiles(dirs: { src: string; dest: string }) {
	for (const entry of readdirSync(dirs.src, { withFileTypes: true })) {
		const srcPath = join(dirs.src, entry.name);
		if (entry.isDirectory()) {
			const destSubdir = join(dirs.dest, entry.name);
			mkdirSync(destSubdir, { recursive: true });
			copyAssetFiles({ src: srcPath, dest: destSubdir });
		} else if (!bundledExtensions.some((ext) => entry.name.endsWith(ext))) {
			copyFileSync(srcPath, join(dirs.dest, entry.name));
		}
	}
}

/**
 * pnpm uses symlinks in node_modules; Lambda zips dereference them but the
 * contents inside a symlinked package directory (which itself may contain
 * further symlinks to the .pnpm store) must be materialized as real files.
 */
function copyDirDereferenced(src: string, dest: string) {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		const stat = lstatSync(srcPath);
		if (stat.isSymbolicLink()) {
			const realSrc = realpathSync(srcPath);
			if (lstatSync(realSrc).isDirectory()) {
				copyDirDereferenced(realSrc, destPath);
			} else {
				copyFileSync(realSrc, destPath);
			}
		} else if (entry.isDirectory()) {
			copyDirDereferenced(srcPath, destPath);
		} else if (entry.isFile()) {
			copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * Copies an external runtime dependency into the Lambda zip's node_modules/
 * so the bundled handler's `require("<name>")` or runtime `import("<name>")`
 * resolves at runtime. Required for packages esbuild cannot bundle into a
 * CJS handler — native `.node` binaries (no loader) and ESM modules with
 * top-level await (e.g. `mupdf`).
 *
 * Resolution walks each provided context in order (entry-point first, then
 * each already-copied package), so a binary sub-package that isn't a direct
 * dependency of the Lambda's project can still be located via its parent's
 * require context. Returns the resolved package.json path so the caller can
 * chain it as the next resolution context. A package missing from every
 * context throws.
 */
function copyExternalPackage(packageName: string, contexts: NodeJS.Require[], outputDir: string): string {
	for (const ctx of contexts) {
		const pkgJsonPath = resolvePackageJsonPath(ctx, packageName);
		if (pkgJsonPath) {
			copyDirDereferenced(dirname(pkgJsonPath), join(outputDir, "node_modules", packageName));
			return pkgJsonPath;
		}
	}
	throw new Error(
		`HutchLambda external '${packageName}' not resolvable from the entry point or any previously-listed external. ` +
			`Check that it is installed (pnpm.supportedArchitectures may need to include its platform).`,
	);
}

/**
 * Locates a package's on-disk `package.json` from a given require context.
 *
 * Standard `ctx.resolve(`${pkg}/package.json`)` works for packages that don't
 * restrict the subpath via `exports`. Two pnpm-specific quirks force fallbacks:
 *
 * 1. Packages with strict `exports` (e.g. `mupdf` only exports `"."`) throw
 *    `ERR_PACKAGE_PATH_NOT_EXPORTED` for the deep `/package.json` request —
 *    fall back to resolving the main entry and walking up to `package.json`.
 *
 * 2. Transitive deps that aren't installed in the consumer's `node_modules`
 *    only live in `<workspaceRoot>/node_modules/.pnpm/node_modules/<pkg>/`,
 *    which Node's default resolution won't walk into — fall back to scanning
 *    that directory up from the entry point.
 *
 * Returns undefined when the package isn't installed in any of the searched
 * locations; other errors propagate.
 */
function resolvePackageJsonPath(ctx: NodeJS.Require, packageName: string): string | undefined {
	try {
		return ctx.resolve(`${packageName}/package.json`);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== "MODULE_NOT_FOUND" && code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw e;
	}
	try {
		const mainPath = ctx.resolve(packageName);
		let dir = dirname(mainPath);
		while (dir !== dirname(dir)) {
			const candidate = join(dir, "package.json");
			if (existsSync(candidate)) return candidate;
			dir = dirname(dir);
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw e;
	}
	// pnpm hoists every installed package to `<root>/node_modules/.pnpm/node_modules/<pkg>/`.
	// Walk up from the require context's referrer looking for that store dir.
	const referrerPath = (ctx as unknown as { path?: string }).path;
	const startDir = typeof referrerPath === "string" ? referrerPath : process.cwd();
	let dir = startDir;
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ".pnpm", "node_modules", packageName, "package.json");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	return undefined;
}

/**
 * esbuild bundles all code into a single index.js, so __dirname resolves to the
 * bundle root for every source module. This plugin rewrites __dirname in files
 * within the asset directory to include the file's relative path from the asset
 * root, so readFileSync(join(__dirname, "file")) resolves to the correct
 * subdirectory where copyAssetFiles placed the asset.
 */
function createDirnamePlugin(assetDir: string): Plugin {
	const assetDirAbs = resolve(assetDir);
	return {
		name: "dirname-rewrite",
		setup(pluginBuild) {
			pluginBuild.onLoad({ filter: /\.ts$/ }, (args) => {
				if (!args.path.startsWith(assetDirAbs)) return;

				const relPath = relative(assetDirAbs, dirname(args.path));
				const contents = readFileSync(args.path, "utf-8");
				return {
					contents: contents.replace(
						/__dirname/g,
						`require("node:path").join(__dirname, ${JSON.stringify(relPath)})`,
					),
					loader: "ts" as const,
				};
			});
		},
	};
}

export type LambdaPolicy = {
	name: string;
	policy: pulumi.Input<string>;
};

export class HutchLambda extends pulumi.ComponentResource {
	public readonly name: string;
	public readonly functionName: pulumi.Output<string>;
	public readonly arn: pulumi.Output<string>;
	public readonly role: aws.iam.Role;

	constructor(
		name: string,
		args: {
			entryPoint?: string;
			outputDir?: string;
			assetDir?: string;
			memorySize: number;
			timeout: number;
			environment: Record<string, pulumi.Input<string>>;
			policies: LambdaPolicy[];
			/**
			 * Packages to leave un-bundled and ship in the Lambda zip's
			 * node_modules/ instead. Required when esbuild cannot bundle the
			 * package into a CJS handler — native modules with `.node`
			 * binaries (no esbuild loader) and ESM packages with top-level
			 * `await` (e.g. `mupdf`, which esbuild refuses to inline into
			 * CJS and Node 22's `require(esm)` rejects with
			 * `ERR_REQUIRE_ASYNC_MODULE`). List each package to ship
			 * explicitly, including any platform-specific binary
			 * sub-packages the Lambda resolves at first require. A missing
			 * package fails the build loudly.
			 */
			external?: string[];
			/**
			 * When set, the Lambda is provisioned as a container image instead of
			 * a zip. The image must already be pushed to ECR — typically by a
			 * `build-image` step that runs before `pulumi up`. `entryPoint`,
			 * `outputDir`, and `assetDir` are ignored when this is set.
			 */
			containerImage?: { imageUri: pulumi.Input<string> };
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchLambda", name, {}, opts);

		this.name = name;
		const lambdaName = `${name}-handler`;
		const roleName = `${lambdaName}-role`;
		const basicExecutionName = `${name}-basic-execution`;

		this.role = new aws.iam.Role(roleName, {
			name: roleName,
			assumeRolePolicy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [{
					Action: "sts:AssumeRole",
					Principal: { Service: "lambda.amazonaws.com" },
					Effect: "Allow",
				}],
			}),
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		new aws.iam.RolePolicyAttachment(basicExecutionName, {
			role: this.role.name,
			policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		for (const p of args.policies) {
			new aws.iam.RolePolicy(p.name, {
				name: p.name,
				role: this.role.name,
				policy: p.policy,
			}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });
		}

		const hasEnvironment = Object.keys(args.environment).length > 0;
		const environmentArg = hasEnvironment ? { environment: { variables: args.environment } } : {};

		let lambdaFunction: aws.lambda.Function;
		if (args.containerImage) {
			lambdaFunction = new aws.lambda.Function(lambdaName, {
				name: lambdaName,
				packageType: "Image",
				imageUri: args.containerImage.imageUri,
				role: this.role.arn,
				memorySize: args.memorySize,
				timeout: args.timeout,
				...environmentArg,
			}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });
		} else {
			assert(args.entryPoint, "HutchLambda zip packaging requires 'entryPoint'");
			assert(args.outputDir, "HutchLambda zip packaging requires 'outputDir'");
			assert(args.assetDir, "HutchLambda zip packaging requires 'assetDir'");
			const { entryPoint, outputDir, assetDir } = args;

			mkdirSync(outputDir, { recursive: true });

			const lambdaCode = build({
				entryPoints: [entryPoint],
				bundle: true,
				sourcemap: true,
				platform: "node",
				format: "cjs",
				minify: true,
				outfile: `${outputDir}/index.js`,
				target: ["node22"],
				loader: esbuildLoaders,
				plugins: [createDirnamePlugin(assetDir)],
				external: args.external,
			}).then(() => {
				copyAssetFiles({ src: assetDir, dest: outputDir });
				if (args.external?.length) {
					const contexts: NodeJS.Require[] = [createRequire(resolve(entryPoint))];
					for (const pkgName of args.external) {
						const pkgJsonPath = copyExternalPackage(pkgName, contexts, outputDir);
						contexts.push(createRequire(pkgJsonPath));
					}
				}
				return new pulumi.asset.AssetArchive({
					".": new pulumi.asset.FileArchive(outputDir),
				});
			});

			lambdaFunction = new aws.lambda.Function(lambdaName, {
				name: lambdaName,
				runtime: aws.lambda.Runtime.NodeJS22dX,
				handler: "index.handler",
				role: this.role.arn,
				code: lambdaCode,
				memorySize: args.memorySize,
				timeout: args.timeout,
				...environmentArg,
			}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });
		}

		this.functionName = lambdaFunction.name;
		this.arn = lambdaFunction.arn;
		this.registerOutputs();
	}
}
