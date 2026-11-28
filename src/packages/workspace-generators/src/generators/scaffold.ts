import assert from "node:assert";
import { join } from "node:path";
import { generateFiles, logger, names, type Tree } from "@nx/devkit";

export function scaffold(
	tree: Tree,
	options: { name: string; description: string },
	target: {
		noun: "Package" | "Project";
		root: string;
		packageName: (fileName: string) => string;
		templateDir: string;
	},
): void {
	const { fileName, propertyName } = names(options.name);
	assert(
		/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(fileName),
		`${target.noun} name must normalise to kebab-case, got "${fileName}"`,
	);
	assert(
		options.description.trim().length > 0,
		"A non-empty description is required — it becomes the package.json description",
	);
	const destination = join(target.root, fileName);
	assert(!tree.exists(destination), `${destination} already exists`);
	const packageName = target.packageName(fileName);
	generateFiles(tree, target.templateDir, destination, {
		name: fileName,
		propertyName,
		packageName,
		description: options.description,
		tmpl: "",
	});
	logger.info(
		`Scaffolded ${packageName} at ${destination} — run 'pnpm install' to link it into the workspace`,
	);
}
