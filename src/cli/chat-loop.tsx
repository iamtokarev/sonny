import { Box, render, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlashCommandResult } from "../commands/command";
import { createDefaultCommandRegistry } from "../commands/create-command-registry";
import type { CreateAgentSessionResult } from "../core/create-agent-session";
import type { ChatMessage, ToolCall } from "../core/message";
import type {
	ToolApprovalDecision,
	ToolApprovalRequest,
	ToolApprover,
	ToolEventHandler,
} from "../tools/tool-executor";
import { createLogger } from "../utils/logger";
import {
	formatCompletedToolMessage,
	formatToolPreview,
	formatToolResultPreview,
} from "./tool-display";

const logger = createLogger("cli.chat-loop");

type UiMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "error";
	content: string;
};

type ChatAppProps = {
	createSession: (
		approveToolCall: ToolApprover,
		onToolEvent: ToolEventHandler,
	) => Promise<CreateAgentSessionResult>;
};

type ApprovalState = {
	request: ToolApprovalRequest;
	resolve: (decision: ToolApprovalDecision) => void;
};

type RestoredUiMessage = Omit<UiMessage, "id">;

function formatParameters(parameters: unknown): string {
	try {
		return JSON.stringify(parameters, null, 2);
	} catch {
		return String(parameters);
	}
}

export function formatSessionStartupMessage(
	session: CreateAgentSessionResult,
): string | null {
	if (session.mode === "new") {
		return null;
	}

	const title =
		session.historySession.title === "Untitled session"
			? session.historySession.id
			: session.historySession.title;

	return `↻ Resumed ${title} (${session.restoredMessageCount} messages)`;
}

function looksLikeToolError(content: string): boolean {
	return (
		content.startsWith("BLOCKED:") ||
		content.startsWith("ERROR:") ||
		content.startsWith("Tool execution failed:")
	);
}

function formatRestoredToolMessage(
	toolCall: ToolCall | undefined,
	content: string,
): string {
	if (toolCall === undefined) {
		return "tool";
	}

	const ok = !looksLikeToolError(content);
	const resultPreview = formatToolResultPreview(toolCall.name, content, ok);

	return [
		toolCall.name,
		formatToolPreview(toolCall.name, toolCall.parameters),
		resultPreview,
	]
		.filter(Boolean)
		.join("  ");
}

export function createRestoredUiMessages(
	messages: ChatMessage[],
): RestoredUiMessage[] {
	const toolCallsById = new Map<string, ToolCall>();
	const restoredMessages: RestoredUiMessage[] = [];

	for (const message of messages) {
		if (message.role === "system") {
			continue;
		}

		if (message.role === "user") {
			restoredMessages.push({
				role: "user",
				content: message.content,
			});
			continue;
		}

		if (message.role === "assistant") {
			for (const toolCall of message.toolCalls ?? []) {
				toolCallsById.set(toolCall.id, toolCall);
			}

			if (message.content.trim().length === 0) {
				continue;
			}

			restoredMessages.push({
				role: "assistant",
				content: message.content,
			});
			continue;
		}

		restoredMessages.push({
			role: "tool",
			content: formatRestoredToolMessage(
				toolCallsById.get(message.toolCallId),
				message.content,
			),
		});
	}

	return restoredMessages;
}

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

function ChatApp({ createSession }: ChatAppProps) {
	const { exit } = useApp();
	const commandRegistry = useMemo(() => createDefaultCommandRegistry(), []);
	const [session, setSession] = useState<CreateAgentSessionResult | null>(null);
	const [startupError, setStartupError] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<UiMessage[]>([]);
	const [isThinking, setIsThinking] = useState(false);
	const [approval, setApproval] = useState<ApprovalState | null>(null);
	const [currentTool, setCurrentTool] = useState<{
		toolName: string;
		preview: string;
	} | null>(null);
	const nextMessageId = useRef(0);

	const createMessage = useCallback(
		(role: UiMessage["role"], content: string): UiMessage => {
			nextMessageId.current += 1;

			return {
				id: String(nextMessageId.current),
				role,
				content,
			};
		},
		[],
	);

	async function handleCommandResult(
		result: SlashCommandResult,
	): Promise<void> {
		if (result.type === "message") {
			setMessages((items) => [
				...items,
				createMessage("system", result.content),
			]);
			return;
		}

		if (result.type === "exit") {
			if (result.content !== undefined && result.content.length > 0) {
				setMessages((items) => [
					...items,
					createMessage("system", result.content ?? ""),
				]);
			}
			exit();
			return;
		}

		if (result.type === "submit") {
			if (result.notice !== undefined && result.notice.length > 0) {
				setMessages((items) => [
					...items,
					createMessage("system", result.notice ?? ""),
				]);
			}
			await submit(result.content);
			return;
		}

		await submit(result.input);
	}

	useEffect(() => {
		let cancelled = false;

		const approveToolCall: ToolApprover = (request) =>
			new Promise((resolve) => {
				logger.info("tool.approval.prompted", {
					toolName: request.toolName,
					parameters: request.parameters,
				});
				setApproval({ request, resolve });
			});

		const onToolEvent: ToolEventHandler = (event) => {
			if (cancelled) {
				return;
			}

			if (event.type === "tool.started") {
				logger.info("tool.ui.started", {
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					preview: event.preview,
				});
				setCurrentTool({
					toolName: event.toolName,
					preview: event.preview,
				});
				return;
			}

			logger.info("tool.ui.completed", {
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				ok: event.ok,
				durationMs: event.durationMs,
			});
			setCurrentTool(null);
			setMessages((items) => [
				...items,
				createMessage("tool", formatCompletedToolMessage(event)),
			]);
		};

		void createSession(approveToolCall, onToolEvent)
			.then((createdSession) => {
				if (!cancelled) {
					logger.info("ui.session.created");
					setSession(createdSession);
					const startupMessage = formatSessionStartupMessage(createdSession);

					if (startupMessage !== null) {
						setMessages((items) => [
							...items,
							createMessage("system", startupMessage),
							...createRestoredUiMessages(createdSession.restoredMessages).map(
								(message) => createMessage(message.role, message.content),
							),
						]);
					}
				}
			})
			.catch((error) => {
				if (!cancelled) {
					logger.error("ui.session.create.failed", {
						error: error instanceof Error ? error.message : String(error),
					});
					setStartupError(
						error instanceof Error ? error.message : String(error),
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [createSession, createMessage]);

	async function submit(rawInput: string): Promise<void> {
		const text = rawInput.trim();

		if (!text || isThinking) {
			return;
		}

		if (session === null) {
			logger.warn("ui.submit.ignored_session_not_ready", {
				messageLength: text.length,
			});
			return;
		}

		if (["q", "quit", "exit"].includes(text.toLowerCase())) {
			exit();
			return;
		}

		const commandResult = await commandRegistry.dispatch(text, {
			historySession: session.historySession,
			skills: session.skills,
			getMessageCount: () => session.session.getMessageCount(),
			getContextUsage: () => session.session.getContextUsage(),
			compactContext: () => session.session.compactContext(),
		});

		if (commandResult.handled) {
			setInput("");
			await handleCommandResult(commandResult.result);
			return;
		}

		setInput("");
		setMessages((items) => [...items, createMessage("user", text)]);
		setIsThinking(true);
		logger.info("ui.submit.started", {
			messageLength: text.length,
		});

		try {
			const response = await session.session.chat(text);
			logger.info("ui.submit.completed", {
				responseLength: response.length,
			});
			setMessages((items) => [...items, createMessage("assistant", response)]);
		} catch (error) {
			logger.error("ui.submit.failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			setMessages((items) => [
				...items,
				createMessage(
					"error",
					error instanceof Error ? error.message : String(error),
				),
			]);
		} finally {
			setIsThinking(false);
		}
	}

	function resolveApproval(decision: ToolApprovalDecision): void {
		if (approval === null) {
			return;
		}

		logger.info(
			decision.approved
				? "tool.approval.ui.approved"
				: "tool.approval.ui.denied",
			{
				toolName: approval.request.toolName,
				reason: decision.approved ? undefined : decision.reason,
			},
		);
		approval.resolve(decision);
		setApproval(null);
	}

	useInput((character, key) => {
		if (key.ctrl && character === "c") {
			resolveApproval({
				approved: false,
				reason: "Tool call cancelled by user.",
			});
			exit();
			return;
		}

		if (approval !== null) {
			const answer = character.toLowerCase();

			if (answer === "y") {
				resolveApproval({ approved: true });
				return;
			}

			if (answer === "n" || key.escape) {
				resolveApproval({
					approved: false,
					reason: "Tool call denied by user.",
				});
				return;
			}

			return;
		}

		if (key.return) {
			void submit(input);
			return;
		}

		if (isThinking) {
			return;
		}

		if (key.backspace) {
			setInput((value) => value.slice(0, -1));
			return;
		}

		if (character) {
			setInput((value) => value + character);
		}
	});

	return (
		<Box flexDirection="column" width="100%" gap={1}>
			<Box width="100%" justifyContent="space-between">
				<Text>
					<Text color="green" bold>
						Sonny
					</Text>{" "}
					<Text dimColor>chat</Text>
				</Text>
				<Text dimColor>q / quit / exit</Text>
			</Box>

			<Box width="100%" borderStyle="single" borderColor="gray" />

			<Box flexDirection="column" width="100%" minHeight={3}>
				{startupError !== null ? (
					<Text color="red">! {startupError}</Text>
				) : messages.length === 0 ? (
					<Text dimColor>
						{session === null
							? "Starting Sonny..."
							: "Ask a question, describe a task, or paste context below."}
					</Text>
				) : (
					messages.map((message) => (
						<Text key={message.id}>
							{message.role === "assistant" ? (
								<>
									<Text color="green" bold>
										●{" "}
									</Text>
									{message.content}
								</>
							) : null}
							{message.role === "user" ? (
								<Text dimColor>{message.content}</Text>
							) : null}
							{message.role === "system" ? (
								<Text dimColor>{message.content}</Text>
							) : null}
							{message.role === "error" ? (
								<>
									<Text color="red" bold>
										!{" "}
									</Text>
									{message.content}
								</>
							) : null}
							{message.role === "tool" ? (
								<Text dimColor>┊ {message.content}</Text>
							) : null}
						</Text>
					))
				)}
			</Box>

			{approval !== null ? (
				<Box
					flexDirection="column"
					width="100%"
					borderStyle="round"
					borderColor="yellow"
					paddingX={1}
				>
					<Text color="yellow" bold>
						Tool approval required
					</Text>
					<Text>
						<Text bold>{approval.request.toolName}</Text>{" "}
						<Text dimColor>{approval.request.description}</Text>
					</Text>
					<Text dimColor>{formatParameters(approval.request.parameters)}</Text>
					<Text>
						<Text color="green">y</Text>
						<Text dimColor> approve </Text>
						<Text color="red">n</Text>
						<Text dimColor> deny</Text>
					</Text>
				</Box>
			) : null}

			{isThinking ? (
				<Text>
					<Text color="green" bold>
						●
					</Text>{" "}
					<Text dimColor>
						{currentTool === null
							? "Thinking..."
							: `${currentTool.toolName} ${currentTool.preview}`}
					</Text>
				</Text>
			) : null}

			<Box width="100%" borderStyle="round" borderColor="gray" paddingX={1}>
				<Text color="green" bold>
					›{" "}
				</Text>
				<Box flexGrow={1}>
					<Text>
						{input ? input : <Text dimColor>Ask Sonny...</Text>}
						{isThinking ? null : <Text color="green">▌</Text>}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

export class ChatLoop {
	constructor(
		private readonly createSession: (
			approveToolCall: ToolApprover,
			onToolEvent: ToolEventHandler,
		) => Promise<CreateAgentSessionResult>,
	) {}

	async run(): Promise<void> {
		let createdSession: CreateAgentSessionResult | null = null;
		const app = render(
			<ChatApp
				createSession={async (approveToolCall, onToolEvent) => {
					const session = await this.createSession(
						approveToolCall,
						onToolEvent,
					);
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
