import assert from "node:assert";
import { join } from "node:path";
import { generateFiles, logger, names, type Tree } from "@nx/devkit";

export type PackageGeneratorSchema = {
	name: string;
	description: string;
};

export default function packageGenerator(
	tree: Tree,
	options: PackageGeneratorSchema,
): void {
	const { fileName, propertyName } = names(options.name);
	assert(
		/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(fileName),
		`Package name must normalise to kebab-case, got "${fileName}"`,
	);
	assert(
		options.description.trim().length > 0,
		"A non-empty description is required — it becomes the package.json description",
	);
	const packageRoot = join("src/packages", fileName);
	assert(!tree.exists(packageRoot), `${packageRoot} already exists`);
	generateFiles(tree, join(__dirname, "files"), packageRoot, {
		name: fileName,
		propertyName,
		packageName: `@packages/${fileName}`,
		description: options.description,
		tmpl: "",
	});
	logger.info(
		`Scaffolded @packages/${fileName} at ${packageRoot} — run 'pnpm install' to link it into the workspace`,
	);
}
