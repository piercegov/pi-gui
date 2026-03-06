import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionHydration, SessionSummary, ToastMessage } from "@shared/models";
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

export function App() {
	const { projects, selectedProjectId, loadProjects, addProject, removeProject, selectProject } =
		useProjectsStore();
	const {
		sessionsByProject,
		inspectorsBySession,
		selectedSessionId,
		loadSessions,
		openSession,
		loadInspector,
		createSession,
		renameSession,
		archiveSession,
		repairWorktree,
		createManualCheckpoint,
		upsertSummary,
		currentHydration,
	} = useSessionsStore();
	const { entries, toolActivity, hydrate: hydrateConversation, applyEvent } =
		useConversationStore();
	const review = useReviewStore();
	const settings = useSettingsStore((state) => state.settings);
	const loadSettings = useSettingsStore((state) => state.load);
	const updateSettings = useSettingsStore((state) => state.update);
	const hydrateSettings = useSettingsStore((state) => state.hydrate);
	const terminalOpen = useLayoutStore((state) => state.terminalOpen);
	const toggleTerminal = useLayoutStore((state) => state.toggleTerminal);
	const settingsOpen = useLayoutStore((state) => state.settingsOpen);
	const setSettingsOpen = useLayoutStore((state) => state.setSettingsOpen);
	const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
	const adjustSidebarWidth = useLayoutStore((state) => state.adjustSidebarWidth);
	const diffPaneWidth = useLayoutStore((state) => state.diffPaneWidth);
	const adjustDiffPaneWidth = useLayoutStore((state) => state.adjustDiffPaneWidth);
	const appendTerminalOutput = useTerminalStore((state) => state.appendOutput);
	const markTerminalExit = useTerminalStore((state) => state.markExit);
	const [toasts, setToasts] = useState<ToastMessage[]>([]);

	const sessions = useMemo(
		() => (selectedProjectId ? sessionsByProject[selectedProjectId] ?? [] : []),
		[selectedProjectId, sessionsByProject],
	);
	const currentSession = useMemo<SessionSummary | undefined>(() => {
		return currentHydration?.session ?? sessions.find((session) => session.id === selectedSessionId);
	}, [currentHydration?.session, selectedSessionId, sessions]);
	const currentInspector = useMemo(
		() => (currentSession ? inspectorsBySession[currentSession.id] : undefined),
		[currentSession, inspectorsBySession],
	);
	const supportsEmbeddedTerminal = currentHydration?.supportsEmbeddedTerminal ?? true;

	const applyHydration = (hydration: SessionHydration) => {
		hydrateConversation(hydration);
		review.hydrate(hydration);
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
		void loadInspector(currentSession.id);
	}, [currentSession?.id, currentSession?.lastActivityAt, loadInspector]);

	useEffect(() => {
		const onSessionSummaryUpdated = (summary: SessionSummary) => {
			upsertSummary(summary);
		};
		const onSessionEvent = (event: Parameters<typeof applyEvent>[0]) => {
			applyEvent(event);
		};
		const onReviewRoundUpdated = (round: Parameters<typeof review.updateRound>[0]) => {
			review.updateRound(round);
		};
		const onThreadUpdated = (thread: Parameters<typeof review.updateThread>[0]) => {
			review.updateThread(thread);
		};
		const onDiffInvalidated = (payload: { sessionId: string; scope?: Parameters<typeof review.buildDiff>[0] }) => {
			review.markStale(payload.sessionId, payload.scope);
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
		rpc.addMessageListener("reviewRoundUpdated", onReviewRoundUpdated);
		rpc.addMessageListener("threadUpdated", onThreadUpdated);
		rpc.addMessageListener("diffInvalidated", onDiffInvalidated);
		rpc.addMessageListener("terminalData", onTerminalData);
		rpc.addMessageListener("terminalExit", onTerminalExit);
		rpc.addMessageListener("toast", onToast);
		return () => {
			rpc.removeMessageListener("sessionSummaryUpdated", onSessionSummaryUpdated);
			rpc.removeMessageListener("sessionEvent", onSessionEvent);
			rpc.removeMessageListener("reviewRoundUpdated", onReviewRoundUpdated);
			rpc.removeMessageListener("threadUpdated", onThreadUpdated);
			rpc.removeMessageListener("diffInvalidated", onDiffInvalidated);
			rpc.removeMessageListener("terminalData", onTerminalData);
			rpc.removeMessageListener("terminalExit", onTerminalExit);
			rpc.removeMessageListener("toast", onToast);
		};
	}, [appendTerminalOutput, applyEvent, markTerminalExit, review, upsertSummary]);

	const promptForProjectPath = async () => {
		const { path } = await rpc.request.pickProjectDirectory();
		if (!path) return;
		await addProject(path);
	};

	const handleCreateSession = async () => {
		if (!selectedProjectId) return;
		const name = window.prompt("Session name (optional)") ?? undefined;
		const session = await createSession(selectedProjectId, { name });
		startTransition(() => {
			void openSession(session.id).then(async (hydration) => {
				applyHydration(hydration);
				await loadInspector(session.id);
			});
		});
	};

	const handleOpenSession = async (sessionId: string) => {
		const hydration = await openSession(sessionId);
		applyHydration(hydration);
		await loadInspector(sessionId);
	};

	const handleRenameSession = async (session: SessionSummary) => {
		const name = window.prompt("Rename session", session.displayName)?.trim();
		if (!name || name === session.displayName) return;
		await renameSession(session.id, name);
	};

	const handleArchiveSession = async (session: SessionSummary, archived: boolean) => {
		if (
			archived &&
			!window.confirm(`Archive "${session.displayName}"? You can restore it later.`)
		) {
			return;
		}
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
				void handleCreateSession();
			}
			if (key === ",") {
				event.preventDefault();
				setSettingsOpen(true);
			}
			if (key === "j") {
				event.preventDefault();
				toggleTerminal();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedProjectId, setSettingsOpen, toggleTerminal]);

	return (
		<div className="flex h-full flex-col bg-surface-0">
			<TitleBar
				session={currentSession}
				onNewSession={() => void handleCreateSession()}
				onToggleTerminal={toggleTerminal}
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
					onCreateSession={() => void handleCreateSession()}
					onOpenProjectInEditor={(projectId) =>
						void rpc.request.openProjectInEditor({ projectId })
					}
					onRevealProject={(projectId) =>
						void rpc.request.revealProject({ projectId })
					}
					onRenameSession={(session) => void handleRenameSession(session)}
					onArchiveSession={(session, archived) =>
						void handleArchiveSession(session, archived)
					}
					onOpenSettings={() => setSettingsOpen(true)}
				/>
				</div>

				<ResizeHandle onDrag={adjustSidebarWidth} />

				<div className="min-w-0 flex-1">
				<ConversationPane
					session={currentSession}
					entries={entries}
					toolActivity={toolActivity}
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
				/>
				</div>

				<ResizeHandle onDrag={(delta) => adjustDiffPaneWidth(-delta)} />

				<div style={{ width: diffPaneWidth, minWidth: 280, maxWidth: 900 }} className="shrink-0">
				<DiffPane
					session={currentSession}
					inspector={currentInspector}
					diff={review.currentDiff}
					diffScopes={review.diffScopes}
					activeReviewRound={review.reviewRounds.find(
						(round) => round.id === review.activeReviewRoundId,
					)}
					defaultView={settings?.defaultDiffView ?? "split"}
					diffStale={review.diffStale}
					onSelectScope={(scope) => review.buildDiff(scope)}
					onCreateThread={(anchor, body) => review.createThread(anchor, body)}
					onReplyToThread={(threadId, body) => review.replyToThread(threadId, body)}
					onResolveThread={(threadId) => review.resolveThread(threadId)}
					onReopenThread={(threadId) => review.reopenThread(threadId)}
					onSubmitReview={() => review.submitReview()}
					onMarkAligned={() => review.markAligned()}
					onApplyAlignedChanges={() => review.applyAlignedChanges()}
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
			</div>

			<TerminalDrawer
				sessionId={currentSession?.id}
				open={terminalOpen}
				toolActivity={toolActivity}
				supported={supportsEmbeddedTerminal}
			/>

			<SettingsDialog
				open={settingsOpen}
				settings={settings}
				onOpenChange={setSettingsOpen}
				onUpdate={updateSettings}
			/>

			{/* Status bar */}
			<div className="flex h-6 shrink-0 items-center justify-between border-t border-surface-border bg-surface-0 px-3 text-2xs text-white/25">
				<span>{currentSession ? `${currentSession.mode} · ${currentSession.reviewState}` : "No session"}</span>
				<span>{currentSession?.modelLabel ?? ""}</span>
			</div>

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
