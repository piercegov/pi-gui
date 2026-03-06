import type {
	CheckpointSummaryView,
	SessionInspectorView,
	SessionSummary,
	SessionTreeNodeView,
} from "@shared/models";

function checkpointLabel(kind: CheckpointSummaryView["kind"]) {
	return kind.replace(/_/g, " ");
}

function TreeNode(props: {
	node: SessionTreeNodeView;
	depth?: number;
}) {
	const depth = props.depth ?? 0;
	return (
		<div>
			<div
				className={`rounded-xl border px-3 py-2 ${
					props.node.isCurrent
						? "border-[color:var(--accent)]/30 bg-[color:var(--accent-soft)]"
						: "border-black/5 bg-white/75"
				}`}
				style={{ marginLeft: `${depth * 12}px` }}
			>
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="truncate text-sm font-medium text-black/80">
							{props.node.label ?? props.node.type.replace(/_/g, " ")}
						</div>
						<div className="mt-1 text-xs text-black/50">{props.node.summary}</div>
					</div>
					<div className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-black/40">
						{props.node.isCurrent ? "Current" : props.node.type}
					</div>
				</div>
			</div>
			{props.node.children.length > 0 ? (
				<div className="mt-2 space-y-2">
					{props.node.children.map((child) => (
						<TreeNode key={child.id} node={child} depth={depth + 1} />
					))}
				</div>
			) : null}
		</div>
	);
}

export function SessionInspector(props: {
	session?: SessionSummary;
	inspector?: SessionInspectorView;
	onCreateManualCheckpoint: () => Promise<void>;
	onRepairWorktree: () => Promise<void>;
}) {
	if (!props.session) return null;
	const canCheckpoint = Boolean(
		props.session.baseRef ||
			props.session.worktreeBranch ||
			props.inspector?.checkpoints.length,
	);

	return (
		<div className="space-y-3 pb-3">
			<div className="rounded-2xl border border-black/10 bg-white/75 p-3">
				<div className="flex items-center justify-between gap-3">
					<div>
						<div className="text-xs uppercase tracking-[0.18em] text-black/45">
							Session inspector
						</div>
						<div className="mt-1 text-sm font-semibold text-black/80">
							{props.session.worktreeBranch ?? "Local workspace"}
						</div>
					</div>
					<button
						disabled={!canCheckpoint}
						onClick={() => void props.onCreateManualCheckpoint()}
						className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-black/65 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
					>
						Checkpoint
					</button>
				</div>
				<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-black/55">
					<dt>Mode</dt>
					<dd className="truncate">{props.session.mode}</dd>
					<dt>Base</dt>
					<dd className="truncate">{props.session.baseRef ?? "HEAD"}</dd>
					<dt>Path</dt>
					<dd className="truncate mono">{props.session.worktreePath ?? props.session.cwdPath}</dd>
					{props.inspector?.sessionFile ? (
						<>
							<dt>Session file</dt>
							<dd className="truncate mono">{props.inspector.sessionFile}</dd>
						</>
					) : null}
					{props.inspector?.parentSessionPath ? (
						<>
							<dt>Parent</dt>
							<dd className="truncate mono">{props.inspector.parentSessionPath}</dd>
						</>
					) : null}
				</dl>
				{props.inspector?.worktreeMissing ? (
					<div className="mt-3 flex items-center justify-between rounded-xl border border-[color:var(--state-error)]/20 bg-[color:var(--state-error)]/5 px-3 py-2 text-sm text-[color:var(--state-error)]">
						<span>Managed worktree is missing.</span>
						<button
							onClick={() => void props.onRepairWorktree()}
							className="rounded-full border border-current/20 px-2.5 py-1 text-xs"
						>
							Repair
						</button>
					</div>
				) : null}
			</div>

			<div className="rounded-2xl border border-black/10 bg-white/70 p-3">
				<div className="text-xs uppercase tracking-[0.18em] text-black/45">
					Recent checkpoints
				</div>
				<div className="mt-3 space-y-2">
					{props.inspector?.checkpoints.length ? (
						props.inspector.checkpoints.slice(0, 8).map((checkpoint) => (
							<div
								key={checkpoint.id}
								className="rounded-xl border border-black/5 bg-white/80 px-3 py-2"
							>
								<div className="flex items-center justify-between gap-3">
									<div className="text-sm font-medium text-black/75">
										{checkpointLabel(checkpoint.kind)}
									</div>
									<div className="text-[11px] uppercase tracking-[0.14em] text-black/40">
										{new Date(checkpoint.createdAt).toLocaleTimeString([], {
											hour: "numeric",
											minute: "2-digit",
										})}
									</div>
								</div>
								<div className="mt-1 truncate mono text-[11px] text-black/45">
									{checkpoint.gitTree ?? checkpoint.gitHead ?? checkpoint.id}
								</div>
							</div>
						))
					) : (
						<div className="rounded-xl border border-dashed border-black/10 px-3 py-3 text-sm text-black/45">
							No checkpoints captured yet.
						</div>
					)}
				</div>
			</div>

			<div className="rounded-2xl border border-black/10 bg-white/70 p-3">
				<div className="text-xs uppercase tracking-[0.18em] text-black/45">
					Session tree
				</div>
				<div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
					{props.inspector?.tree.length ? (
						props.inspector.tree.map((node) => (
							<TreeNode key={node.id} node={node} />
						))
					) : (
						<div className="rounded-xl border border-dashed border-black/10 px-3 py-3 text-sm text-black/45">
							Tree data will appear after the session starts recording entries.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
