import { Box, render, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { AgentSession } from "../core/agent-session";
import type {
	ToolApprovalDecision,
	ToolApprovalRequest,
	ToolApprover,
} from "../tools/tool-executor";
import { createLogger } from "../utils/logger";

const logger = createLogger("cli.chat-loop");

type UiMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
};

type ChatAppProps = {
	createSession: (approveToolCall: ToolApprover) => Promise<AgentSession>;
};

type ApprovalState = {
	request: ToolApprovalRequest;
	resolve: (decision: ToolApprovalDecision) => void;
};

function formatParameters(parameters: unknown): string {
	try {
		return JSON.stringify(parameters, null, 2);
	} catch {
		return String(parameters);
	}
}

function ChatApp({ createSession }: ChatAppProps) {
	const { exit } = useApp();
	const [session, setSession] = useState<AgentSession | null>(null);
	const [startupError, setStartupError] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<UiMessage[]>([]);
	const [isThinking, setIsThinking] = useState(false);
	const [approval, setApproval] = useState<ApprovalState | null>(null);
	const nextMessageId = useRef(0);

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

		void createSession(approveToolCall)
			.then((createdSession) => {
				if (!cancelled) {
					logger.info("ui.session.created");
					setSession(createdSession);
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
	}, [createSession]);

	function createMessage(role: UiMessage["role"], content: string): UiMessage {
		nextMessageId.current += 1;

		return {
			id: String(nextMessageId.current),
			role,
			content,
		};
	}

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

		setInput("");
		setMessages((items) => [...items, createMessage("user", text)]);
		setIsThinking(true);
		logger.info("ui.submit.started", {
			messageLength: text.length,
		});

		try {
			const response = await session.chat(text);
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
					"system",
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
								<Text color="green" bold>
									●{" "}
								</Text>
							) : null}
							{message.role === "system" ? (
								<Text color="red" bold>
									!{" "}
								</Text>
							) : null}
							<Text dimColor={message.role === "user"}>{message.content}</Text>
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
					<Text dimColor>Thinking...</Text>
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
		) => Promise<AgentSession>,
	) {}

	async run(): Promise<void> {
		const app = render(<ChatApp createSession={this.createSession} />);
		await app.waitUntilExit();
	}
}
