/**
 * mw-auto-compact
 *
 * Compacts the session when context usage reaches 80% of the model's context
 * window or 400k tokens, whichever comes first. Override with
 * PI_MW_AUTO_COMPACT_PERCENT and PI_MW_AUTO_COMPACT_MAX_TOKENS.
 *
 * The check runs at each turn end. Pi's ctx.compact() aborts the agent first,
 * so if the run was going to continue, a follow-up prompt resumes it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PERCENT = Number(process.env.PI_MW_AUTO_COMPACT_PERCENT) || 80;
const MAX_TOKENS = Number(process.env.PI_MW_AUTO_COMPACT_MAX_TOKENS) || 400_000;

const RESUME_PROMPT =
	"Continue the current task from the compacted context. If the task is already complete, briefly say so; otherwise resume at the next concrete step without asking for confirmation.";

function formatTokens(n: number): string {
	return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1_000)}k`;
}

export default function (pi: ExtensionAPI) {
	let compacting = false;

	pi.on("turn_end", (event, ctx) => {
		if (compacting) return;

		const usage = ctx.getContextUsage();
		if (!usage?.tokens) return;

		const limit = Math.min(MAX_TOKENS, (PERCENT / 100) * usage.contextWindow);
		if (usage.tokens < limit) return;

		// Tool results mean another model request was coming, so resume after compacting.
		const resume = event.toolResults.length > 0;

		compacting = true;
		pi.appendEntry("mw-auto-compact", {
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			limit: Math.floor(limit),
		});
		ctx.ui.notify(
			`Context at ${formatTokens(usage.tokens)} of ${formatTokens(usage.contextWindow)} reached the ${formatTokens(limit)} limit; compacting…`,
			"info",
		);
		// These callbacks can outlive ctx (session switch, or print mode exiting
		// mid-compaction), and touching a stale ctx throws.
		const ifCurrent = (fn: () => void) => {
			try {
				fn();
			} catch {}
		};
		ctx.compact({
			onComplete: () => {
				compacting = false;
				ifCurrent(() => {
					if (resume && !ctx.hasPendingMessages()) pi.sendUserMessage(RESUME_PROMPT, { deliverAs: "followUp" });
				});
			},
			onError: (error) => {
				compacting = false;
				ifCurrent(() => ctx.ui.notify(`mw-auto-compact: ${error.message}`, "error"));
			},
		});
	});
}
