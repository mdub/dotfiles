/**
 * bash-box — oh-my-pi-style rounded boxes around bash tool calls.
 *
 *   ╭──────────────────────────────────────────────────────────╮
 *   │ $ git log -1 --oneline && echo "---"                      │
 *   ├── Output ────────────────────────────────────────────────┤
 *   │ d8d2e21 note: address comments                            │
 *   │ (Wall: 0.13s | Timeout: 300s)                             │
 *   ╰──────────────────────────────────────────────────────────╯
 *
 * Uses the documented renderer API only — `renderShell: "self"` plus
 * `renderCall`/`renderResult` (docs/extensions.md "Custom Rendering"), with
 * execution delegated to pi's real bash tool. No pi internals are patched.
 *
 * The frame spans both render slots: renderCall draws the top and the command,
 * renderResult draws the divider, output and the bottom. Before execution
 * starts there is no result slot yet, so renderCall closes the box itself.
 *
 * Settings (`~/.pi/agent/settings.json`):
 *   { "bashBox": { "enabled": true, "border": "rounded", "previewLines": 12 } }
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createBashToolDefinition, keyHint } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ─────────────────────────────────────────────────────────────────────────────
// Box drawing
// ─────────────────────────────────────────────────────────────────────────────

interface BorderSet {
	tl: string;
	tr: string;
	bl: string;
	br: string;
	h: string;
	v: string;
	teeL: string;
	teeR: string;
}

const BORDERS: Record<string, BorderSet> = {
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", teeL: "├", teeR: "┤" },
	sharp: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", teeL: "├", teeR: "┤" },
	ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", teeL: "+", teeR: "+" },
};

const MIN_WIDTH = 8;
const DEFAULT_PREVIEW_LINES = 12;

type ThemeLike = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

/** Inner width available for content between the two vertical borders and padding. */
function innerWidth(width: number): number {
	return Math.max(1, width - 4);
}

function edge(b: BorderSet, left: string, right: string, width: number, paint: (s: string) => string): string {
	return paint(`${left}${b.h.repeat(Math.max(0, width - 2))}${right}`);
}

/** `├── Output ─────┤` — a labelled divider. */
function divider(b: BorderSet, label: string, width: number, paint: (s: string) => string, labelPaint: (s: string) => string): string {
	const lead = `${b.teeL}${b.h.repeat(2)} `;
	const tail = ` ${b.h.repeat(Math.max(0, width - visibleWidth(lead) - label.length - 2))}${b.teeR}`;
	return `${paint(lead)}${labelPaint(label)}${paint(tail)}`;
}

/** Wrap `text` to the box interior and pad each row out to the right border. */
function bodyRows(b: BorderSet, text: string, width: number, paint: (s: string) => string): string[] {
	const inner = innerWidth(width);
	const rows: string[] = [];
	for (const rawLine of text.split("\n")) {
		const wrapped = rawLine === "" ? [""] : wrapTextWithAnsi(rawLine, inner);
		for (const line of wrapped) {
			const clipped = visibleWidth(line) > inner ? truncateToWidth(line, inner) : line;
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			rows.push(`${paint(b.v)} ${clipped}${pad} ${paint(b.v)}`);
		}
	}
	return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

interface BashBoxConfig {
	enabled: boolean;
	border: string;
	previewLines: number;
}

/** The extension API has no settings accessor, so read the agent settings file. */
function readConfig(): BashBoxConfig {
	let raw: Partial<BashBoxConfig> = {};
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || "/tmp", ".pi", "agent");
		raw = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf-8"))?.bashBox ?? {};
	} catch {
		raw = {};
	}
	return {
		enabled: raw.enabled !== false,
		border: typeof raw.border === "string" && raw.border in BORDERS ? raw.border : "rounded",
		previewLines: typeof raw.previewLines === "number" && raw.previewLines > 0 ? raw.previewLines : DEFAULT_PREVIEW_LINES,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

interface RenderState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

function formatElapsed(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/** Plain-text output of a tool result, mirroring pi's own bash renderer. */
function textOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (result.content ?? [])
		.filter(part => part.type === "text")
		.map(part => part.text ?? "")
		.join("")
		.trim();
}

export default function (pi: ExtensionAPI) {
	const config = readConfig();
	if (!config.enabled) return;

	const b = BORDERS[config.border] ?? BORDERS.rounded;
	const definition = createBashToolDefinition(process.cwd()) as any;

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: definition.description,
		// Prompt metadata is not inherited by an override — copy it explicitly
		// (docs/extensions.md: "Prompt metadata").
		...(definition.promptSnippet ? { promptSnippet: definition.promptSnippet } : {}),
		...(definition.promptGuidelines ? { promptGuidelines: definition.promptGuidelines } : {}),
		parameters: definition.parameters,
		...(definition.prepareArguments ? { prepareArguments: definition.prepareArguments } : {}),
		...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
		renderShell: "self",

		async execute(toolCallId: any, params: any, signal: any, onUpdate: any, ctx: any) {
			return definition.execute(toolCallId, params, signal, onUpdate, ctx);
		},

		renderCall(args: any, theme: ThemeLike, context: any) {
			const state = context.state as RenderState;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}

			const border = (s: string) => theme.fg(context.isError ? "error" : "border", s);
			const command = typeof args?.command === "string" ? args.command : "...";
			const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
			const prompt = theme.fg("accent", "$ ");
			const body = prompt + theme.fg("toolTitle", theme.bold(command));

			return {
				invalidate() {},
				render(width: number): string[] {
					const w = Math.max(MIN_WIDTH, width);
					const lines = [edge(b, b.tl, b.tr, w, border), ...bodyRows(b, body, w, border)];
					// No result slot exists until execution starts, so close the box
					// here to avoid leaving it hanging open.
					if (!context.executionStarted) {
						lines.push(edge(b, b.bl, b.br, w, border));
					}
					void timeout;
					return lines;
				},
			};
		},

		renderResult(result: any, options: any, theme: ThemeLike, context: any) {
			const state = context.state as RenderState;

			// Tick once a second while running so the elapsed timer advances.
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}

			const isError = context.isError || options.isPartial === false ? context.isError : false;
			const border = (s: string) => theme.fg(isError ? "error" : "border", s);
			const output = textOutput(result);
			const truncation = result.details?.truncation;
			const fullOutputPath = result.details?.fullOutputPath;
			const timeout = typeof context.args?.timeout === "number" ? context.args.timeout : undefined;

			return {
				invalidate() {},
				render(width: number): string[] {
					const w = Math.max(MIN_WIDTH, width);
					const lines: string[] = [];

					if (output) {
						const label = options.isPartial ? "Output…" : "Output";
						lines.push(divider(b, label, w, border, s => theme.fg("muted", s)));

						const all = output.split("\n");
						const show = options.expanded ? all : all.slice(-config.previewLines);
						const hidden = all.length - show.length;
						if (hidden > 0) {
							const hint = theme.fg("muted", `… ${hidden} earlier lines, `) + keyHint("app.tools.expand", "to expand");
							lines.push(...bodyRows(b, hint, w, border));
						}
						lines.push(...bodyRows(b, show.map(l => theme.fg("toolOutput", l)).join("\n"), w, border));
					}

					const notes: string[] = [];
					if (fullOutputPath) notes.push(`Full output: ${fullOutputPath}`);
					if (truncation?.truncated) {
						notes.push(
							truncation.truncatedBy === "lines"
								? `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`
								: `Truncated: ${truncation.outputLines} lines shown`,
						);
					}
					if (notes.length) {
						lines.push(...bodyRows(b, theme.fg("warning", `[${notes.join(". ")}]`), w, border));
					}

					// Footer: wall time (live while running) and the effective timeout.
					if (state.startedAt !== undefined) {
						const end = state.endedAt ?? Date.now();
						const parts = [`${options.isPartial ? "Elapsed" : "Wall"}: ${formatElapsed(end - state.startedAt)}`];
						if (timeout) parts.push(`Timeout: ${timeout}s`);
						lines.push(...bodyRows(b, theme.fg("dim", `(${parts.join(" | ")})`), w, border));
					}

					lines.push(edge(b, b.bl, b.br, w, border));
					return lines;
				},
			};
		},
	});
}
