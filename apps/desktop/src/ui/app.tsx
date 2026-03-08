import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ContextUsageView,
	ModelCatalogSummary,
	SessionHydration,
	SessionSummary,
	ToastMessage,
} from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";
import { useConversationStore } from "@ui/stores/conversation-store";
import { useLayoutStore } from "@ui/stores/layout-store";
import { useProjectsStore } from "@ui/stores/projects-store";
import { useReviewStore } from "@ui/stores/review-store";
import { useSessionsStore } from "@ui/stores/sessions-store";
import { useSettingsStore } from "@ui/stores/settings-store";
import { useTerminalStore } from "@ui/stores/terminal-store";
import { TitleBar } from "./components/shell/title-bar";
import { Sidebar } from "./components/sidebar/sidebar";
import { ConversationPane } from "./components/chat/conversation-pane";
import { DiffPane } from "./components/diff/diff-pane";
import { TerminalDrawer } from "./components/terminal/terminal-drawer";
import { SettingsDialog } from "./components/settings/settings-dialog";
import { ProjectSettingsDialog } from "./components/settings/project-settings-dialog";
import { NewSessionDialog } from "./components/shared/new-session-dialog";
import { PromptDialog } from "./components/shared/prompt-dialog";
import { PerfOverlay } from "./components/shell/perf-overlay";

function ResizeHandle(props: {
	onDrag: (delta: number) => void;
}) {
	const onDragRef = useRef(props.onDrag);
	onDragRef.current = props.onDrag;

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		let lastX = e.clientX;
		const onMouseMove = (ev: MouseEvent) => {
			const delta = ev.clientX - lastX;
			lastX = ev.clientX;
			onDragRef.current(delta);
		};
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	return (
		<div
			onMouseDown={onMouseDown}
			className="group relative z-20 w-0 cursor-col-resize"
		>
			<div className="absolute inset-y-0 -left-[2px] w-[4px] bg-transparent transition group-hover:bg-accent/30 group-active:bg-accent/50" />
		</div>
	);
}

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

function ContextUsageBar({ usage }: { usage: ContextUsageView }) {
	const percent = usage.percent ?? 0;
	const barColor =
		percent >= 90
			? "bg-state-error"
			: percent >= 75
				? "bg-state-review"
				: "bg-accent";
	const label =
		usage.tokens !== null
			? `${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} (${Math.round(percent)}%)`
			: `${formatTokenCount(usage.contextWindow)} context`;

	return (
		<div className="flex items-center gap-1.5" title={`Context: ${label}`}>
			<div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
				<div
					className={`h-full rounded-full transition-all duration-300 ${barColor}`}
					style={{ width: `${Math.min(percent, 100)}%` }}
				/>
			</div>
			<span className="text-2xs text-white/30">{label}</span>
		</div>
	);
}

export function App() {
	const projects = useProjectsStore((state) => state.projects);
	const selectedProjectId = useProjectsStore((state) => state.selectedProjectId);
	const loadProjects = useProjectsStore((state) => state.loadProjects);
	const addProject = useProjectsStore((state) => state.addProject);
	const removeProject = useProjectsStore((state) => state.removeProject);
	const selectProject = useProjectsStore((state) => state.selectProject);
	const updateProjectSettings = useProjectsStore((state) => state.updateProjectSettings);
	const sessionsByProject = useSessionsStore((state) => state.sessionsByProject);
	const inspectorsBySession = useSessionsStore((state) => state.inspectorsBySession);
	const selectedSessionId = useSessionsStore((state) => state.selectedSessionId);
	const loadSessions = useSessionsStore((state) => state.loadSessions);
	const openSession = useSessionsStore((state) => state.openSession);
	const loadInspector = useSessionsStore((state) => state.loadInspector);
	const createSession = useSessionsStore((state) => state.createSession);
	const renameSession = useSessionsStore((state) => state.renameSession);
	const archiveSession = useSessionsStore((state) => state.archiveSession);
	const repairWorktree = useSessionsStore((state) => state.repairWorktree);
	const createManualCheckpoint = useSessionsStore((state) => state.createManualCheckpoint);
	const upsertSummary = useSessionsStore((state) => state.upsertSummary);
	const currentHydration = useSessionsStore((state) => state.currentHydration);
	const entries = useConversationStore((state) => state.entries);
	const toolActivity = useConversationStore((state) => state.toolActivity);
	const checkpoints = useConversationStore((state) => state.checkpoints);
	const contextUsage = useConversationStore((state) => state.contextUsage);
	const hydrateConversation = useConversationStore((state) => state.hydrate);
	const applyEvent = useConversationStore((state) => state.applyEvent);
	const revisions = useReviewStore((state) => state.revisions);
	const activeRevisionNumber = useReviewStore((state) => state.activeRevisionNumber);
	const selectedRevisionNumber = useReviewStore((state) => state.selectedRevisionNumber);
	const diffMode = useReviewStore((state) => state.diffMode);
	const currentDiff = useReviewStore((state) => state.currentDiff);
	const diffStale = useReviewStore((state) => state.diffStale);
	const hydrateReview = useReviewStore((state) => state.hydrate);
	const setReviewPaneVisible = useReviewStore((state) => state.setReviewPaneVisible);
	const setSelectedRevision = useReviewStore((state) => state.setSelectedRevision);
	const setDiffMode = useReviewStore((state) => state.setDiffMode);
	const createThread = useReviewStore((state) => state.createThread);
	const replyToThread = useReviewStore((state) => state.replyToThread);
	const resolveThread = useReviewStore((state) => state.resolveThread);
	const reopenThread = useReviewStore((state) => state.reopenThread);
	const publishComments = useReviewStore((state) => state.publishComments);
	const startNextRevision = useReviewStore((state) => state.startNextRevision);
	const approveRevision = useReviewStore((state) => state.approve);
	const applyRevision = useReviewStore((state) => state.applyRevision);
	const applyAndMergeRevision = useReviewStore((state) => state.applyAndMerge);
	const updateRevision = useReviewStore((state) => state.updateRevision);
	const updateThread = useReviewStore((state) => state.updateThread);
	const markStale = useReviewStore((state) => state.markStale);
	const settings = useSettingsStore((state) => state.settings);
	const loadSettings = useSettingsStore((state) => state.load);
	const updateSettings = useSettingsStore((state) => state.update);
	const hydrateSettings = useSettingsStore((state) => state.hydrate);
	const terminalOpen = useLayoutStore((state) => state.terminalOpen);
	const toggleTerminal = useLayoutStore((state) => state.toggleTerminal);
	const settingsOpen = useLayoutStore((state) => state.settingsOpen);
	const setSettingsOpen = useLayoutStore((state) => state.setSettingsOpen);
	const reviewPaneOpen = useLayoutStore((state) => state.reviewPaneOpen);
	const toggleReviewPane = useLayoutStore((state) => state.toggleReviewPane);
	const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
	const adjustSidebarWidth = useLayoutStore((state) => state.adjustSidebarWidth);
	const diffPaneWidth = useLayoutStore((state) => state.diffPaneWidth);
	const adjustDiffPaneWidth = useLayoutStore((state) => state.adjustDiffPaneWidth);
	const appendTerminalOutput = useTerminalStore((state) => state.appendOutput);
	const markTerminalExit = useTerminalStore((state) => state.markExit);
	const isTerminalRunning = useTerminalStore((state) => state.isRunning);
	const stopTerminal = useTerminalStore((state) => state.stopTerminal);
	const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
	const [toasts, setToasts] = useState<ToastMessage[]>([]);
	const [promptDialog, setPromptDialog] = useState<{
		title: string;
		defaultValue?: string;
		placeholder?: string;
		confirmLabel?: string;
		onConfirm: (value: string) => void;
	} | null>(null);
	const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
	const [modelCatalog, setModelCatalog] = useState<ModelCatalogSummary | undefined>(
		undefined,
	);
	const [modelCatalogLoading, setModelCatalogLoading] = useState(false);

	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--markdown-font-size", `${settings?.markdownFontSize ?? 13}px`);
		root.style.setProperty("--code-font-size", `${settings?.codeFontSize ?? 13}px`);
		const hex = settings?.accentColor ?? "#05A0D1";
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		root.style.setProperty("--accent", hex);
		root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
		root.style.setProperty("--state-running", settings?.stateRunningColor ?? "#3ddc84");
		root.style.setProperty("--state-review", settings?.stateReviewColor ?? "#f0a830");
		root.style.setProperty("--state-error", settings?.stateErrorColor ?? "#f44336");
		root.style.setProperty("--state-applied", settings?.stateAppliedColor ?? "#66bb6a");
	}, [settings?.markdownFontSize, settings?.codeFontSize, settings?.accentColor, settings?.stateRunningColor, settings?.stateReviewColor, settings?.stateErrorColor, settings?.stateAppliedColor]);

	const sessions = useMemo(
		() => (selectedProjectId ? sessionsByProject[selectedProjectId] ?? [] : []),
		[selectedProjectId, sessionsByProject],
	);
	const currentSession = useMemo<SessionSummary | undefined>(() => {
		return currentHydration?.session ?? sessions.find((session) => session.id === selectedSessionId);
	}, [currentHydration?.session, selectedSessionId, sessions]);
	const currentInspector = useMemo(
		() => (currentSession ? inspectorsBySession[currentSession.id] : undefined),
		[currentSession?.id, inspectorsBySession],
	);
	const diffSession = useMemo(
		() =>
			currentSession
				? {
						id: currentSession.id,
						status: currentSession.status,
						mode: currentSession.mode,
						baseRef: currentSession.baseRef,
						worktreeBranch: currentSession.worktreeBranch,
						worktreePath: currentSession.worktreePath,
						cwdPath: currentSession.cwdPath,
					}
				: undefined,
		[
			currentSession?.baseRef,
			currentSession?.cwdPath,
			currentSession?.id,
			currentSession?.mode,
			currentSession?.status,
			currentSession?.worktreeBranch,
			currentSession?.worktreePath,
		],
	);
	const supportsEmbeddedTerminal = currentHydration?.supportsEmbeddedTerminal ?? true;

	const applyHydration = (hydration: SessionHydration) => {
		hydrateConversation(hydration);
		hydrateReview(hydration);
		hydrateSettings(hydration);
	};

	useEffect(() => {
		void loadProjects();
		void loadSettings();
	}, [loadProjects, loadSettings]);

	useEffect(() => {
		if (!selectedProjectId || !settings) return;
		void loadSessions(selectedProjectId).then(async () => {
			const projectSessions =
				useSessionsStore.getState().sessionsByProject[selectedProjectId] ?? [];
			const selectedId = useSessionsStore.getState().selectedSessionId;
			const nextSessionId = projectSessions.some((session) => session.id === selectedId)
				? selectedId
				: projectSessions.find((session) => !session.archivedAt)?.id ??
					projectSessions[0]?.id;
			if (nextSessionId) {
				const hydration = await openSession(nextSessionId);
				applyHydration(hydration);
				await loadInspector(nextSessionId);
			}
		});
	}, [
		loadInspector,
		loadSessions,
		openSession,
		selectedProjectId,
		settings?.showArchived,
	]);

	useEffect(() => {
		if (!currentSession) return;
		if (inspectorsBySession[currentSession.id]) return;
		void loadInspector(currentSession.id);
	}, [currentSession?.id, inspectorsBySession, loadInspector]);

	useEffect(() => {
		setReviewPaneVisible(reviewPaneOpen);
	}, [reviewPaneOpen, setReviewPaneVisible]);

	useEffect(() => {
		const onSessionSummaryUpdated = (summary: SessionSummary) => {
			upsertSummary(summary);
		};
		const onSessionEvent = (event: Parameters<typeof applyEvent>[0]) => {
			applyEvent(event);
		};
		const onRevisionUpdated = (revision: Parameters<typeof updateRevision>[0]) => {
			updateRevision(revision);
		};
		const onThreadUpdated = (thread: Parameters<typeof updateThread>[0]) => {
			updateThread(thread);
		};
		const onDiffInvalidated = (payload: { sessionId: string; revisionNumber?: number }) => {
			markStale(payload.sessionId, payload.revisionNumber);
		};
		const onTerminalData = (payload: { sessionId: string; data: string }) => {
			appendTerminalOutput(payload.sessionId, payload.data);
		};
		const onTerminalExit = (payload: { sessionId: string; exitCode: number }) => {
			markTerminalExit(payload.sessionId, payload.exitCode);
		};
		const onToast = (toast: ToastMessage) => {
			setToasts((current) => [...current, toast].slice(-4));
			window.setTimeout(() => {
				setToasts((current) => current.filter((item) => item.id !== toast.id));
			}, 3600);
		};
		rpc.addMessageListener("sessionSummaryUpdated", onSessionSummaryUpdated);
		rpc.addMessageListener("sessionEvent", onSessionEvent);
		rpc.addMessageListener("revisionUpdated", onRevisionUpdated);
		rpc.addMessageListener("threadUpdated", onThreadUpdated);
		rpc.addMessageListener("diffInvalidated", onDiffInvalidated);
		rpc.addMessageListener("terminalData", onTerminalData);
		rpc.addMessageListener("terminalExit", onTerminalExit);
		rpc.addMessageListener("toast", onToast);
		return () => {
			rpc.removeMessageListener("sessionSummaryUpdated", onSessionSummaryUpdated);
			rpc.removeMessageListener("sessionEvent", onSessionEvent);
			rpc.removeMessageListener("revisionUpdated", onRevisionUpdated);
			rpc.removeMessageListener("threadUpdated", onThreadUpdated);
			rpc.removeMessageListener("diffInvalidated", onDiffInvalidated);
			rpc.removeMessageListener("terminalData", onTerminalData);
			rpc.removeMessageListener("terminalExit", onTerminalExit);
			rpc.removeMessageListener("toast", onToast);
		};
	}, [appendTerminalOutput, applyEvent, markStale, markTerminalExit, updateRevision, updateThread, upsertSummary]);

	const promptForProjectPath = async () => {
		const { path } = await rpc.request.pickProjectDirectory();
		if (!path) return;
		await addProject(path);
	};

	const handleCreateSession = async (options: {
		name?: string;
		modelProvider?: string;
		modelId?: string;
	}) => {
		if (!selectedProjectId) return;
		const session = await createSession(selectedProjectId, {
			name: options.name || undefined,
			modelProvider: options.modelProvider,
			modelId: options.modelId,
		});
		startTransition(() => {
			void openSession(session.id).then(async (hydration) => {
				applyHydration(hydration);
				await loadInspector(session.id);
			});
		});
	};

	const promptCreateSession = async () => {
		if (!selectedProjectId) return;
		setNewSessionDialogOpen(true);
		setModelCatalogLoading(true);
		try {
			const catalog = await rpc.request.getModelCatalog({
				projectId: selectedProjectId,
			});
			setModelCatalog(catalog);
		} catch {
			setModelCatalog(undefined);
		} finally {
			setModelCatalogLoading(false);
		}
	};

	const handleOpenSession = async (sessionId: string) => {
		const hydration = await openSession(sessionId);
		applyHydration(hydration);
		await loadInspector(sessionId);
	};

	const handleRenameSession = (session: SessionSummary) => {
		setPromptDialog({
			title: "Rename session",
			defaultValue: session.displayName,
			confirmLabel: "Rename",
			onConfirm: (name) => {
				setPromptDialog(null);
				if (name && name !== session.displayName) {
					void renameSession(session.id, name);
				}
			},
		});
	};

	const handleArchiveSession = async (session: SessionSummary, archived: boolean) => {
		await archiveSession(session.id, archived, session.projectId);
		if (
			archived &&
			currentSession?.id === session.id &&
			!settings?.showArchived &&
			selectedProjectId
		) {
			const nextSessions =
				useSessionsStore.getState().sessionsByProject[selectedProjectId] ?? [];
			const nextSessionId =
				nextSessions.find((item) => !item.archivedAt)?.id ?? nextSessions[0]?.id;
			if (nextSessionId) {
				await handleOpenSession(nextSessionId);
			}
		}
	};

	const handleRunProjectCommand = async () => {
		if (!currentSession) return;
		const project = projects.find((p) => p.id === currentSession.projectId);
		if (!project?.metadata.runCommand) {
			setProjectSettingsOpen(true);
			return;
		}
		const layoutStore = useLayoutStore.getState();
		if (!layoutStore.terminalOpen) layoutStore.toggleTerminal();
		await rpc.request.runProjectCommand({ sessionId: currentSession.id });
	};

	useEffect(() => {
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target) {
				event.preventDefault();
				return;
			}
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target.isContentEditable ||
				target.closest("[data-allow-context-menu]")
			) {
				return;
			}
			event.preventDefault();
		};
		window.addEventListener("contextmenu", onContextMenu);
		return () => window.removeEventListener("contextmenu", onContextMenu);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typingTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				Boolean(target?.isContentEditable);
			const mod = event.metaKey || event.ctrlKey;
			if (!mod) return;
			const key = event.key.toLowerCase();
			if (typingTarget && key !== ",") return;
			if (key === "n") {
				event.preventDefault();
				void promptCreateSession();
			}
			if (key === ",") {
				event.preventDefault();
				setSettingsOpen(true);
			}
			if (key === "j") {
				event.preventDefault();
				toggleTerminal();
			}
			if (key === "r") {
				event.preventDefault();
				toggleReviewPane();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedProjectId, setSettingsOpen, toggleTerminal, toggleReviewPane]);

	return (
		<div className="flex h-full flex-col bg-surface-0">
			<TitleBar
				session={currentSession}
				onNewSession={() => void promptCreateSession()}
				onToggleTerminal={toggleTerminal}
				onToggleReviewPane={toggleReviewPane}
				reviewPaneOpen={reviewPaneOpen}
				onOpenSettings={() => setSettingsOpen(true)}
				supportsEmbeddedTerminal={supportsEmbeddedTerminal}
			/>

			<div className="flex min-h-0 flex-1">
				<div style={{ width: sidebarWidth, minWidth: 160, maxWidth: 400 }} className="shrink-0">
				<Sidebar
					projects={projects}
					selectedProjectId={selectedProjectId}
					sessions={sessions}
					selectedSessionId={selectedSessionId}
					onSelectProject={selectProject}
					onOpenSession={(sessionId) => void handleOpenSession(sessionId)}
					onAddProject={() => void promptForProjectPath()}
					onRemoveProject={(projectId) => void removeProject(projectId)}
					onCreateSession={() => void promptCreateSession()}
					onOpenProjectInEditor={(projectId) =>
						void rpc.request.openProjectInEditor({ projectId })
					}
					onRevealProject={(projectId) =>
						void rpc.request.revealProject({ projectId })
					}
					onRenameSession={(session) => handleRenameSession(session)}
					onArchiveSession={(session, archived) =>
						void handleArchiveSession(session, archived)
					}
					onOpenSettings={() => setSettingsOpen(true)}
				onRunProjectCommand={() => void handleRunProjectCommand()}
				onStopProjectCommand={() => currentSession && void stopTerminal(currentSession.id)}
				isProjectCommandRunning={currentSession ? isTerminalRunning(currentSession.id) : false}
				onOpenProjectSettings={() => setProjectSettingsOpen(true)}
				/>
				</div>

				<ResizeHandle onDrag={adjustSidebarWidth} />

				<div className="min-w-0 flex-1">
				<ConversationPane
					session={currentSession}
					entries={entries}
					toolActivity={toolActivity}
					checkpoints={checkpoints}
					onSendPrompt={(text) =>
						currentSession
							? rpc.request.sendPrompt({ sessionId: currentSession.id, text })
							: Promise.resolve()
					}
					onSteer={(text) =>
						currentSession
							? rpc.request.steerSession({ sessionId: currentSession.id, text })
							: Promise.resolve()
					}
					onFollowUp={(text) =>
						currentSession
							? rpc.request.followUpSession({ sessionId: currentSession.id, text })
							: Promise.resolve()
					}
					onAbort={() =>
						currentSession
							? rpc.request.abortSession({ sessionId: currentSession.id })
							: Promise.resolve()
					}
					onRestoreCheckpoint={(checkpointId) =>
						currentSession
							? rpc.request.restoreCheckpoint({ sessionId: currentSession.id, checkpointId })
							: Promise.resolve()
					}
				/>
				</div>

				{reviewPaneOpen && (
					<>
					<ResizeHandle onDrag={(delta) => adjustDiffPaneWidth(-delta, Math.floor(window.innerWidth * 0.8))} />

					<div style={{ width: diffPaneWidth, minWidth: 280, maxWidth: "80vw" }} className="shrink-0">
					<DiffPane
						session={diffSession}
						inspector={currentInspector}
						diff={currentDiff}
						revisions={revisions}
						activeRevisionNumber={activeRevisionNumber}
						selectedRevisionNumber={selectedRevisionNumber}
						diffMode={diffMode}
						defaultView={settings?.defaultDiffView ?? "split"}
						diffStale={diffStale}
						onSelectRevision={setSelectedRevision}
						onSetDiffMode={setDiffMode}
						onCreateThread={createThread}
						onReplyToThread={replyToThread}
						onResolveThread={resolveThread}
						onReopenThread={reopenThread}
						onPublishComments={publishComments}
						onStartNextRevision={startNextRevision}
						onApprove={approveRevision}
						onApplyRevision={applyRevision}
						onApplyAndMerge={applyAndMergeRevision}
						onCreateManualCheckpoint={() =>
							currentSession
								? createManualCheckpoint(currentSession.id).then(() => undefined)
								: Promise.resolve()
						}
						onRepairWorktree={() =>
							currentSession
								? repairWorktree(currentSession.id)
								: Promise.resolve()
						}
					/>
					</div>
					</>
				)}
			</div>

			<TerminalDrawer
				sessionId={currentSession?.id}
				open={terminalOpen}
				supported={supportsEmbeddedTerminal}
			/>

			<SettingsDialog
				open={settingsOpen}
				settings={settings}
				onOpenChange={setSettingsOpen}
				onUpdate={updateSettings}
			/>

			<ProjectSettingsDialog
				open={projectSettingsOpen}
				project={projects.find((p) => p.id === selectedProjectId)}
				onOpenChange={setProjectSettingsOpen}
				onUpdate={updateProjectSettings}
			/>

			<NewSessionDialog
				open={newSessionDialogOpen}
				loading={modelCatalogLoading}
				catalog={modelCatalog}
				onConfirm={(value) => {
					setNewSessionDialogOpen(false);
					void handleCreateSession(value);
				}}
				onCancel={() => setNewSessionDialogOpen(false)}
			/>

			<PromptDialog
				open={promptDialog !== null}
				title={promptDialog?.title ?? ""}
				defaultValue={promptDialog?.defaultValue}
				placeholder={promptDialog?.placeholder}
				confirmLabel={promptDialog?.confirmLabel}
				onConfirm={(value) => promptDialog?.onConfirm(value)}
				onCancel={() => setPromptDialog(null)}
			/>

			{/* Status bar */}
			<div className="flex h-6 shrink-0 items-center justify-between border-t border-surface-border bg-surface-0 px-3 text-2xs text-white/25">
				<span>{currentSession ? `${currentSession.mode} · ${currentSession.reviewState}` : "No session"}</span>
				<div className="flex items-center gap-3">
					{contextUsage ? (
						<ContextUsageBar usage={contextUsage} />
					) : null}
					<span>{currentSession?.modelLabel ?? ""}</span>
				</div>
			</div>

			<PerfOverlay />

			{/* Toasts */}
			<div className="pointer-events-none fixed right-3 top-14 z-50 flex w-72 flex-col gap-1.5">
				{toasts.map((toast) => (
					<div
						key={toast.id}
						className="border border-surface-border bg-surface-2 px-3 py-2 text-xs shadow-lg"
					>
						<div className="font-medium text-white/80">{toast.title}</div>
						{toast.description ? (
							<div className="mt-0.5 text-white/40">{toast.description}</div>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
