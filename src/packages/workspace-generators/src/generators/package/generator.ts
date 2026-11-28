import { join } from "node:path";
import type { Tree } from "@nx/devkit";
import { scaffold } from "../scaffold";

export type PackageGeneratorSchema = {
	name: string;
	description: string;
};

export default function packageGenerator(
	tree: Tree,
	options: PackageGeneratorSchema,
): void {
	scaffold(tree, options, {
		noun: "Package",
		root: "src/packages",
		packageName: (fileName) => `@packages/${fileName}`,
		templateDir: join(__dirname, "files"),
	});
}
