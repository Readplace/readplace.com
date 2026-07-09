import assert from "node:assert";
import { join } from "node:path";
import { generateFiles, logger, names, type Tree } from "@nx/devkit";

export type ProjectGeneratorSchema = {
	name: string;
	description: string;
};

export default function projectGenerator(
	tree: Tree,
	options: ProjectGeneratorSchema,
): void {
	const { fileName, propertyName } = names(options.name);
	assert(
		/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(fileName),
		`Project name must normalise to kebab-case, got "${fileName}"`,
	);
	assert(
		options.description.trim().length > 0,
		"A non-empty description is required — it becomes the package.json description",
	);
	const projectRoot = join("projects", fileName);
	assert(!tree.exists(projectRoot), `${projectRoot} already exists`);
	generateFiles(tree, join(__dirname, "files"), projectRoot, {
		name: fileName,
		propertyName,
		packageName: fileName,
		description: options.description,
		tmpl: "",
	});
	logger.info(
		`Scaffolded ${fileName} at ${projectRoot} — run 'pnpm install' to link it into the workspace`,
	);
}
