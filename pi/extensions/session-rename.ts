/**
 * Session Rename Extension
 *
 * Gives the main model a `set_session_name` tool, so the session is named (and later
 * renamed) by the model that has the whole conversation in context, inside the normal
 * request rather than through a separate model call.
 *
 * Everything the model sees is kept cache-friendly: the tool and its guidelines are
 * static, and name changes reach the model only as messages appended to the transcript.
 *
 * - After a rename, the tool refuses further renames for a few more prompts.
 * - A name set by the user (e.g. `/name`) is left alone until the user clears it, or runs
 *   `/auto-session-name`, which asks the model to (re)name the session now.
 * - The tool is hidden in sessions without a UI, such as sub-agents.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TOOL_NAME = "set_session_name";
const NAME_MESSAGE_TYPE = "session-name";
const MANUAL_ENTRY_TYPE = "session-name-manual";
const REQUEST_MESSAGE_TYPE = "session-name-request";
const PROMPTS_BETWEEN_RENAMES = 5;
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

function countPrompts(branch: SessionEntry[], since?: (entry: SessionEntry) => boolean): number {
	let count = 0;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (since?.(entry)) break;
		if (isUserPrompt(entry)) count++;
	}
	return count;
}

function hasRenamed(branch: SessionEntry[]): boolean {
	return branch.some(isRenameResult);
}

function cooldownMessage(branch: SessionEntry[]): string | undefined {
	if (!hasRenamed(branch)) return undefined;
	const prompts = countPrompts(branch, isRenameResult);
	if (prompts >= PROMPTS_BETWEEN_RENAMES) return undefined;
	return `Renamed too recently (${prompts} of ${PROMPTS_BETWEEN_RENAMES} user prompts since)`;
}

function isRenameRequested(branch: SessionEntry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "custom_message" && entry.customType === REQUEST_MESSAGE_TYPE) return true;
		if (isRenameResult(entry) || isUserPrompt(entry)) return false;
	}
	return false;
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

function lastAnnouncedName(branch: SessionEntry[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "custom_message" && entry.customType === NAME_MESSAGE_TYPE) {
			return (entry.details as NameMessageDetails | undefined)?.name;
		}
		if (isRenameResult(entry) && entry.type === "message" && entry.message.role === "toolResult") {
			return (entry.message.details as RenameDetails | undefined)?.name;
		}
	}
	return undefined;
}

function normalizeName(raw: string): string {
	let name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	name = name.replace(/^["'“]+|["'”]+$/g, "").replace(/[.!?;:,]+$/u, "").trim();
	if (name.length > MAX_NAME_CHARS) name = name.slice(0, MAX_NAME_CHARS).replace(/\s+\S*$/, "").trim();
	return name;
}

export default function sessionRename(pi: ExtensionAPI) {
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

			const requested = isRenameRequested(branch);
			const manual = previous !== undefined && isManuallyNamed(branch);
			if (manual && !requested) {
				throw new Error(
					`The user named this session "${previous}"; leave it. If it no longer fits, you may suggest a new name to the user.`,
				);
			}

			const cooldown = cooldownMessage(branch);
			if (cooldown) throw new Error(`${cooldown}; try again later if it still seems needed.`);

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
			const cooldown = cooldownMessage(ctx.sessionManager.getBranch());
			if (cooldown) {
				ctx.ui.notify(`${cooldown}; not renaming yet.`, "warning");
				return;
			}

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
