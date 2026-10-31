/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777, and ways of skipping git hooks
 * (--no-verify, `git commit -n`, LEFTHOOK=0, overriding core.hooksPath).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const checks = [
		{
			label: "Dangerous command",
			patterns: [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i],
		},
		{
			label: "Command skips git hooks",
			patterns: [
				/\bgit\b.*\s--no-verify\b/,
				/\bgit\b.*\scommit\b.*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/,
				/\bLEFTHOOK(_EXCLUDE)?=/,
				/\bgit\b.*\s-c\s*core\.hookspath=/i,
				/\bgit\b.*\sconfig\b.*\score\.hookspath\s+\S/i,
			],
		},
	];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const match = checks.find((check) => check.patterns.some((p) => p.test(command)));

		if (match) {
			if (!ctx.hasUI) {
				// In non-interactive mode, block by default
				return { block: true, reason: `${match.label}: blocked (no UI for confirmation)` };
			}

			const choice = await ctx.ui.select(`⚠️ ${match.label}:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
