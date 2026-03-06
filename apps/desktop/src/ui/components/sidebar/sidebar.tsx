import type { ProjectSummary, SessionSummary } from "@shared/models";

function sessionStatusColor(status: SessionSummary["status"]) {
	if (status === "running") return "bg-[color:var(--state-running)]";
	if (status === "waiting_for_review" || status === "discussion_open") {
		return "bg-[color:var(--state-review)]";
	}
	if (status === "error") return "bg-[color:var(--state-error)]";
	if (status === "completed" || status === "aligned") {
		return "bg-[color:var(--state-applied)]";
	}
	return "bg-black/20";
}

export function Sidebar(props: {
	projects: ProjectSummary[];
	selectedProjectId?: string;
	sessions: SessionSummary[];
	selectedSessionId?: string;
	onSelectProject: (projectId: string) => void;
	onOpenSession: (sessionId: string) => void;
	onAddProject: () => void;
	onRemoveProject: (projectId: string) => void;
	onCreateSession: () => void;
	onOpenProjectInEditor: (projectId: string) => void;
	onRevealProject: (projectId: string) => void;
	onRenameSession: (session: SessionSummary) => void;
	onArchiveSession: (session: SessionSummary, archived: boolean) => void;
	onOpenSettings: () => void;
}) {
	return (
		<aside className="flex h-full flex-col border-r border-black/10 bg-white/45">
			<div className="border-b border-black/10 px-4 py-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
						Projects
					</h2>
					<button
						onClick={props.onAddProject}
						className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-xs text-black/70 transition hover:bg-white"
					>
						Add
					</button>
				</div>
				<div className="space-y-2">
					{props.projects.map((project) => {
						const selected = project.id === props.selectedProjectId;
						return (
							<div
								key={project.id}
								className={`rounded-2xl border px-3 py-3 transition ${
									selected
										? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
										: "border-black/5 bg-white/60 hover:bg-white/85"
								}`}
							>
								<button
									onClick={() => props.onSelectProject(project.id)}
									className="flex w-full items-start justify-between text-left"
								>
									<div>
										<div className="text-sm font-semibold">{project.name}</div>
										<div className="mt-1 text-xs text-black/50">
											{project.sessionCount} sessions
											{project.isGit ? " • git" : " • local"}
										</div>
									</div>
									<div className="rounded-full bg-black/5 px-2 py-1 text-[11px] text-black/55">
										{project.defaultBaseRef ?? "HEAD"}
									</div>
								</button>
								<div className="mt-3 flex flex-wrap gap-2">
									<button
										onClick={props.onCreateSession}
										className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60 transition hover:bg-white"
									>
										New session
									</button>
									<button
										onClick={() => props.onOpenProjectInEditor(project.id)}
										className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60 transition hover:bg-white"
									>
										Open editor
									</button>
									<button
										onClick={() => props.onRevealProject(project.id)}
										className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60 transition hover:bg-white"
									>
										Reveal
									</button>
									<button
										onClick={() => props.onRemoveProject(project.id)}
										className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-[color:var(--state-error)] transition hover:bg-white"
									>
										Remove
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			<div className="flex-1 overflow-auto px-4 py-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
						Sessions
					</h2>
					<div className="text-xs text-black/45">{props.sessions.length}</div>
				</div>
				<div className="space-y-2">
					{props.sessions.map((session) => {
						const selected = session.id === props.selectedSessionId;
						return (
							<div
								key={session.id}
								className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
									selected
										? "border-black/20 bg-[#2e2a25] text-white"
										: session.archivedAt
											? "border-black/5 bg-white/45 text-black/60"
											: "border-black/5 bg-white/60 text-black hover:bg-white/85"
								}`}
							>
								<button
									onClick={() => props.onOpenSession(session.id)}
									className="w-full text-left"
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<span
												className={`inline-block h-2.5 w-2.5 rounded-full ${sessionStatusColor(session.status)}`}
											/>
											<span className="text-sm font-medium">
												{session.displayName}
											</span>
										</div>
										<div className="flex items-center gap-2">
											{session.archivedAt ? (
												<span className="rounded-full border border-current/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] opacity-70">
													archived
												</span>
											) : null}
											<span className="rounded-full border border-current/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] opacity-70">
												{session.mode}
											</span>
										</div>
									</div>
									<div className="mt-2 flex flex-wrap gap-2 text-[11px] opacity-75">
										<span>{session.changedFilesCount} changed</span>
										<span>{session.unresolvedCommentCount} comments</span>
										<span>
											{new Date(session.lastActivityAt).toLocaleTimeString([], {
												hour: "numeric",
												minute: "2-digit",
											})}
										</span>
									</div>
								</button>
								{selected ? (
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											onClick={() => props.onRenameSession(session)}
											className="rounded-full border border-current/10 px-2.5 py-1 text-[11px] opacity-80 transition hover:bg-white/10"
										>
											Rename
										</button>
										<button
											onClick={() =>
												props.onArchiveSession(session, !session.archivedAt)
											}
											className="rounded-full border border-current/10 px-2.5 py-1 text-[11px] opacity-80 transition hover:bg-white/10"
										>
											{session.archivedAt ? "Restore" : "Archive"}
										</button>
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</div>

			<div className="border-t border-black/10 p-4">
				<button
					onClick={props.onOpenSettings}
					className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-2 text-sm font-medium text-black/70 transition hover:bg-white"
				>
					App settings
				</button>
			</div>
		</aside>
	);
}
