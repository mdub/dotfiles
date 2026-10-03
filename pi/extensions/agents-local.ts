/**
 * AGENTS.local.md Extension
 *
 * Loads uncommitted, checkout-local `AGENTS.local.md` files into the system prompt's
 * project context, alongside the `AGENTS.md` files pi already loads.
 *
 * Looks in every directory from the working directory up to the enclosing git
 * repository root (or just the working directory, outside a repository). Each file
 * is placed straight after the context file from the same directory, if there is
 * one, so it reads as an addendum to it.
 *
 * Files are re-read before each agent run, so edits apply without a restart.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FILENAME = "AGENTS.local.md";

function searchDirs(cwd: string): string[] {
	const dirs: string[] = [];
	let dir = resolve(cwd);
	while (true) {
		dirs.push(dir);
		if (existsSync(join(dir, ".git"))) return dirs.reverse();
		const parent = dirname(dir);
		if (parent === dir) return [resolve(cwd)];
		dir = parent;
	}
}

function readLocalFile(dir: string): { path: string; content: string } | undefined {
	const path = join(dir, FILENAME);
	try {
		if (!statSync(path).isFile()) return undefined;
		return { path, content: readFileSync(path, "utf-8").replace(/^\uFEFF/, "") };
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const contextFiles = event.systemPromptOptions.contextFiles;
		for (const dir of searchDirs(ctx.cwd)) {
			const local = readLocalFile(dir);
			if (!local || contextFiles.some((f) => f.path === local.path)) continue;
			const siblingIndex = contextFiles.findLastIndex((f) => dirname(f.path) === dir);
			if (siblingIndex === -1) {
				contextFiles.push(local);
			} else {
				contextFiles.splice(siblingIndex + 1, 0, local);
			}
		}
	});
}
