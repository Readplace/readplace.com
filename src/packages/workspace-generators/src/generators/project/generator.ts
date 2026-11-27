import { join } from "node:path";
import type { Tree } from "@nx/devkit";
import { scaffold } from "../scaffold";

export type ProjectGeneratorSchema = {
	name: string;
	description: string;
};

export default function projectGenerator(
	tree: Tree,
	options: ProjectGeneratorSchema,
): void {
	scaffold(tree, options, {
		noun: "Project",
		root: "projects",
		packageName: (fileName) => fileName,
		templateDir: join(__dirname, "files"),
	});
}
