import { useState } from "react";
import { ChevronRight, AlertCircle, Copy, Check } from "lucide-react";
import type {
	CheckpointSummaryView,
	SessionInspectorView,
	SessionSummary,
	SessionTreeNodeView,
} from "@shared/models";

function formatTreeNode(node: SessionTreeNodeView, depth = 0): string {
	const indent = "  ".repeat(depth);
	const marker = node.isCurrent ? "▸ " : "  ";
	const type = node.type.replace(/_/g, " ");
	const label = node.label ?? type;
	const lines = [`${indent}${marker}${label}${node.isCurrent ? " (current)" : ""}`];
	if (node.summary) {
		lines.push(`${indent}    ${node.summary}`);
	}
	for (const child of node.children) {
		lines.push(formatTreeNode(child, depth + 1));
	}
	return lines.join("\n");
}

function formatTree(tree: SessionTreeNodeView[]): string {
	return tree.map((node) => formatTreeNode(node)).join("\n");
}

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
				className={`border-l-2 px-2.5 py-1.5 ${
					props.node.isCurrent
						? "border-accent bg-accent-soft"
						: "border-transparent hover:bg-white/3"
				}`}
				style={{ marginLeft: `${depth * 12}px` }}
			>
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<div className="truncate text-xs text-white/70">
							{props.node.label ?? props.node.type.replace(/_/g, " ")}
						</div>
						<div className="mt-0.5 truncate text-2xs text-white/30">{props.node.summary}</div>
					</div>
					<span className="shrink-0 text-2xs text-white/20">
						{props.node.isCurrent ? "current" : props.node.type}
					</span>
				</div>
			</div>
			{props.node.children.length > 0 ? (
				<div className="space-y-px">
					{props.node.children.map((child) => (
						<TreeNode key={child.id} node={child} depth={depth + 1} />
					))}
				</div>
			) : null}
		</div>
	);
}

function TreeSection(props: { tree?: SessionTreeNodeView[] }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!props.tree?.length) return;
		await navigator.clipboard.writeText(formatTree(props.tree));
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div>
			<div className="mb-1.5 flex items-center justify-between">
				<div className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wider text-white/30">
					<ChevronRight className="h-3 w-3" />
					Session tree
				</div>
				{props.tree?.length ? (
					<button
						onClick={() => void handleCopy()}
						className="flex items-center gap-1 text-2xs text-white/30 transition hover:text-white/60"
						title="Copy session tree"
					>
						{copied ? (
							<>
								<Check className="h-3 w-3" />
								Copied
							</>
						) : (
							<>
								<Copy className="h-3 w-3" />
								Copy
							</>
						)}
					</button>
				) : null}
			</div>
			<div className="max-h-[280px] space-y-px overflow-auto">
				{props.tree?.length ? (
					props.tree.map((node) => (
						<TreeNode key={node.id} node={node} />
					))
				) : (
					<div className="py-2 text-2xs text-white/20">
						Tree data appears after recording starts.
					</div>
				)}
			</div>
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
			{/* Inspector header */}
			<div className="border-b border-surface-border pb-2.5">
				<div className="flex items-center justify-between">
					<span className="text-2xs font-medium uppercase tracking-wider text-white/30">
						Inspector
					</span>
					<button
						disabled={!canCheckpoint}
						onClick={() => void props.onCreateManualCheckpoint()}
						className="text-2xs text-accent/70 transition hover:text-accent disabled:cursor-not-allowed disabled:text-white/15"
					>
						Checkpoint
					</button>
				</div>
				<div className="mt-1 text-xs font-medium text-white/60">
					{props.session.worktreeBranch ?? "Local workspace"}
				</div>
				<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-2xs text-white/30">
					<dt>Mode</dt>
					<dd className="truncate">{props.session.mode}</dd>
					<dt>Base</dt>
					<dd className="truncate">{props.session.baseRef ?? "HEAD"}</dd>
					<dt>Path</dt>
					<dd className="truncate mono">{props.session.worktreePath ?? props.session.cwdPath}</dd>
					{props.inspector?.sessionFile ? (
						<>
							<dt>File</dt>
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
					<div className="mt-2 flex items-center justify-between bg-state-error/10 px-2.5 py-1.5 text-xs text-state-error">
						<span className="flex items-center gap-1.5">
							<AlertCircle className="h-3 w-3" />
							Worktree missing
						</span>
						<button
							onClick={() => void props.onRepairWorktree()}
							className="text-2xs underline underline-offset-2"
						>
							Repair
						</button>
					</div>
				) : null}
			</div>

			{/* Checkpoints */}
			<div>
				<div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-white/30">
					Checkpoints
				</div>
				<div className="space-y-px">
					{props.inspector?.checkpoints.length ? (
						props.inspector.checkpoints.slice(0, 8).map((checkpoint) => (
							<div
								key={checkpoint.id}
								className="flex items-center justify-between px-1 py-1 hover:bg-white/3"
							>
								<div>
									<div className="text-xs text-white/50">
										{checkpointLabel(checkpoint.kind)}
									</div>
									<div className="truncate mono text-2xs text-white/20">
										{checkpoint.gitTree ?? checkpoint.gitHead ?? checkpoint.id}
									</div>
								</div>
								<span className="shrink-0 text-2xs text-white/20">
									{new Date(checkpoint.createdAt).toLocaleTimeString([], {
										hour: "numeric",
										minute: "2-digit",
									})}
								</span>
							</div>
						))
					) : (
						<div className="py-2 text-2xs text-white/20">
							No checkpoints yet.
						</div>
					)}
				</div>
			</div>

			{/* Tree */}
			<TreeSection tree={props.inspector?.tree} />
		</div>
	);
}
