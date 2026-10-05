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
 * - A name set by the user (e.g. `/name`) is left alone until the user clears it.
 * - The tool is hidden in sessions without a UI, such as sub-agents.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TOOL_NAME = "set_session_name";
const NAME_MESSAGE_TYPE = "session-name";
const MANUAL_ENTRY_TYPE = "session-name-manual";
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
			"Use a concise title (3 to 8 words) describing the concrete task or outcome.",
		promptGuidelines: [
			`Once you understand what this session is really about (not before a few exchanges), name it with \`${TOOL_NAME}\`. Later, rename it only if its focus has clearly and lastingly moved away from the current name; don't rename for detours. Do this quietly, alongside your normal work, without mentioning it unless asked.`,
			`Session names: 3 to 8 words, describing the concrete task or outcome; keep ticket ids, project names and technical terms; avoid generic titles like "Coding session"; no quotes or trailing punctuation.`,
		],
		parameters: Type.Object({
			name: Type.String({ description: "The new session name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const branch = ctx.sessionManager.getBranch();
			const previous = pi.getSessionName();

			if (previous && isManuallyNamed(branch)) {
				throw new Error(
					`The user named this session "${previous}"; leave it. If it no longer fits, you may suggest a new name to the user.`,
				);
			}

			if (hasRenamed(branch)) {
				const prompts = countPrompts(branch, isRenameResult);
				if (prompts < PROMPTS_BETWEEN_RENAMES) {
					throw new Error(
						`Renamed too recently (${prompts} of ${PROMPTS_BETWEEN_RENAMES} user prompts since); try again later if it still seems needed.`,
					);
				}
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
