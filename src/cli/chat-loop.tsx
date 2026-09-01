import { homedir } from "node:os";
import { Box, render, Text, useApp, useInput, usePaste, useStdin } from "ink";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type {
	SlashCommandDispatchResult,
	SlashCommandResult,
} from "../commands/command";
import { createDefaultCommandRegistry } from "../commands/create-command-registry";
import type {
	ConfigReloadedEvent,
	ConfigReloadFailedEvent,
	ContextCompactionCompletedEvent,
	ContextCompactionStartedEvent,
	RuntimeEventBus,
} from "../events";
import type { CreateAgentSessionResult } from "../runtime";
import {
	describeToolApproval,
	type ToolApprovalDescription,
} from "../tools/tool-approval-description";
import type {
	ToolApprovalDecision,
	ToolApprovalRequest,
	ToolApprover,
} from "../tools/tool-executor";
import {
	type CommandOption,
	filterCommands,
	findClosestCommand,
	toCommandOptions,
} from "../ui/command-popup";
import { ApprovalPane } from "../ui/components/approval-pane";
import { CommandPopup } from "../ui/components/command-popup";
import { Composer, type ComposerState } from "../ui/components/composer";
import { ContextMeter } from "../ui/components/context-meter";
import { Notice } from "../ui/components/notice";
import { StatusRow } from "../ui/components/status-row";
import { ToolRowView } from "../ui/components/tool-row-view";
import { TranscriptView } from "../ui/components/transcript-view";
import { describeUsage } from "../ui/context-meter";
import { isCommandQuery, resolveKeyMode, routeKey } from "../ui/key-router";
import { createTextInputState, textInputReducer } from "../ui/text-input";
import { createDefaultTheme } from "../ui/theme";
import {
	createRunningToolRow,
	createToolRow,
	type ToolRow,
	turnCancelledReason,
	userDenialReason,
} from "../ui/tool-row";
import {
	restoreTranscript,
	type TranscriptDraft,
	type TranscriptItem,
} from "../ui/transcript";
import { UiProvider } from "../ui/ui-context";
import { useTerminalSize } from "../ui/use-terminal-size";
import { useElapsedSeconds, useSpinner } from "../ui/use-ticker";
import { createLogger } from "../utils/logger";

const logger = createLogger("cli.chat-loop");
const quitArmedTimeoutMs = 3000;

type ChatAppProps = {
	eventBus: RuntimeEventBus;
	createSession: (
		approveToolCall: ToolApprover,
	) => Promise<CreateAgentSessionResult>;
};

type ApprovalState = {
	request: ToolApprovalRequest;
	model: ToolApprovalDescription;
	resolve: (decision: ToolApprovalDecision) => void;
};

export function formatSessionExitSummary(
	session: CreateAgentSessionResult | null,
): string | null {
	if (session === null) {
		return null;
	}

	return [
		"",
		"Resume this session with:",
		`  sonny chat --resume ${session.historySession.id}`,
	].join("\n");
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Home-relative paths keep the header on one row on a normal terminal. */
export function shortenPath(path: string, home: string): string {
	if (home.length > 0 && path === home) {
		return "~";
	}

	return home.length > 0 && path.startsWith(`${home}/`)
		? `~${path.slice(home.length)}`
		: path;
}

export function describeSessionHeader(
	session: CreateAgentSessionResult,
): Extract<TranscriptDraft, { kind: "header" }> {
	const toolSummary = `${plural(session.toolNames.length, "tool")} · ${plural(session.skills.length, "skill")}`;

	if (session.mode === "new") {
		return {
			kind: "header",
			glyph: "sonny",
			title: "Sonny",
			subtitle: `${session.model} · ${shortenPath(process.cwd(), homedir())}`,
			lines: [`${toolSummary} · new session`],
		};
	}

	const title =
		session.historySession.title === "Untitled session"
			? session.historySession.id
			: session.historySession.title;

	return {
		kind: "header",
		glyph: "resumed",
		title,
		subtitle: session.mode === "continue" ? "· latest" : "",
		lines: [
			`${plural(session.restoredMessageCount, "message")} restored · ${session.historySession.id}`,
			toolSummary,
		],
	};
}

export const compactToolName = "compact";

export function describeConfigReloaded(
	event: ConfigReloadedEvent,
): Extract<TranscriptDraft, { kind: "notice" }> {
	return {
		kind: "notice",
		tone: "info",
		title: "Configuration reloaded",
		lines: event.runtimeRebuilt
			? [
					`Runtime: ${event.model}`,
					`Tools: ${event.toolNames.join(", ") || "none"}`,
					`Revision: ${event.revision}`,
				]
			: ["Changes apply to future sessions.", `Revision: ${event.revision}`],
	};
}

export function describeConfigReloadFailed(
	event: ConfigReloadFailedEvent,
): Extract<TranscriptDraft, { kind: "notice" }> {
	return {
		kind: "notice",
		tone: "warn",
		title: "Configuration reload failed",
		lines: [
			`Continuing with revision ${event.retainedRevision}.`,
			event.error.message,
		],
	};
}

export function createConfigPollTick(
	reload: () => Promise<unknown>,
	onError: (error: unknown) => void,
): () => void {
	let inFlight = false;

	return () => {
		if (inFlight) {
			return;
		}

		inFlight = true;
		void reload()
			.catch(onError)
			.finally(() => {
				inFlight = false;
			});
	};
}

/** The row shown while compaction is running, before its outcome is known. */
export function describeCompactionStart(
	event: ContextCompactionStartedEvent,
): ToolRow {
	return {
		toolName: compactToolName,
		preview: event.forced
			? "summarising the conversation"
			: `at ${Math.round((event.tokenCount / Math.max(1, event.thresholdTokens)) * 100)}% of the compaction threshold`,
		duration: null,
		status: "running",
		result: null,
		detail: null,
	};
}

/** Formats what compaction did, keeping its branches distinct. */
export function describeCompaction(
	event: ContextCompactionCompletedEvent,
): ToolRow {
	const saved = event.tokenCountBefore - event.tokenCountAfter;
	const what =
		event.summaryCompactedMessageCount > 0
			? `summarised ${event.summaryCompactedMessageCount} messages`
			: `trimmed ${event.compactedToolResultCount} tool results`;

	return {
		toolName: compactToolName,
		preview: what,
		duration: `${(event.durationMs / 1000).toFixed(1)}s`,
		status: "ok",
		result: saved > 0 ? `−${saved.toLocaleString("en-US")} tokens` : null,
		detail: null,
	};
}

export function ChatApp({ eventBus, createSession }: ChatAppProps) {
	const { exit } = useApp();
	// Piped stdin cannot be put into raw mode; without this guard Ink throws
	// rather than degrading to a print-once run. Ink derives the flag from
	// `stdin.isTTY`, which is `undefined` rather than `false` off a TTY, and its
	// own `isActive === false` check would miss that — so coerce it here.
	const isInteractive = useStdin().isRawModeSupported === true;
	const layout = useTerminalSize();
	const theme = useMemo(() => createDefaultTheme(), []);
	const commandRegistry = useMemo(() => createDefaultCommandRegistry(), []);
	const commandOptions = useMemo<CommandOption[]>(
		() => toCommandOptions(commandRegistry.list()),
		[commandRegistry],
	);

	const [session, setSession] = useState<CreateAgentSessionResult | null>(null);
	const [startupError, setStartupError] = useState<string | null>(null);
	const [items, setItems] = useState<TranscriptItem[]>([]);
	const [input, dispatchInput] = useReducer(textInputReducer, undefined, () =>
		createTextInputState(),
	);
	const [isThinking, setIsThinking] = useState(false);
	const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
	const [approval, setApproval] = useState<ApprovalState | null>(null);
	const [runningTool, setRunningTool] = useState<ToolRow | null>(null);
	const [popupIndex, setPopupIndex] = useState(0);
	const [quitArmed, setQuitArmed] = useState(false);
	const [isCancelling, setIsCancelling] = useState(false);
	const [queue, setQueue] = useState<string[]>([]);
	const [sendError, setSendError] = useState<string | null>(null);
	// Commands can be slow too — `/compact` summarises the whole conversation.
	const [isRunningCommand, setIsRunningCommand] = useState(false);

	const isBusy = isThinking || isRunningCommand;

	// Aborting this is what actually stops a turn — the runtime cancels the
	// request in flight rather than the UI ignoring a reply it no longer wants.
	const turnAbortRef = useRef<AbortController | null>(null);
	// Set when a compaction row was printed, so `/compact` does not also repeat
	// itself as text.
	const compactionReportedRef = useRef(false);
	const configReloadReportedRef = useRef(false);
	const nextId = useRef(0);
	const elapsedSeconds = useElapsedSeconds(turnStartedAt);
	const spinnerFrame = useSpinner(
		isBusy && theme.animate,
		theme.glyphs.spinner,
	);

	const popupMatches = useMemo(
		() =>
			isCommandQuery(input.value)
				? filterCommands(commandOptions, input.value)
				: [],
		[commandOptions, input.value],
	);
	const isPopupOpen = popupMatches.length > 0;
	const mode = resolveKeyMode({
		hasApproval: approval !== null,
		isBusy,
		isPopupOpen,
	});

	const append = useCallback((entries: TranscriptDraft[]): void => {
		if (entries.length === 0) {
			return;
		}

		setItems((current) => [
			...current,
			...entries.map((entry) => {
				nextId.current += 1;

				return { ...entry, id: String(nextId.current) } as TranscriptItem;
			}),
		]);
	}, []);

	const appendNotice = useCallback(
		(tone: "info" | "warn" | "error", title: string | null, body: string) => {
			append([
				{
					kind: "notice",
					tone,
					title,
					lines: body.split("\n").filter((line) => line.length > 0),
				},
			]);
		},
		[append],
	);

	useEffect(() => {
		let cancelled = false;

		const approveToolCall: ToolApprover = (request) =>
			new Promise((resolve) => {
				// A cancelled turn declines everything still in flight rather than
				// asking you the same question once per queued tool call.
				if (turnAbortRef.current?.signal.aborted === true) {
					resolve({ approved: false, reason: turnCancelledReason });
					return;
				}

				logger.info("tool.approval.prompted", {
					toolName: request.toolName,
					parameters: request.parameters,
				});
				setApproval({
					request,
					model: describeToolApproval(request),
					resolve,
				});
			});

		void createSession(approveToolCall)
			.then((createdSession) => {
				if (cancelled) {
					return;
				}

				logger.info("ui.session.created");
				setSession(createdSession);
				append([describeSessionHeader(createdSession)]);

				if (createdSession.mode === "new") {
					return;
				}

				append([
					{ kind: "divider", label: "restored" },
					...restoreTranscript(createdSession.restoredMessages),
					{ kind: "divider", label: "live" },
				]);
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}

				const message = error instanceof Error ? error.message : String(error);
				logger.error("ui.session.create.failed", { error: message });
				setStartupError(message);
			});

		return () => {
			cancelled = true;
		};
	}, [createSession, append]);

	// The runtime reports what it is doing rather than the UI inferring it, so
	// the live region stays honest even for work this terminal did not start.
	useEffect(() => {
		if (session === null) {
			return;
		}

		const sessionId = session.historySession.id;

		return eventBus.subscribe((event) => {
			if (event.sessionId !== sessionId) {
				return;
			}

			switch (event.type) {
				case "turn.started":
					setTurnStartedAt(Date.parse(event.occurredAt));
					return;
				case "turn.completed":
				case "turn.failed":
				case "turn.cancelled":
					setTurnStartedAt(null);
					setRunningTool(null);
					return;
				case "tool.started":
					logger.info("tool.ui.started", {
						toolName: event.toolName,
						toolCallId: event.toolCallId,
					});
					setRunningTool(createRunningToolRow(event));
					return;
				case "tool.completed":
					logger.info("tool.ui.completed", {
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						status: event.status,
						durationMs: event.durationMs,
					});
					setRunningTool(null);
					append([{ kind: "tool", row: createToolRow(event) }]);
					return;
				case "context.compaction.started":
					setRunningTool(describeCompactionStart(event));
					return;
				case "context.compaction.completed":
					setRunningTool(null);

					// An unchanged context is not worth a row; `/compact` still says
					// so in words.
					if (event.changed) {
						compactionReportedRef.current = true;
						append([{ kind: "tool", row: describeCompaction(event) }]);
					}

					return;
				case "config.reloaded":
					if (event.source.kind === "cli") {
						configReloadReportedRef.current = true;
					}

					append([describeConfigReloaded(event)]);
					return;
				case "config.reload.failed":
					if (event.source.kind === "cli") {
						configReloadReportedRef.current = true;
					}

					append([describeConfigReloadFailed(event)]);
					return;
			}
		});
	}, [append, eventBus, session]);

	useEffect(() => {
		if (session === null) {
			return;
		}

		const poll = createConfigPollTick(
			() =>
				session.runtime.reloadConfiguration({
					source: { kind: "system", name: "config-poll" },
				}),
			(error) => {
				logger.error("config.poll.failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			},
		);
		const interval = setInterval(poll, 5_000);

		return () => clearInterval(interval);
	}, [session]);

	useEffect(() => {
		if (!quitArmed) {
			return;
		}

		const timer = setTimeout(() => setQuitArmed(false), quitArmedTimeoutMs);

		return () => clearTimeout(timer);
	}, [quitArmed]);

	const runTurn = useCallback(
		async (text: string): Promise<void> => {
			if (session === null) {
				logger.warn("ui.submit.ignored_session_not_ready", {
					messageLength: text.length,
				});
				return;
			}

			const abort = new AbortController();
			turnAbortRef.current = abort;

			append([{ kind: "user", text }]);
			setSendError(null);
			setIsThinking(true);
			setTurnStartedAt(Date.now());
			logger.info("ui.submit.started", { messageLength: text.length });

			try {
				const { content: response } = await session.runtime.runTurn({
					content: text,
					source: { kind: "cli" },
					signal: abort.signal,
				});

				logger.info("ui.submit.completed", { responseLength: response.length });
				append([{ kind: "answer", text: response }]);
			} catch (error) {
				// A cancelled turn rejects too, but you asked for that.
				if (abort.signal.aborted) {
					logger.info("ui.submit.cancelled");
					append([
						{
							kind: "notice",
							tone: "warn",
							title: "Turn cancelled",
							lines: ["Sonny stopped where it was. Nothing else was run."],
						},
					]);
					return;
				}

				const message = error instanceof Error ? error.message : String(error);
				logger.error("ui.submit.failed", { error: message });
				append([
					{
						kind: "notice",
						tone: "error",
						title: "Request failed",
						lines: [message],
					},
				]);
			} finally {
				setIsThinking(false);
				setIsCancelling(false);
				setTurnStartedAt(null);
				setRunningTool(null);
				turnAbortRef.current = null;
			}
		},
		[append, session],
	);

	const handleCommandResult = useCallback(
		async (name: string, result: SlashCommandResult): Promise<void> => {
			if (result.type === "exit") {
				if (result.content !== undefined && result.content.length > 0) {
					appendNotice("info", null, result.content);
				}

				exit();
				return;
			}

			if (result.type === "message") {
				// Compaction already printed its own row, in the same grammar as
				// every other slow thing; repeating it as text says it twice.
				if (name === "compact" && compactionReportedRef.current) {
					return;
				}

				if (name === "reload" && configReloadReportedRef.current) {
					return;
				}

				// `/context` is the one command whose answer is a picture, so the
				// meter is rendered instead of its text.
				if (name === "context" && session !== null) {
					append([
						{
							kind: "context",
							meter: describeUsage(
								session.runtime.getContextUsage({ kind: "cli" }),
							),
						},
					]);
					return;
				}

				appendNotice("info", null, result.content);
				return;
			}

			if (result.type === "submit") {
				if (result.notice !== undefined && result.notice.length > 0) {
					appendNotice("info", null, result.notice);
				}

				await runTurn(result.content);
				return;
			}

			await runTurn(result.input);
		},
		[append, appendNotice, exit, runTurn, session],
	);

	const submit = useCallback(
		async (raw: string): Promise<void> => {
			const text = raw.trim();

			if (text.length === 0 || session === null) {
				return;
			}

			if (["q", "quit", "exit"].includes(text.toLowerCase())) {
				exit();
				return;
			}

			compactionReportedRef.current = false;
			configReloadReportedRef.current = false;
			setIsRunningCommand(true);
			setTurnStartedAt(Date.now());

			let dispatched: SlashCommandDispatchResult;

			try {
				dispatched = await commandRegistry.dispatch(text, {
					historySession: session.historySession,
					skills: session.skills,
					getMessageCount: () => session.runtime.getMessageCount(),
					getContextUsage: () =>
						session.runtime.getContextUsage({ kind: "cli" }),
					compactContext: () =>
						session.runtime.compactContext({ source: { kind: "cli" } }),
					reloadConfiguration: () =>
						session.runtime.reloadConfiguration({
							force: true,
							source: { kind: "cli" },
						}),
				});
			} finally {
				// Commands never overlap a turn: the queue only drains once the
				// previous turn has finished.
				setIsRunningCommand(false);
				setRunningTool(null);
				setTurnStartedAt(null);
			}

			if (dispatched.handled) {
				await handleCommandResult(
					text.slice(1).split(/\s+/)[0] ?? "",
					dispatched.result,
				);
				return;
			}

			if (text.startsWith("/")) {
				const closest = findClosestCommand(commandOptions, text);

				appendNotice(
					"info",
					null,
					closest === null
						? `no command called ${text}`
						: `no command called ${text}\ndid you mean /${closest.name}?`,
				);
			}

			await runTurn(text);
		},
		[
			appendNotice,
			commandOptions,
			commandRegistry,
			exit,
			handleCommandResult,
			runTurn,
			session,
		],
	);

	// Anything typed while Sonny is busy sends itself once the turn ends.
	useEffect(() => {
		if (isThinking || queue.length === 0 || session === null) {
			return;
		}

		const [next, ...rest] = queue;
		setQueue(rest);

		if (next !== undefined) {
			void submit(next);
		}
	}, [isThinking, queue, session, submit]);

	const resolveApproval = useCallback(
		(decision: ToolApprovalDecision): void => {
			if (approval === null) {
				return;
			}

			logger.info(
				decision.approved
					? "tool.approval.ui.approved"
					: "tool.approval.ui.denied",
				{ toolName: approval.request.toolName },
			);
			approval.resolve(decision);
			setApproval(null);
		},
		[approval],
	);

	const cancelTurn = useCallback(() => {
		if (!isThinking) {
			return;
		}

		turnAbortRef.current?.abort();
		setIsCancelling(true);
		// A tool waiting on you would otherwise hold the turn open past the abort.
		resolveApproval({ approved: false, reason: turnCancelledReason });
	}, [isThinking, resolveApproval]);

	usePaste(
		(text) => {
			if (mode === "approval") {
				return;
			}

			dispatchInput({ type: "insert", text });
		},
		{ isActive: isInteractive },
	);

	useInput(
		(character, key) => {
			const intent = routeKey({ mode, input: character, key, quitArmed });

			switch (intent.type) {
				case "none":
					return;
				case "edit":
					setSendError(null);
					setQuitArmed(false);
					dispatchInput(intent.action);
					return;
				case "submit": {
					const text = input.value;
					dispatchInput({ type: "submitted" });

					if (text.trim().length === 0) {
						return;
					}

					if (isThinking) {
						setQueue((current) => [...current, text]);
						return;
					}

					void submit(text);
					return;
				}
				case "cancelTurn":
					cancelTurn();
					return;
				case "armQuit":
					setQuitArmed(true);
					return;
				case "quit":
					resolveApproval({ approved: false, reason: turnCancelledReason });
					exit();
					return;
				case "approve":
					resolveApproval({ approved: true });
					return;
				case "deny":
					resolveApproval({ approved: false, reason: userDenialReason });
					return;
				case "denyAndCancel":
					turnAbortRef.current?.abort();
					setIsCancelling(true);
					resolveApproval({ approved: false, reason: turnCancelledReason });
					return;
				case "popupClose":
					dispatchInput({ type: "clear" });
					setPopupIndex(0);
					return;
				case "popupMove": {
					const delta = intent.direction === "up" ? -1 : 1;
					setPopupIndex((current) =>
						Math.max(0, Math.min(popupMatches.length - 1, current + delta)),
					);
					return;
				}
				case "popupComplete": {
					const option = popupMatches[popupIndex];

					if (option !== undefined) {
						dispatchInput({ type: "set", value: `/${option.name} ` });
						setPopupIndex(0);
					}

					return;
				}
				case "popupRun": {
					const option = popupMatches[popupIndex];

					if (option === undefined) {
						return;
					}

					dispatchInput({ type: "submitted" });
					setPopupIndex(0);
					void submit(`/${option.name}`);
					return;
				}
			}
		},
		{ isActive: isInteractive },
	);

	const composerState: ComposerState =
		approval !== null
			? "paused"
			: sendError !== null
				? "error"
				: isBusy
					? "busy"
					: "ready";

	const statusLabel = (() => {
		if (isCancelling) {
			return "Cancelling";
		}

		return runningTool?.toolName === compactToolName ? "Compacting" : "Working";
	})();

	const hint = (() => {
		if (quitArmed) {
			return "ctrl-c again to quit · esc cancels this turn";
		}

		if (approval !== null) {
			return "paused · answer the prompt above";
		}

		if (isBusy) {
			return "typing queues · esc interrupts";
		}

		return layout.isNarrow
			? "⏎ send · / cmds"
			: "⏎ send · ⇧⏎ newline · / commands · ctrl-c quit";
	})();

	const meter =
		session === null || startupError !== null
			? null
			: (() => {
					try {
						return describeUsage(
							session.runtime.getContextUsage({ kind: "cli" }),
						);
					} catch {
						return null;
					}
				})();

	return (
		<UiProvider theme={theme} layout={layout}>
			<Box flexDirection="column" width="100%">
				<TranscriptView items={items} />

				{startupError === null ? null : (
					<Notice
						tone="error"
						title="Sonny couldn't start"
						lines={[
							startupError,
							"Start fresh with sonny chat, or pick a session with --resume.",
						]}
					/>
				)}

				{runningTool === null ? null : (
					<ToolRowView row={runningTool} spinnerFrame={spinnerFrame} />
				)}

				{isBusy ? (
					<StatusRow
						label={statusLabel}
						elapsedSeconds={elapsedSeconds}
						detail={
							runningTool === null
								? null
								: `${runningTool.toolName}  ${runningTool.preview}`
						}
						spinnerFrame={spinnerFrame}
					/>
				) : null}

				{isPopupOpen ? (
					<CommandPopup
						options={popupMatches}
						selectedIndex={Math.min(popupIndex, popupMatches.length - 1)}
					/>
				) : null}

				{approval === null ? null : <ApprovalPane approval={approval.model} />}

				<Composer
					state={composerState}
					input={input}
					placeholder={
						session === null && startupError === null
							? "Starting Sonny…"
							: "Ask Sonny…"
					}
					hint={hint}
					message={
						sendError === null
							? null
							: { text: `send failed · ${sendError}`, tone: "error" }
					}
					right={
						meter === null || layout.isNarrow ? undefined : (
							<Text>
								<Text color={theme.dim}>ctx </Text>
								<ContextMeter meter={meter} />
								<Text> </Text>
							</Text>
						)
					}
				/>
			</Box>
		</UiProvider>
	);
}

export class ChatLoop {
	constructor(
		private readonly eventBus: RuntimeEventBus,
		private readonly createSession: (
			approveToolCall: ToolApprover,
		) => Promise<CreateAgentSessionResult>,
	) {}

	async run(): Promise<void> {
		let createdSession: CreateAgentSessionResult | null = null;
		const app = render(
			<ChatApp
				eventBus={this.eventBus}
				createSession={async (approveToolCall) => {
					const session = await this.createSession(approveToolCall);
					createdSession = session;
					return session;
				}}
			/>,
		);
		await app.waitUntilExit();

		const exitSummary = formatSessionExitSummary(createdSession);

		if (exitSummary !== null) {
			console.log(exitSummary);
		}
	}
}
