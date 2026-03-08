import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createAgentSession,
	createEventBus,
	type AgentSession,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type {
	ConversationEntryView,
	ContextUsageView,
	ModelCatalogSummary,
	PiConfigSummary,
	ProjectSummary,
	SessionTreeNodeView,
	SessionStreamEvent,
	ToolActivityView,
} from "../../shared/models";
import { createPiReviewExtension } from "../../../../../packages/pi-review-extension/src/index";
import {
	PI_REVIEW_REPLY_EVENT,
	type ReviewReplyPayload,
} from "../../../../../packages/pi-review-extension/src/index";
import type { HostMessenger } from "../services/host-messenger";
import type { SettingsService } from "../services/settings-service";
import { appPaths } from "../services/app-paths";

const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

type RuntimeSessionRecord = {
	id: string;
	cwdPath: string;
	piSessionFile?: string;
	displayName: string;
	project: ProjectSummary;
	baseRef?: string;
	preferredModelProvider?: string;
	preferredModelId?: string;
};

type RuntimeHooks = {
	onStatusPatch: (
		sessionId: string,
		patch: {
			status?: string;
			modelLabel?: string;
			lastError?: string;
		},
	) => Promise<void>;
	onTurnStart: (
		sessionId: string,
		turnIndex: number,
		event: AgentSessionEvent,
	) => Promise<void>;
	onTurnEnd: (
		sessionId: string,
		turnIndex: number,
		event: AgentSessionEvent,
	) => Promise<void>;
};

type ManagedRuntime = {
	record: RuntimeSessionRecord;
	session: AgentSession;
	unsubscribe: () => void;
	resourceLoader: DefaultResourceLoader;
	toolActivity: ToolActivityView[];
	lastAssistantId?: string;
	lastMessageIndex?: number;
	nextTurnIndex?: number;
	/** Monotonic counter for stable entry IDs during streaming. */
	nextMessageEmitIndex: number;
};

export class PiRuntimeManager {
	private readonly runtimes = new Map<string, ManagedRuntime>();
	private readonly appliedEnvironmentOverrideKeys = new Set<string>();
	private readonly environmentOverrideBaselines = new Map<string, string | undefined>();
	private hooks?: RuntimeHooks;
	private reviewState?: {
		isFreezeActive(sessionId: string): boolean;
		getActiveRevisionId(sessionId: string): string | undefined;
		handleReviewReply(sessionId: string, payload: ReviewReplyPayload): Promise<void>;
		buildReviewMarkdown(reviewRoundId: string): string;
		getSessionIdByReviewRound(reviewRoundId: string): string | undefined;
	};

	constructor(
		private readonly messenger: HostMessenger,
		private readonly appSettings: SettingsService,
	) {}

	setHooks(hooks: RuntimeHooks) {
		this.hooks = hooks;
	}

	setReviewBridge(bridge: NonNullable<PiRuntimeManager["reviewState"]>) {
		this.reviewState = bridge;
	}

	private mapConversationMessage(
		sessionId: string,
		message: AgentSession["messages"][number],
		index: number,
		toolCallArgs?: Map<string, Record<string, unknown>>,
	): ConversationEntryView | null {
		if ("role" in message) {
			if (message.role === "user") {
				return {
					id: `${sessionId}-message-${index}`,
					sessionId,
					kind: "user",
					timestamp: message.timestamp,
					markdown:
						typeof message.content === "string"
							? message.content
							: message.content
									.filter((part) => part.type === "text")
									.map((part) => part.text)
									.join("\n"),
					status: "done",
					metadata: {},
				};
			}
			if (message.role === "assistant") {
				const markdown = message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
				const toolCalls = message.content
					.filter((part) => part.type === "toolCall")
					.map((part) => `- \`${part.name}\``)
					.join("\n");
				const isError = message.stopReason === "error";
				const errorDetail =
					isError && "errorMessage" in message && message.errorMessage
						? `**Error:** ${String(message.errorMessage)}`
						: "";
				const parts = [markdown, toolCalls, errorDetail].filter(Boolean);
				return {
					id: `${sessionId}-message-${index}`,
					sessionId,
					kind: "assistant",
					timestamp: message.timestamp,
					markdown: parts.join("\n\n"),
					status: isError ? "error" : "done",
					metadata: {
						model: `${message.provider}/${message.model}`,
						stopReason: message.stopReason,
					},
				};
			}
			if (message.role === "toolResult") {
				return {
					id: `${sessionId}-message-${index}`,
					sessionId,
					kind: "tool",
					timestamp: message.timestamp,
					markdown: message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n"),
					status: message.isError ? "error" : "done",
					toolName: message.toolName,
					toolInput: toolCallArgs?.get(message.toolCallId),
					metadata: {},
				};
			}
		}
		return null;
	}

	private emitStreamEvent(event: SessionStreamEvent) {
		this.messenger.sessionEvent(event);
	}

	private emitContextUsage(runtime: ManagedRuntime) {
		const usage = runtime.session.getContextUsage();
		if (!usage) return;
		this.emitStreamEvent({
			type: "context_usage",
			usage: {
				sessionId: runtime.record.id,
				tokens: usage.tokens,
				contextWindow: usage.contextWindow,
				percent: usage.percent,
			},
		});
	}

	getContextUsage(sessionId: string): ContextUsageView | undefined {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) return undefined;
		const usage = runtime.session.getContextUsage();
		if (!usage) return undefined;
		return {
			sessionId,
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent,
		};
	}

	private mapPiConfig(runtime: ManagedRuntime): PiConfigSummary {
		const models = runtime.session.modelRegistry.getAll();
		return {
			authConfigured: models.length > 0,
			availableModels: models.map(
				(model: { provider: string; id: string }) =>
					`${model.provider}/${model.id}`,
			),
			settingsPath: appPaths.sessionStoreDir,
		};
	}

	getPiConfigSummary(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) {
			return {
				authConfigured: false,
				availableModels: [],
				settingsPath: appPaths.sessionStoreDir,
			} satisfies PiConfigSummary;
		}
		return this.mapPiConfig(runtime);
	}

	private applyEnvironmentOverrides() {
		const { environmentOverrides } = this.appSettings.getAppSettings();
		const activeEntries = Object.entries(environmentOverrides).filter(
			([key, value]) => Boolean(key && value),
		);
		const activeKeys = new Set(activeEntries.map(([key]) => key));

		for (const key of this.appliedEnvironmentOverrideKeys) {
			if (activeKeys.has(key)) continue;
			const baselineValue = this.environmentOverrideBaselines.get(key);
			if (baselineValue === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = baselineValue;
			}
			this.environmentOverrideBaselines.delete(key);
		}

		this.appliedEnvironmentOverrideKeys.clear();
		for (const [key, value] of activeEntries) {
			if (!this.environmentOverrideBaselines.has(key)) {
				this.environmentOverrideBaselines.set(key, process.env[key]);
			}
			process.env[key] = value;
			this.appliedEnvironmentOverrideKeys.add(key);
		}
	}

	private applySessionModelOverrides(
		settingsManager: SettingsManager,
		record: Pick<RuntimeSessionRecord, "preferredModelProvider" | "preferredModelId">,
	) {
		if (!record.preferredModelProvider || !record.preferredModelId) return;
		settingsManager.applyOverrides({
			defaultProvider: record.preferredModelProvider,
			defaultModel: record.preferredModelId,
		});
	}

	getModelCatalog(cwdPath: string): ModelCatalogSummary {
		this.applyEnvironmentOverrides();
		const settingsManager = SettingsManager.create(cwdPath);
		const authStorage = AuthStorage.create();
		const modelRegistry = new ModelRegistry(authStorage);
		const models = modelRegistry
			.getAll()
			.slice()
			.sort((a, b) => {
				if (a.provider !== b.provider) {
					return a.provider.localeCompare(b.provider);
				}
				return a.id.localeCompare(b.id);
			});
		const availableSet = new Set(
			modelRegistry
				.getAvailable()
				.map((model) => `${model.provider}/${model.id}`),
		);
		const providers = Array.from(new Set(models.map((model) => model.provider))).sort(
			(a, b) => a.localeCompare(b),
		);
		const configuredProvider = settingsManager.getDefaultProvider();
		const activeProvider =
			configuredProvider && providers.includes(configuredProvider)
				? configuredProvider
				: providers[0];
		const configuredModelId = settingsManager.getDefaultModel();
		const activeModelId =
			activeProvider && configuredModelId
				? models.some(
						(model) =>
							model.provider === activeProvider && model.id === configuredModelId,
					)
					? configuredModelId
					: models.find((model) => model.provider === activeProvider)?.id
				: models.find((model) => model.provider === activeProvider)?.id;
		return {
			activeProvider,
			activeModelId,
			providers,
			models: models.map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				isAvailable: availableSet.has(`${model.provider}/${model.id}`),
			})),
		};
	}

	getToolActivity(sessionId: string) {
		return this.runtimes.get(sessionId)?.toolActivity ?? [];
	}

	getConversation(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) return [];
		const toolCallArgs = new Map<string, Record<string, unknown>>();
		for (const message of runtime.session.messages) {
			if ("role" in message && message.role === "assistant") {
				for (const part of message.content) {
					if (part.type === "toolCall") {
						toolCallArgs.set(part.id, part.arguments);
					}
				}
			}
		}
		return runtime.session.messages
			.map((message, index) =>
				this.mapConversationMessage(sessionId, message, index, toolCallArgs),
			)
			.filter((entry): entry is ConversationEntryView => Boolean(entry));
	}

	private truncate(value: string, max = 72) {
		return value.length > max ? `${value.slice(0, max - 3)}...` : value;
	}

	private textFromContent(content: unknown) {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.filter(
				(
					part,
				): part is {
					type: string;
					text?: string;
				} => typeof part === "object" && part !== null && "type" in part,
			)
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join(" ");
	}

	private summarizeSessionEntry(entry: { type: string } & Record<string, unknown>) {
		if (entry.type === "message") {
			const message =
				(entry.message as
					| {
							role?: string;
							content?: unknown;
							toolName?: string;
					  }
					| undefined) ?? {};
			if (message.role === "user") {
				return `User: ${this.truncate(this.textFromContent(message.content) || "Prompt")}`;
			}
			if (message.role === "assistant") {
				const text = this.textFromContent(message.content);
				return text
					? `Assistant: ${this.truncate(text)}`
					: "Assistant response";
			}
			if (message.role === "toolResult") {
				return `Tool result: ${message.toolName ?? "tool"}`;
			}
			return "Message";
		}
		if (entry.type === "custom_message") {
			return `Injected context: ${String(entry.customType ?? "custom")}`;
		}
		if (entry.type === "custom") {
			return `Entry: ${String(entry.customType ?? "custom")}`;
		}
		if (entry.type === "label") {
			return `Label: ${String(entry.label ?? "cleared")}`;
		}
		if (entry.type === "session_info") {
			return `Session name: ${String(entry.name ?? "updated")}`;
		}
		if (entry.type === "branch_summary") return "Branch summary";
		if (entry.type === "compaction") return "Compaction";
		if (entry.type === "model_change") {
			return `Model: ${String(entry.provider ?? "provider")}/${String(entry.modelId ?? "model")}`;
		}
		if (entry.type === "thinking_level_change") {
			return `Thinking: ${String(entry.thinkingLevel ?? "changed")}`;
		}
		return entry.type;
	}

	private mapSessionTreeNode(
		currentLeafId: string | null,
		node: {
			entry: {
				id: string;
				type: string;
				timestamp: string;
			} & Record<string, unknown>;
			label?: string;
			children: Array<{
				entry: {
					id: string;
					type: string;
					timestamp: string;
				} & Record<string, unknown>;
				label?: string;
				children: unknown[];
			}>;
		},
	): SessionTreeNodeView {
		return {
			id: node.entry.id,
			type: node.entry.type,
			timestamp: Date.parse(node.entry.timestamp) || Date.now(),
			label: node.label,
			summary: this.summarizeSessionEntry(node.entry),
			isCurrent: node.entry.id === currentLeafId,
			children: node.children.map((child) =>
				this.mapSessionTreeNode(
					currentLeafId,
					child as Parameters<PiRuntimeManager["mapSessionTreeNode"]>[1],
				),
			),
		};
	}

	getSessionTree(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) return [];
		const currentLeafId = runtime.session.sessionManager.getLeafId();
		return runtime.session.sessionManager
			.getTree()
			.map((node) =>
				this.mapSessionTreeNode(
					currentLeafId,
					node as unknown as Parameters<PiRuntimeManager["mapSessionTreeNode"]>[1],
				),
			);
	}

	getParentSessionPath(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		return runtime?.session.sessionManager.getHeader()?.parentSession;
	}

	private formatToolArgs(args: unknown) {
		try {
			return JSON.stringify(args);
		} catch {
			return String(args);
		}
	}

	private async bindRuntime(runtime: ManagedRuntime) {
		runtime.unsubscribe = runtime.session.subscribe(async (event) => {
			await this.handleEvent(runtime, event);
		});
	}

	private async handleEvent(runtime: ManagedRuntime, event: AgentSessionEvent) {
		if (event.type === "agent_start") {
			await this.hooks?.onStatusPatch(runtime.record.id, {
				status: "running",
				modelLabel: runtime.session.model
					? `${runtime.session.model.provider}/${runtime.session.model.id}`
					: undefined,
			});
			return;
		}
		if (event.type === "agent_end") {
			await this.hooks?.onStatusPatch(runtime.record.id, {
				status: "idle",
			});
			return;
		}
		if (event.type === "turn_start") {
			const turnEvent = event as AgentSessionEvent & { turnIndex?: number };
			const turnIndex = turnEvent.turnIndex ?? runtime.nextTurnIndex ?? 0;
			runtime.nextTurnIndex = turnIndex + 1;
			await this.hooks?.onTurnStart(
				runtime.record.id,
				turnIndex,
				event,
			);
			return;
		}
		if (event.type === "turn_end") {
			const turnEvent = event as AgentSessionEvent & { turnIndex?: number };
			const turnIndex = turnEvent.turnIndex ?? (runtime.nextTurnIndex ? runtime.nextTurnIndex - 1 : 0);
			await this.hooks?.onTurnEnd(
				runtime.record.id,
				turnIndex,
				event,
			);
			return;
		}
		if (event.type === "message_start") {
			const messageIndex = runtime.nextMessageEmitIndex++;
			const entry = this.mapConversationMessage(
				runtime.record.id,
				event.message,
				messageIndex,
			);
			if (!entry) return;
			if (entry.kind === "user") return;
			if (entry.kind === "assistant") {
				entry.status = "streaming";
				runtime.lastAssistantId = entry.id;
			}
			runtime.lastMessageIndex = messageIndex;
			this.emitStreamEvent({
				type: "message_upsert",
				entry,
			});
			return;
		}
		if (event.type === "message_update") {
			if (event.assistantMessageEvent.type === "text_delta" && runtime.lastAssistantId) {
				this.emitStreamEvent({
					type: "message_delta",
					sessionId: runtime.record.id,
					entryId: runtime.lastAssistantId,
					delta: event.assistantMessageEvent.delta,
				});
			}
			return;
		}
		if (event.type === "message_end") {
			const messageIndex = runtime.lastMessageIndex ?? runtime.nextMessageEmitIndex++;
			runtime.lastMessageIndex = undefined;
			const entry = this.mapConversationMessage(
				runtime.record.id,
				event.message,
				messageIndex,
			);
			if (!entry) return;
			if (entry.kind === "user") return;
			this.emitStreamEvent({
				type: "message_upsert",
				entry,
			});
			this.emitContextUsage(runtime);
			return;
		}
		if (event.type === "tool_execution_start") {
			const activity: ToolActivityView = {
				id: crypto.randomUUID(),
				sessionId: runtime.record.id,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				status: "started",
				argsSummary: this.formatToolArgs(event.args),
				timestamp: Date.now(),
			};
			runtime.toolActivity = [
				activity,
				...runtime.toolActivity.filter(
					(item) => item.toolCallId !== event.toolCallId,
				),
			].slice(0, 40);
			this.emitStreamEvent({
				type: "tool_activity",
				activity,
			});
			return;
		}
		if (event.type === "tool_execution_update") {
			const previous = runtime.toolActivity.find(
				(item) => item.toolCallId === event.toolCallId,
			);
			if (!previous) return;
			const next: ToolActivityView = {
				...previous,
				status: "streaming",
				outputSnippet: this.formatToolArgs(event.partialResult).slice(0, 240),
			};
			runtime.toolActivity = runtime.toolActivity.map((item) =>
				item.toolCallId === event.toolCallId ? next : item,
			);
			this.emitStreamEvent({
				type: "tool_activity",
				activity: next,
			});
			return;
		}
		if (event.type === "tool_execution_end") {
			const previous = runtime.toolActivity.find(
				(item) => item.toolCallId === event.toolCallId,
			);
			const next: ToolActivityView = previous
				? {
						...previous,
						status: event.isError ? "error" : "finished",
						outputSnippet: this.formatToolArgs(event.result).slice(0, 240),
					}
				: {
						id: crypto.randomUUID(),
						sessionId: runtime.record.id,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						status: event.isError ? "error" : "finished",
						argsSummary: "",
						outputSnippet: this.formatToolArgs(event.result).slice(0, 240),
						timestamp: Date.now(),
					};
			runtime.toolActivity = [
				next,
				...runtime.toolActivity.filter(
					(item) => item.toolCallId !== event.toolCallId,
				),
			].slice(0, 40);
			this.emitStreamEvent({
				type: "tool_activity",
				activity: next,
			});
			if (MUTATING_TOOLS.has(event.toolName) && !event.isError) {
				this.messenger.diffInvalidated({
					sessionId: runtime.record.id,
				});
			}
			return;
		}
		if ("errorMessage" in event && event.errorMessage) {
			this.emitStreamEvent({
				type: "error",
				sessionId: runtime.record.id,
				message: event.errorMessage,
			});
		}
	}

	async openSession(record: RuntimeSessionRecord) {
		const existing = this.runtimes.get(record.id);
		if (existing) return existing;
		const eventBus = createEventBus();
		eventBus.on(PI_REVIEW_REPLY_EVENT, async (payload) => {
			await this.reviewState?.handleReviewReply(
				record.id,
				payload as ReviewReplyPayload,
			);
		});
		const settingsManager = SettingsManager.create(record.cwdPath);
		this.applySessionModelOverrides(settingsManager, record);
		const resourceLoader = new DefaultResourceLoader({
			cwd: record.cwdPath,
			settingsManager,
			eventBus,
			extensionFactories: [
				createPiReviewExtension({
					sessionId: record.id,
					eventBus,
					isDiscussionFrozen: () =>
						this.reviewState?.isFreezeActive(record.id) ?? false,
					getActiveReviewRoundId: () =>
						this.reviewState?.getActiveRevisionId(record.id),
				}),
			],
		});
		await resourceLoader.reload();

		// Apply user-configured environment overrides (e.g. AWS_PROFILE, API keys)
		this.applyEnvironmentOverrides();

		const sessionManager = record.piSessionFile
			? SessionManager.open(record.piSessionFile, appPaths.sessionStoreDir)
			: SessionManager.create(record.cwdPath, appPaths.sessionStoreDir);
		const { session } = await createAgentSession({
			cwd: record.cwdPath,
			resourceLoader,
			sessionManager,
			settingsManager,
		});
		if (record.displayName) {
			session.setSessionName(record.displayName);
		}
		const runtime: ManagedRuntime = {
			record,
			session,
			resourceLoader,
			toolActivity: [],
			unsubscribe: () => undefined,
			nextMessageEmitIndex: session.messages.length,
		};
		await this.bindRuntime(runtime);
		this.runtimes.set(record.id, runtime);
		return runtime;
	}

	async createSession(record: RuntimeSessionRecord) {
		const runtime = await this.openSession(record);
		return runtime.session;
	}

	private emitUserMessage(runtime: ManagedRuntime, sessionId: string, text: string) {
		const userIndex = runtime.nextMessageEmitIndex++;
		this.emitStreamEvent({
			type: "message_upsert",
			entry: {
				id: `${sessionId}-message-${userIndex}`,
				sessionId,
				kind: "user",
				timestamp: Date.now(),
				markdown: text,
				status: "done",
				metadata: {},
			},
		});
	}

	async sendPrompt(sessionId: string, text: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) throw new Error("Session runtime not loaded.");
		this.emitUserMessage(runtime, sessionId, text);
		await runtime.session.prompt(text);
	}

	async steerSession(sessionId: string, text: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) throw new Error("Session runtime not loaded.");
		this.emitUserMessage(runtime, sessionId, text);
		await runtime.session.steer(text);
	}

	async followUpSession(sessionId: string, text: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) throw new Error("Session runtime not loaded.");
		this.emitUserMessage(runtime, sessionId, text);
		await runtime.session.followUp(text);
	}

	async abortSession(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) return;
		await runtime.session.abort();
	}

	async renameSession(sessionId: string, name: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) return;
		runtime.session.setSessionName(name);
	}

	private requireRuntime(sessionId: string) {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) throw new Error("Session runtime is not loaded.");
		return runtime;
	}

	async dispatchDiscussion(sessionId: string, reviewRoundId: string) {
		const runtime = this.requireRuntime(sessionId);
		const markdown = this.reviewState?.buildReviewMarkdown(reviewRoundId);
		if (!markdown) return;
		await runtime.session.sendCustomMessage(
			{
				customType: "pi-review-discussion",
				content: markdown,
				display: true,
				details: {
					reviewRoundId,
				},
			},
			{
				triggerTurn: true,
				deliverAs: runtime.session.isStreaming ? "followUp" : undefined,
			},
		);
	}

	async dispatchThreadReply(sessionId: string, reviewRoundId: string) {
		await this.dispatchDiscussion(sessionId, reviewRoundId);
	}

	async dispatchAddressThis(sessionId: string, _revisionId: string, prompt: string) {
		const runtime = this.requireRuntime(sessionId);
		await runtime.session.sendCustomMessage(
			{
				customType: "pi-review-address-this",
				content: prompt,
				display: false,
				details: {
					revisionId: _revisionId,
				},
			},
			{
				triggerTurn: true,
				deliverAs: runtime.session.isStreaming ? "followUp" : undefined,
			},
		);
	}
}
