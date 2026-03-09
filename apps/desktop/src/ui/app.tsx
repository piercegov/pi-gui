import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ContextUsageView,
	ModelCatalogSummary,
	PermissionPrompt,
	PermissionPromptDecision,
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
import { PermissionPromptDialog } from "./components/shared/permission-prompt-dialog";
import { PerfOverlay } from "./components/shell/perf-overlay";

function StatusBar({ session }: { session?: SessionSummary }) {
	const contextUsage = useConversationStore((s) => s.contextUsage);
	return (
		<div className="flex h-6 shrink-0 items-center justify-between border-t border-surface-border bg-surface-0 px-3 text-2xs text-white/25">
			<span>{session ? `${session.mode} · ${session.reviewState}` : "No session"}</span>
			<div className="flex items-center gap-3">
				{contextUsage ? (
					<ContextUsageBar usage={contextUsage} />
				) : null}
				<span>{session?.modelLabel ?? ""}</span>
			</div>
		</div>
	);
}

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
	const selectSession = useSessionsStore((state) => state.selectSession);
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
	const setHydration = useSessionsStore((state) => state.setHydration);
	const prepareConversation = useConversationStore((state) => state.prepareSession);
	const hydrateConversation = useConversationStore((state) => state.hydrate);
	const applyEvent = useConversationStore((state) => state.applyEvent);
	const prepareReview = useReviewStore((state) => state.prepareSession);
	const hydrateReview = useReviewStore((state) => state.hydrate);
	const setReviewPaneVisible = useReviewStore((state) => state.setReviewPaneVisible);
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
	const [permissionPrompts, setPermissionPrompts] = useState<PermissionPrompt[]>([]);
	const activePermissionPrompt = permissionPrompts[0];

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
	const sessionOpenRequestIdRef = useRef(0);
	const sessionIdRef = useRef<string | undefined>(currentSession?.id);
	sessionIdRef.current = currentSession?.id;

	const handleSendPrompt = useCallback(
		(text: string) => {
			const sid = sessionIdRef.current;
			return sid ? rpc.request.sendPrompt({ sessionId: sid, text }) : Promise.resolve();
		},
		[],
	);
	const handleSteer = useCallback(
		(text: string) => {
			const sid = sessionIdRef.current;
			return sid ? rpc.request.steerSession({ sessionId: sid, text }) : Promise.resolve();
		},
		[],
	);
	const handleFollowUp = useCallback(
		(text: string) => {
			const sid = sessionIdRef.current;
			return sid ? rpc.request.followUpSession({ sessionId: sid, text }) : Promise.resolve();
		},
		[],
	);
	const handleAbort = useCallback(() => {
		const sid = sessionIdRef.current;
		return sid ? rpc.request.abortSession({ sessionId: sid }) : Promise.resolve();
	}, []);
	const handleRestoreCheckpoint = useCallback((checkpointId: string) => {
		const sid = sessionIdRef.current;
		return sid ? rpc.request.restoreCheckpoint({ sessionId: sid, checkpointId }) : Promise.resolve();
	}, []);
	const handleCreateManualCheckpoint = useCallback(() => {
		const sid = sessionIdRef.current;
		return sid ? createManualCheckpoint(sid).then(() => undefined) : Promise.resolve();
	}, [createManualCheckpoint]);
	const handleRepairWorktree = useCallback(() => {
		const sid = sessionIdRef.current;
		return sid ? repairWorktree(sid) : Promise.resolve();
	}, [repairWorktree]);

	const applyHydration = useCallback((hydration: SessionHydration) => {
		hydrateConversation(hydration);
		hydrateReview(hydration);
		hydrateSettings(hydration);
		setHydration(hydration);
	}, [hydrateConversation, hydrateReview, hydrateSettings, setHydration]);

	const openAndHydrateSession = useCallback(
		async (sessionId: string) => {
			const requestId = sessionOpenRequestIdRef.current + 1;
			sessionOpenRequestIdRef.current = requestId;
			selectSession(sessionId);
			prepareConversation(sessionId);
			prepareReview(sessionId);
			const hydration = await openSession(sessionId);
			if (sessionOpenRequestIdRef.current !== requestId) return;
			if (useSessionsStore.getState().selectedSessionId !== sessionId) return;
			applyHydration(hydration);
			await loadInspector(sessionId);
		},
		[
			applyHydration,
			loadInspector,
			openSession,
			prepareConversation,
			prepareReview,
			selectSession,
		],
	);

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
				await openAndHydrateSession(nextSessionId);
			}
		});
	}, [
		loadSessions,
		openAndHydrateSession,
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
		const onPermissionPrompt = (prompt: PermissionPrompt) => {
			setPermissionPrompts((current) =>
				current.some((item) => item.id === prompt.id)
					? current
					: [...current, prompt],
			);
		};
		rpc.addMessageListener("sessionSummaryUpdated", onSessionSummaryUpdated);
		rpc.addMessageListener("sessionEvent", onSessionEvent);
		rpc.addMessageListener("revisionUpdated", onRevisionUpdated);
		rpc.addMessageListener("threadUpdated", onThreadUpdated);
		rpc.addMessageListener("diffInvalidated", onDiffInvalidated);
		rpc.addMessageListener("terminalData", onTerminalData);
		rpc.addMessageListener("terminalExit", onTerminalExit);
		rpc.addMessageListener("toast", onToast);
		rpc.addMessageListener("permissionPrompt", onPermissionPrompt);
		return () => {
			rpc.removeMessageListener("sessionSummaryUpdated", onSessionSummaryUpdated);
			rpc.removeMessageListener("sessionEvent", onSessionEvent);
			rpc.removeMessageListener("revisionUpdated", onRevisionUpdated);
			rpc.removeMessageListener("threadUpdated", onThreadUpdated);
			rpc.removeMessageListener("diffInvalidated", onDiffInvalidated);
			rpc.removeMessageListener("terminalData", onTerminalData);
			rpc.removeMessageListener("terminalExit", onTerminalExit);
			rpc.removeMessageListener("toast", onToast);
			rpc.removeMessageListener("permissionPrompt", onPermissionPrompt);
		};
	}, [appendTerminalOutput, applyEvent, markStale, markTerminalExit, updateRevision, updateThread, upsertSummary]);

	const resolvePermissionPrompt = useCallback(
		(decision: PermissionPromptDecision, selectedScopeId?: string) => {
			const prompt = activePermissionPrompt;
			if (!prompt) return;
			setPermissionPrompts((current) => current.slice(1));
			void rpc.request.resolvePermissionPrompt({
				promptId: prompt.id,
				decision,
				selectedScopeId,
			});
		},
		[activePermissionPrompt],
	);

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
			void openAndHydrateSession(session.id);
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

	const handleOpenSession = useCallback(
		async (sessionId: string) => {
			await openAndHydrateSession(sessionId);
		},
		[openAndHydrateSession],
	);

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

	const handleArchiveSession = useCallback(
		async (session: SessionSummary, archived: boolean) => {
			await archiveSession(session.id, archived, session.projectId);
			const sid = sessionIdRef.current;
			const state = useSessionsStore.getState();
			const projId = useProjectsStore.getState().selectedProjectId;
			if (
				archived &&
				sid === session.id &&
				!useSettingsStore.getState().settings?.showArchived &&
				projId
			) {
				const nextSessions = state.sessionsByProject[projId] ?? [];
				const nextSessionId =
					nextSessions.find((item) => !item.archivedAt)?.id ?? nextSessions[0]?.id;
				if (nextSessionId) {
					await handleOpenSession(nextSessionId);
				}
			}
		},
		[archiveSession, handleOpenSession],
	);

	const sidebarOpenSession = useCallback(
		(sessionId: string) => void handleOpenSession(sessionId),
		[handleOpenSession],
	);
	const sidebarAddProject = useCallback(
		() => void promptForProjectPath(),
		[addProject],
	);
	const sidebarRemoveProject = useCallback(
		(projectId: string) => void removeProject(projectId),
		[removeProject],
	);
	const sidebarCreateSession = useCallback(
		() => void promptCreateSession(),
		[selectedProjectId],
	);
	const sidebarOpenInEditor = useCallback(
		(projectId: string) => void rpc.request.openProjectInEditor({ projectId }),
		[],
	);
	const sidebarRevealProject = useCallback(
		(projectId: string) => void rpc.request.revealProject({ projectId }),
		[],
	);
	const sidebarArchiveSession = useCallback(
		(session: SessionSummary, archived: boolean) => void handleArchiveSession(session, archived),
		[handleArchiveSession],
	);
	const sidebarOpenSettings = useCallback(
		() => setSettingsOpen(true),
		[setSettingsOpen],
	);
	const sidebarOpenProjectSettings = useCallback(
		() => setProjectSettingsOpen(true),
		[],
	);

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
				onNewSession={sidebarCreateSession}
				onToggleTerminal={toggleTerminal}
				onToggleReviewPane={toggleReviewPane}
				reviewPaneOpen={reviewPaneOpen}
				onOpenSettings={sidebarOpenSettings}
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
					onOpenSession={sidebarOpenSession}
					onAddProject={sidebarAddProject}
					onRemoveProject={sidebarRemoveProject}
					onCreateSession={sidebarCreateSession}
					onOpenProjectInEditor={sidebarOpenInEditor}
					onRevealProject={sidebarRevealProject}
					onRenameSession={handleRenameSession}
					onArchiveSession={sidebarArchiveSession}
					onOpenSettings={sidebarOpenSettings}
					onOpenProjectSettings={sidebarOpenProjectSettings}
				/>
				</div>

				<ResizeHandle onDrag={adjustSidebarWidth} />

				<div className="min-w-0 flex-1">
				<ConversationPane
					session={currentSession}
					onSendPrompt={handleSendPrompt}
					onSteer={handleSteer}
					onFollowUp={handleFollowUp}
					onAbort={handleAbort}
					onRestoreCheckpoint={handleRestoreCheckpoint}
				/>
				</div>

				{reviewPaneOpen && (
					<>
					<ResizeHandle onDrag={(delta) => adjustDiffPaneWidth(-delta, Math.floor(window.innerWidth * 0.8))} />

					<div style={{ width: diffPaneWidth, minWidth: 280, maxWidth: "80vw" }} className="shrink-0">
					<DiffPane
						session={diffSession}
						inspector={currentInspector}
						defaultView={settings?.defaultDiffView ?? "split"}
						onCreateManualCheckpoint={handleCreateManualCheckpoint}
						onRepairWorktree={handleRepairWorktree}
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

			<PermissionPromptDialog
				open={Boolean(activePermissionPrompt)}
				prompt={activePermissionPrompt}
				onResolve={resolvePermissionPrompt}
			/>

			<StatusBar session={currentSession} />

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
