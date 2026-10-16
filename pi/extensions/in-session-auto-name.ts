/**
 * In-session Auto-name Extension
 *
 * Gives the main model a `set_session_name` tool, so the session is named (and later
 * renamed) by the model that has the whole conversation in context, inside the normal
 * request rather than through a separate model call.
 *
 * Everything the model sees is kept cache-friendly: the tool and its guidelines are
 * static, and everything else reaches the model as messages appended to the transcript.
 *
 * - Standing guidelines alone rarely get acted on, so the extension attaches a short
 *   reminder to user prompts at Fibonacci spacing (prompts 1, 2, 3, 5, 8, 13, 21, …), with
 *   the gap capped at 21 prompts.
 * - A name set by the user (e.g. `/name`) is left alone until the user clears it, or runs
 *   `/auto-session-name`, which asks the model to (re)name the session now.
 * - The tool is hidden in sessions without a UI, such as sub-agents.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TOOL_NAME = "set_session_name";
const NAME_MESSAGE_TYPE = "session-name";
const NUDGE_MESSAGE_TYPE = "session-name-nudge";
const MANUAL_ENTRY_TYPE = "session-name-manual";
const REQUEST_MESSAGE_TYPE = "session-name-request";
const MAX_PROMPTS_BETWEEN_NUDGES = 21;
const MAX_NAME_CHARS = 80;

interface RenameDetails {
	previous?: string;
	name?: string;
}

interface NameMessageDetails {
	name?: string;
}

interface ManualEntryData {
	manual: boolean;
}

function isUserPrompt(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message.role === "user";
}

function isRenameResult(entry: SessionEntry): boolean {
	return (
		entry.type === "message" &&
		entry.message.role === "toolResult" &&
		entry.message.toolName === TOOL_NAME &&
		!entry.message.isError
	);
}

function isNudge(entry: SessionEntry): boolean {
	return entry.type === "custom_message" && entry.customType === NUDGE_MESSAGE_TYPE;
}

function countPrompts(entries: SessionEntry[]): number {
	return entries.filter(isUserPrompt).length;
}

function isManuallyNamed(branch: SessionEntry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "custom" && entry.customType === MANUAL_ENTRY_TYPE) {
			return (entry.data as ManualEntryData | undefined)?.manual === true;
		}
	}
	return false;
}

function isRenameRequested(branch: SessionEntry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "custom_message" && entry.customType === REQUEST_MESSAGE_TYPE) return true;
		if (isRenameResult(entry) || isUserPrompt(entry)) return false;
	}
	return false;
}

function lastAnnouncedName(branch: SessionEntry[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "custom_message" && (entry.customType === NAME_MESSAGE_TYPE || isNudge(entry))) {
			return (entry.details as NameMessageDetails | undefined)?.name;
		}
		if (isRenameResult(entry) && entry.type === "message" && entry.message.role === "toolResult") {
			return (entry.message.details as RenameDetails | undefined)?.name;
		}
	}
	return undefined;
}

/** Whether user prompt number `prompt` (1-based) gets a naming reminder. */
function isNudgePrompt(prompt: number): boolean {
	let nudgeAt = 1;
	let [gap, nextGap] = [1, 1];
	while (nudgeAt < prompt) {
		nudgeAt += Math.min(gap, MAX_PROMPTS_BETWEEN_NUDGES);
		[gap, nextGap] = [nextGap, gap + nextGap];
	}
	return nudgeAt === prompt;
}

function normalizeName(raw: string): string {
	let name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	name = name.replace(/^["'“]+|["'”]+$/g, "").replace(/[.!?;:,]+$/u, "").trim();
	if (name.length > MAX_NAME_CHARS) name = name.slice(0, MAX_NAME_CHARS).replace(/\s+\S*$/, "").trim();
	return name;
}

export default function inSessionAutoName(pi: ExtensionAPI) {
	let enabled = false;
	let toolSetName: string | undefined;

	const announce = (name: string | undefined, text: string) => {
		pi.sendMessage<NameMessageDetails>(
			{ customType: NAME_MESSAGE_TYPE, content: text, display: false, details: { name } },
			{ deliverAs: "nextTurn" },
		);
	};

	const rename = (name: string) => {
		toolSetName = name;
		pi.setSessionName(name);
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Set session name",
		description:
			"Set the display name of the current session, as shown in the session list. " +
			"Use a concise title (3 to 8 words) summarising the topic of the conversation.",
		promptSnippet: "Name or rename the current session",
		promptGuidelines: [
			`Use \`${TOOL_NAME}\` to keep the session's name a short summary of what the conversation is about. Name it after the user's first couple of prompts, once the topic is clear. As the conversation goes on, update the name occasionally so it still describes the topic accurately; don't rename for brief detours. Do this quietly, alongside your normal work, without mentioning it unless asked.`,
			`Session names: 3 to 8 words summarising the topic; keep ticket ids, project names and technical terms; avoid generic titles like "Coding session"; no quotes or trailing punctuation.`,
		],
		parameters: Type.Object({
			name: Type.String({ description: "The new session name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const branch = ctx.sessionManager.getBranch();
			const previous = pi.getSessionName();

			const manual = previous !== undefined && isManuallyNamed(branch);
			if (manual && !isRenameRequested(branch)) {
				throw new Error(
					`The user named this session "${previous}"; leave it. If it no longer fits, you may suggest a new name to the user.`,
				);
			}

			const name = normalizeName(params.name);
			if (name.length < 3) throw new Error("Name is empty or too short");
			if (name === previous) {
				return {
					content: [{ type: "text", text: `Session is already named "${name}".` }],
					details: { previous, name } satisfies RenameDetails,
				};
			}

			rename(name);
			if (manual) pi.appendEntry<ManualEntryData>(MANUAL_ENTRY_TYPE, { manual: false });
			if (ctx.hasUI) ctx.ui.notify(`Session named: ${name}`, "info");
			return {
				content: [
					{
						type: "text",
						text: previous ? `Session renamed from "${previous}" to "${name}".` : `Session named "${name}".`,
					},
				],
				details: { previous, name } satisfies RenameDetails,
			};
		},
	});

	pi.registerCommand("auto-session-name", {
		description: "Ask the model to (re)name this session now (optional hint: /auto-session-name <hint>)",
		handler: async (args, ctx) => {
			if (!enabled) return;
			const hint = args.trim();
			const text =
				`The user asked you to name this session now: call \`${TOOL_NAME}\` with a name summarising the conversation so far, then stop.` +
				(hint ? ` Their hint: ${hint}` : "");
			pi.sendMessage(
				{ customType: REQUEST_MESSAGE_TYPE, content: text, display: false },
				{ triggerTurn: true, ...(ctx.isIdle() ? {} : { deliverAs: "followUp" as const }) },
			);
		},
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (!enabled) return;
		const branch = ctx.sessionManager.getBranch();
		if (isManuallyNamed(branch)) return;

		if (!isNudgePrompt(countPrompts(branch) + 1)) return;

		const name = pi.getSessionName();
		const action = name
			? `This session is named "${name}". If that no longer describes the topic, rename it`
			: "This session has no name yet. If the topic is clear, name it";
		return {
			message: {
				customType: NUDGE_MESSAGE_TYPE,
				content: `Session-naming reminder: ${action} with \`${TOOL_NAME}\`, alongside your normal work; otherwise ignore this.`,
				display: false,
				details: { name } satisfies NameMessageDetails,
			},
		};
	});

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		enabled = ctx.hasUI;
		if (!enabled) {
			// Sub-agents (and print/JSON mode) get their own extension instance; withdraw the tool there.
			pi.registerTool({
				name: TOOL_NAME,
				label: "Set session name",
				description: "Unavailable in this session.",
				parameters: Type.Object({}),
				exposure: "hidden",
				async execute() {
					throw new Error("Unavailable in this session");
				},
			});
			return;
		}

		const name = pi.getSessionName();
		if (name && lastAnnouncedName(ctx.sessionManager.getBranch()) !== name) {
			announce(name, `This session is currently named "${name}".`);
		}
	});

	pi.on("session_info_changed", (event) => {
		if (!enabled) return;
		if (event.name !== undefined && event.name === toolSetName) return;
		toolSetName = undefined;
		pi.appendEntry<ManualEntryData>(MANUAL_ENTRY_TYPE, { manual: event.name !== undefined });
		announce(
			event.name,
			event.name
				? `The user renamed this session to "${event.name}". Don't rename it with \`${TOOL_NAME}\`.`
				: `The user cleared the session name. You may name it again with \`${TOOL_NAME}\` when appropriate.`,
		);
	});
}
