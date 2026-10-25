/**
 * AGENTS.local.md Extension
 *
 * Loads uncommitted, checkout-local `AGENTS.local.md` files into the system prompt's
 * project context, alongside the `AGENTS.md` files pi already loads.
 *
 * Looks in every directory from the filesystem root down to the working directory,
 * matching how pi finds `AGENTS.md`. Each file is placed straight after the context
 * file from the same directory, if there is one, so it reads as an addendum to it.
 *
 * Files are re-read before each agent run, so edits apply without a restart.
 *
 * Pi's startup `[Context]` listing only shows the files pi loads itself, so the files
 * found at session start are announced in a separate notification.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FILENAME = "AGENTS.local.md";

function searchDirs(cwd: string): string[] {
	const dirs: string[] = [];
	let dir = resolve(cwd);
	while (true) {
		dirs.push(dir);
		const parent = dirname(dir);
		if (parent === dir) return dirs.toReversed();
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

function displayPath(path: string, cwd: string): string {
	const rel = relative(cwd, path);
	if (!rel.startsWith("..")) return rel;
	const home = homedir();
	return path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const found = searchDirs(ctx.cwd).filter((dir) => readLocalFile(dir));
		if (found.length === 0) return;
		const paths = found.map((dir) => displayPath(join(dir, FILENAME), ctx.cwd));
		ctx.ui.notify(`Context (local): ${paths.join(", ")}`, "info");
	});

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
