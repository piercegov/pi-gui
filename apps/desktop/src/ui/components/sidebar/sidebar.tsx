import { Plus, FolderOpen, Trash2, ExternalLink, Eye, MoreHorizontal, Archive, Pencil, ArchiveRestore, Play, Settings } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ProjectSummary, SessionSummary } from "@shared/models";

function sessionStatusColor(status: SessionSummary["status"]) {
	if (status === "running") return "bg-state-running";
	if (status === "reviewing") return "bg-state-review";
	if (status === "error") return "bg-state-error";
	if (status === "completed" || status === "merged") return "bg-state-applied";
	return "bg-white/20";
}

function relativeTime(ts: number) {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
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
	onRunProjectCommand: () => void;
	onOpenProjectSettings: () => void;
}) {
	const selectedProject = props.projects.find((p) => p.id === props.selectedProjectId);

	return (
		<aside className="flex h-full flex-col bg-surface-0 border-r border-surface-border">
			{/* Project header */}
			<div className="flex items-center justify-between border-b border-surface-border px-3 py-2.5">
				{selectedProject ? (
					<DropdownMenu.Root>
						<DropdownMenu.Trigger className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium text-white/90 transition hover:bg-white/5">
							<FolderOpen className="h-3.5 w-3.5 text-white/40" />
							{selectedProject.name}
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								className="min-w-[200px] rounded-lg border border-surface-border bg-surface-2 p-1 shadow-xl"
								sideOffset={4}
								align="start"
							>
								{props.projects.map((project) => (
									<DropdownMenu.Item
										key={project.id}
										className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-white/80 outline-none hover:bg-white/8"
										onSelect={() => props.onSelectProject(project.id)}
									>
										<FolderOpen className="h-3.5 w-3.5 text-white/40" />
										{project.name}
										{project.id === props.selectedProjectId ? (
											<span className="ml-auto text-accent text-xs">●</span>
										) : null}
									</DropdownMenu.Item>
								))}
								<DropdownMenu.Separator className="my-1 h-px bg-surface-border" />
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-white/60 outline-none hover:bg-white/8"
									onSelect={props.onAddProject}
								>
									<Plus className="h-3.5 w-3.5" />
									Add project
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				) : (
					<button
						onClick={props.onAddProject}
						className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/60 transition hover:bg-white/5"
					>
						<Plus className="h-3.5 w-3.5" />
						Add project
					</button>
				)}

				{selectedProject ? (
					<div className="flex items-center gap-0.5">
						<button
							onClick={props.onRunProjectCommand}
							className={`rounded-md p-1 transition hover:bg-white/8 ${
								selectedProject.metadata.runCommand
									? "text-state-running/70 hover:text-state-running"
									: "text-white/40 hover:text-white/60"
							}`}
							title={selectedProject.metadata.runCommand ? `Run: ${selectedProject.metadata.runCommand}` : "Run (no command configured)"}
						>
							<Play className="h-3.5 w-3.5" />
						</button>
						<button
							onClick={() => props.onOpenProjectInEditor(selectedProject.id)}
							className="rounded-md p-1 text-white/40 transition hover:bg-white/8 hover:text-white/60"
							title="Open in editor"
						>
							<ExternalLink className="h-3.5 w-3.5" />
						</button>
						<button
							onClick={() => props.onRevealProject(selectedProject.id)}
							className="rounded-md p-1 text-white/40 transition hover:bg-white/8 hover:text-white/60"
							title="Reveal in Finder"
						>
							<Eye className="h-3.5 w-3.5" />
						</button>
						<button
							onClick={props.onOpenProjectSettings}
							className="rounded-md p-1 text-white/40 transition hover:bg-white/8 hover:text-white/60"
							title="Project settings"
						>
							<Settings className="h-3.5 w-3.5" />
						</button>
						<button
							onClick={() => props.onRemoveProject(selectedProject.id)}
							className="rounded-md p-1 text-white/40 transition hover:bg-white/8 hover:text-red-400/80"
							title="Remove project"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					</div>
				) : null}
			</div>

			{/* New thread button */}
			<div className="px-3 py-2">
				<button
					onClick={props.onCreateSession}
					className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-border bg-surface-2 px-3 py-1.5 text-xs text-white/70 transition hover:bg-surface-3 hover:text-white/90"
				>
					<Plus className="h-3.5 w-3.5" />
					New thread
				</button>
			</div>

			{/* Threads section label */}
			<div className="flex items-center justify-between px-4 pb-1 pt-2">
				<span className="text-2xs font-medium uppercase tracking-wider text-white/30">
					Threads
				</span>
				<span className="text-2xs text-white/20">{props.sessions.length}</span>
			</div>

			{/* Session list */}
			<div className="flex-1 overflow-auto px-2 pb-2">
				<div className="space-y-px">
					{props.sessions.map((session) => {
						const selected = session.id === props.selectedSessionId;
						return (
							<div
								key={session.id}
								className={`group relative rounded-lg transition ${
									selected
										? "bg-white/10"
										: session.archivedAt
											? "opacity-50 hover:bg-white/4"
											: "hover:bg-white/5"
								}`}
							>
								<button
									onClick={() => props.onOpenSession(session.id)}
									className="w-full px-2.5 py-2 text-left"
								>
									<div className="flex items-center gap-2">
										<span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${sessionStatusColor(session.status)}`} />
										<span className={`truncate text-xs ${session.status === "merged" ? "line-through text-white/40" : selected ? "text-white" : "text-white/75"}`}>
											{session.displayName}
										</span>
										<span className="ml-auto shrink-0 text-2xs text-white/25">
											{relativeTime(session.lastActivityAt)}
										</span>
									</div>
									<div className="mt-0.5 flex items-center gap-2 pl-3.5 text-2xs text-white/30">
										<span>{session.changedFilesCount} files</span>
										{session.unresolvedCommentCount > 0 ? (
											<span className="text-state-review">{session.unresolvedCommentCount} comments</span>
										) : null}
										{session.status === "merged" ? (
											<span className="text-state-applied">merged</span>
										) : null}
										{session.archivedAt ? (
											<span className="text-white/20">archived</span>
										) : null}
									</div>
								</button>

								{/* Context menu */}
								<div className="absolute right-1 top-1.5 opacity-0 transition group-hover:opacity-100">
									<DropdownMenu.Root>
										<DropdownMenu.Trigger className="rounded-md p-1 text-white/30 hover:bg-white/10 hover:text-white/60">
											<MoreHorizontal className="h-3.5 w-3.5" />
										</DropdownMenu.Trigger>
										<DropdownMenu.Portal>
											<DropdownMenu.Content
												className="min-w-[160px] rounded-lg border border-surface-border bg-surface-2 p-1 shadow-xl"
												sideOffset={4}
												align="end"
											>
												<DropdownMenu.Item
													className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-white/70 outline-none hover:bg-white/8"
													onSelect={() => props.onRenameSession(session)}
												>
													<Pencil className="h-3.5 w-3.5" />
													Rename
												</DropdownMenu.Item>
												<DropdownMenu.Item
													className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-white/70 outline-none hover:bg-white/8"
													onSelect={() => props.onArchiveSession(session, !session.archivedAt)}
												>
													{session.archivedAt ? (
														<>
															<ArchiveRestore className="h-3.5 w-3.5" />
															Restore
														</>
													) : (
														<>
															<Archive className="h-3.5 w-3.5" />
															Archive
														</>
													)}
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Portal>
									</DropdownMenu.Root>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Bottom: Settings */}
			<div className="border-t border-surface-border px-3 py-2">
				<button
					onClick={props.onOpenSettings}
					className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white/40 transition hover:bg-white/5 hover:text-white/60"
				>
					Settings
				</button>
			</div>
		</aside>
	);
}
