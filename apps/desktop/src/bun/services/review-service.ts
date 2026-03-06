import { parseDiff } from "react-diff-view";
import type {
	CommentAnchor,
	CommentMessageView,
	CommentThreadView,
	DiffMode,
	DiffSnapshotView,
	ReviewRoundPayload,
	RevisionView,
	ReviewState,
	ReviewReplyPayload,
	ThreadResolution,
	ThreadStatus,
} from "../../shared/models";
import { AppDb } from "./db";
import { CheckpointService } from "./checkpoint-service";
import { GitService } from "./git-service";
import type { HostMessenger } from "./host-messenger";

type ReviewRoundRow = {
	id: string;
	session_id: string;
	seq: number;
	state: string;
	started_at: number;
	submitted_at: number | null;
	aligned_at: number | null;
	applied_at: number | null;
	freeze_writes: number;
	summary_markdown: string | null;
	checkpoint_id: string | null;
	baseline_checkpoint_id: string | null;
	approved_at: number | null;
	metadata_json: string;
};

type ThreadRow = {
	id: string;
	review_round_id: string;
	session_id: string;
	file_path: string;
	anchor_json: string;
	status: ThreadStatus;
	resolution: string | null;
	created_at: number;
	updated_at: number;
	resolved_at: number | null;
	outdated_at: number | null;
	metadata_json: string;
};

type MessageRow = {
	id: string;
	thread_id: string;
	author_type: "user" | "agent" | "system";
	body_markdown: string;
	created_at: number;
	delivery_mode: "immediate" | "steer" | "follow_up" | "system" | null;
	metadata_json: string;
};

type RuntimeReviewBridge = {
	dispatchDiscussion(sessionId: string, roundId: string): Promise<void>;
	dispatchThreadReply(sessionId: string, roundId: string): Promise<void>;
	dispatchAddressThis(sessionId: string, roundId: string, prompt: string): Promise<void>;
};

export class ReviewService {
	private runtimeBridge?: RuntimeReviewBridge;
	private sessionRefresh?: (sessionId: string) => Promise<void>;

	constructor(
		private readonly db: AppDb,
		private readonly checkpoints: CheckpointService,
		private readonly git: GitService,
		private readonly messenger: HostMessenger,
	) {}

	setRuntimeBridge(runtimeBridge: RuntimeReviewBridge) {
		this.runtimeBridge = runtimeBridge;
	}

	setSessionRefresh(refresh: (sessionId: string) => Promise<void>) {
		this.sessionRefresh = refresh;
	}

	private async refreshSession(sessionId: string) {
		if (this.sessionRefresh) {
			await this.sessionRefresh(sessionId);
		}
	}

	buildReviewMarkdown(reviewRoundId: string) {
		const round = this.getRevision(reviewRoundId);
		if (!round) return "";
		return this.buildRoundSummaryMarkdown(round);
	}

	getSessionIdByReviewRound(reviewRoundId: string) {
		return (
			this.db.get<{ session_id: string }>(
				"select session_id from review_rounds where id = ?",
				reviewRoundId,
			)?.session_id
		);
	}

	private mapMessage(row: MessageRow): CommentMessageView {
		return {
			id: row.id,
			threadId: row.thread_id,
			authorType: row.author_type,
			bodyMarkdown: row.body_markdown,
			createdAt: row.created_at,
			deliveryMode: row.delivery_mode ?? undefined,
			metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
		};
	}

	private getThreadMessages(threadId: string) {
		return this.db
			.all<MessageRow>(
				"select * from comment_messages where thread_id = ? order by created_at asc",
				threadId,
			)
			.map((row) => this.mapMessage(row));
	}

	private mapThread(row: ThreadRow): CommentThreadView {
		return {
			id: row.id,
			reviewRoundId: row.review_round_id,
			sessionId: row.session_id,
			filePath: row.file_path,
			anchor: JSON.parse(row.anchor_json) as CommentAnchor,
			status: row.status,
			resolution: (row.resolution as ThreadResolution) ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			resolvedAt: row.resolved_at ?? undefined,
			outdatedAt: row.outdated_at ?? undefined,
			metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
			messages: this.getThreadMessages(row.id),
		};
	}

	private getThreads(reviewRoundId: string) {
		return this.db
			.all<ThreadRow>(
				"select * from comment_threads where review_round_id = ? order by created_at asc",
				reviewRoundId,
			)
			.map((row) => this.mapThread(row));
	}

	private mapRevision(row: ReviewRoundRow): RevisionView {
		const threads = this.getThreads(row.id);
		const unresolvedCount = threads.filter((thread) =>
			["open", "agent_replied", "needs_user"].includes(thread.status),
		).length;
		const addressThisCount = threads.filter((t) => t.resolution === "address_this").length;
		const noChangesCount = threads.filter((t) => t.resolution === "no_changes").length;
		return {
			id: row.id,
			sessionId: row.session_id,
			revisionNumber: row.seq,
			state: row.state as RevisionView["state"],
			startedAt: row.started_at,
			checkpointId: row.checkpoint_id ?? undefined,
			baselineCheckpointId: row.baseline_checkpoint_id ?? undefined,
			approvedAt: row.approved_at ?? undefined,
			summaryMarkdown: row.summary_markdown ?? undefined,
			addressThisCount,
			noChangesCount,
			unresolvedCount,
			threads,
			metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
		};
	}

	listRevisions(sessionId: string) {
		return this.db
			.all<ReviewRoundRow>(
				"select * from review_rounds where session_id = ? order by seq asc",
				sessionId,
			)
			.map((row) => this.mapRevision(row));
	}

	getRevision(revisionId: string) {
		const row = this.db.get<ReviewRoundRow>(
			"select * from review_rounds where id = ?",
			revisionId,
		);
		return row ? this.mapRevision(row) : null;
	}

	getRevisionByNumber(sessionId: string, revisionNumber: number) {
		const row = this.db.get<ReviewRoundRow>(
			"select * from review_rounds where session_id = ? and seq = ?",
			sessionId,
			revisionNumber,
		);
		return row ? this.mapRevision(row) : null;
	}

	getActiveRevisionNumber(sessionId: string): number | undefined {
		const row = this.db.get<{ seq: number }>(
			`
			select seq from review_rounds
			where session_id = ?
			  and state in ('active', 'discussing', 'resolved')
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		return row?.seq;
	}

	getActiveRevisionId(sessionId: string): string | undefined {
		const row = this.db.get<{ id: string }>(
			`
			select id from review_rounds
			where session_id = ?
			  and state in ('active', 'discussing', 'resolved')
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		return row?.id;
	}

	isFreezeActive(sessionId: string) {
		const row = this.db.get<{ state: string }>(
			`
			select state
			from review_rounds
			where session_id = ?
			  and state = 'discussing'
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		return Boolean(row);
	}

	private setSessionReviewState(sessionId: string, reviewState: ReviewState) {
		const statusMap: Record<string, string> = {
			reviewing: "reviewing",
			discussing: "reviewing",
			resolved: "reviewing",
			approved: "idle",
			none: "idle",
		};
		this.db.run(
			"update sessions set review_state = ?, status = ?, last_activity_at = ? where id = ?",
			reviewState,
			statusMap[reviewState] ?? "idle",
			Date.now(),
			sessionId,
		);
	}

	ensureActiveRevision(sessionId: string) {
		const existingNumber = this.getActiveRevisionNumber(sessionId);
		if (existingNumber !== undefined) {
			return this.getRevisionByNumber(sessionId, existingNumber)!;
		}
		const seq =
			(
				this.db.get<{ seq: number }>(
					"select coalesce(max(seq), 0) as seq from review_rounds where session_id = ?",
					sessionId,
				)?.seq ?? 0
			) + 1;
		const id = crypto.randomUUID();
		const baselineCheckpoint = this.checkpoints.getLatestCheckpoint(sessionId, "baseline");
		this.db.run(
			`
			insert into review_rounds (
				id, session_id, seq, state, started_at, freeze_writes, baseline_checkpoint_id, metadata_json
			) values (?, ?, ?, 'active', ?, 1, ?, ?)
			`,
			id,
			sessionId,
			seq,
			Date.now(),
			baselineCheckpoint?.id ?? null,
			JSON.stringify({}),
		);
		this.setSessionReviewState(sessionId, "reviewing");
		return this.getRevision(id)!;
	}

	async createThread(reviewRoundId: string, anchor: CommentAnchor, body: string) {
		const round = this.getRevision(reviewRoundId);
		if (!round) throw new Error("Revision not found.");
		const id = crypto.randomUUID();
		const now = Date.now();
		this.db.transaction(() => {
			this.db.run(
				`
				insert into comment_threads (
					id, review_round_id, session_id, file_path, anchor_json, status, created_at, updated_at, metadata_json
				) values (?, ?, ?, ?, ?, 'open', ?, ?, ?)
				`,
				id,
				reviewRoundId,
				round.sessionId,
				anchor.filePath,
				JSON.stringify(anchor),
				now,
				now,
				JSON.stringify({}),
			);
			this.db.run(
				`
				insert into comment_messages (
					id, thread_id, author_type, body_markdown, created_at, delivery_mode, metadata_json
				) values (?, ?, 'user', ?, ?, 'immediate', ?)
				`,
				crypto.randomUUID(),
				id,
				body,
				now,
				JSON.stringify({}),
			);
		});
		const thread = this.mapThread(
			this.db.get<ThreadRow>("select * from comment_threads where id = ?", id)!,
		);
		this.messenger.threadUpdated(thread);
		this.messenger.revisionUpdated(this.getRevision(reviewRoundId)!);
		await this.refreshSession(round.sessionId);
		return thread;
	}

	async replyToThread(threadId: string, body: string) {
		const thread = this.db.get<ThreadRow>(
			"select * from comment_threads where id = ?",
			threadId,
		);
		if (!thread) throw new Error("Comment thread not found.");
		const messageId = crypto.randomUUID();
		const now = Date.now();
		this.db.transaction(() => {
			this.db.run(
				`
				insert into comment_messages (
					id, thread_id, author_type, body_markdown, created_at, delivery_mode, metadata_json
				) values (?, ?, 'user', ?, ?, 'immediate', ?)
				`,
				messageId,
				threadId,
				body,
				now,
				JSON.stringify({}),
			);
			this.db.run(
				"update comment_threads set status = 'open', updated_at = ? where id = ?",
				now,
				threadId,
			);
			this.db.run(
				"update review_rounds set state = 'discussing' where id = ?",
				thread.review_round_id,
			);
		});
		const message = this.mapMessage(
			this.db.get<MessageRow>("select * from comment_messages where id = ?", messageId)!,
		);
		const revision = this.getRevision(thread.review_round_id)!;
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		this.messenger.revisionUpdated(revision);
		this.setSessionReviewState(revision.sessionId, "discussing");
		await this.refreshSession(revision.sessionId);
		await this.runtimeBridge?.dispatchThreadReply(revision.sessionId, revision.id);
		return message;
	}

	async resolveThread(threadId: string, resolution: ThreadResolution) {
		const thread = this.db.get<ThreadRow>(
			"select * from comment_threads where id = ?",
			threadId,
		);
		if (!thread) return;
		this.db.run(
			"update comment_threads set status = 'resolved', resolution = ?, resolved_at = ?, updated_at = ? where id = ?",
			resolution,
			Date.now(),
			Date.now(),
			threadId,
		);
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		// Check if all threads are resolved
		if (this.allThreadsResolved(thread.review_round_id)) {
			this.db.run(
				"update review_rounds set state = 'resolved' where id = ? and state in ('active', 'discussing')",
				thread.review_round_id,
			);
			this.setSessionReviewState(thread.session_id, "resolved");
		}
		this.messenger.revisionUpdated(this.getRevision(thread.review_round_id)!);
		await this.refreshSession(thread.session_id);
	}

	async reopenThread(threadId: string) {
		const thread = this.db.get<ThreadRow>(
			"select * from comment_threads where id = ?",
			threadId,
		);
		if (!thread) return;
		this.db.run(
			"update comment_threads set status = 'open', resolution = null, resolved_at = null, outdated_at = null, updated_at = ? where id = ?",
			Date.now(),
			threadId,
		);
		// If revision was resolved, go back to active/discussing
		const revision = this.getRevision(thread.review_round_id);
		if (revision && revision.state === "resolved") {
			this.db.run(
				"update review_rounds set state = 'active' where id = ?",
				thread.review_round_id,
			);
			this.setSessionReviewState(thread.session_id, "reviewing");
		}
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		this.messenger.revisionUpdated(this.getRevision(thread.review_round_id)!);
		await this.refreshSession(thread.session_id);
	}

	allThreadsResolved(revisionId: string): boolean {
		const count = this.db.get<{ cnt: number }>(
			`select count(*) as cnt from comment_threads
			 where review_round_id = ? and status not in ('resolved', 'outdated')`,
			revisionId,
		);
		return (count?.cnt ?? 0) === 0;
	}

	buildRoundPayload(reviewRoundId: string): ReviewRoundPayload {
		const round = this.getRevision(reviewRoundId);
		if (!round) throw new Error("Revision not found.");
		return {
			reviewRoundId: round.id,
			objective: "Address the inline review comments.",
			freezeWrites: true,
			threads: round.threads.map((thread) => ({
				threadId: thread.id,
				filePath: thread.filePath,
				anchor: thread.anchor,
				comments: thread.messages.map((message) => ({
					author: message.authorType,
					body: message.bodyMarkdown,
					createdAt: message.createdAt,
				})),
			})),
		};
	}

	private buildRoundSummaryMarkdown(round: RevisionView) {
		const threadEntries = round.threads.map((thread) => {
			const body = thread.messages
				.map((message) => `- ${message.authorType}: ${message.bodyMarkdown}`)
				.join("\n");
			return `### ${thread.filePath}:${thread.anchor.line} (thread: ${thread.id})\n${body}`;
		});
		return [
			`# Review — Revision ${round.revisionNumber}`,
			"",
			"You MUST respond using the **review_reply** tool. Do NOT reply in chat.",
			`Pass reviewRoundId: "${round.id}" and include a response for each thread below.`,
			"For each thread, provide: threadId, disposition (acknowledged|needs_clarification|proposed_change|decline_change), and reply text.",
			"",
			...threadEntries,
		].join("\n");
	}

	async publishComments(sessionId: string) {
		const revision = this.ensureActiveRevision(sessionId);
		if (revision.threads.length === 0) {
			throw new Error("No comments to publish.");
		}
		const cwdPath = this.db.get<{ cwd_path: string }>(
			"select cwd_path from sessions where id = ?",
			sessionId,
		)?.cwd_path;
		if (cwdPath) {
			await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: cwdPath,
				kind: "review_start",
			});
		}
		this.db.run(
			`
			update review_rounds
			set state = 'discussing', submitted_at = ?, summary_markdown = ?
			where id = ?
			`,
			Date.now(),
			this.buildRoundSummaryMarkdown(revision),
			revision.id,
		);
		this.setSessionReviewState(sessionId, "discussing");
		this.messenger.revisionUpdated(this.getRevision(revision.id)!);
		this.messenger.diffInvalidated({ sessionId });
		await this.runtimeBridge?.dispatchDiscussion(sessionId, revision.id);
		await this.refreshSession(sessionId);
		return this.getRevision(revision.id)!;
	}

	async approveRevision(sessionId: string) {
		const revisionNumber = this.getActiveRevisionNumber(sessionId);
		if (revisionNumber === undefined) {
			// No active revision — could be approving with no comments
			// Create a revision and immediately approve it
			const revision = this.ensureActiveRevision(sessionId);
			this.db.run(
				"update review_rounds set state = 'approved', approved_at = ? where id = ?",
				Date.now(),
				revision.id,
			);
			this.setSessionReviewState(sessionId, "approved");
			this.messenger.revisionUpdated(this.getRevision(revision.id)!);
			await this.refreshSession(sessionId);
			return;
		}
		const revision = this.getRevisionByNumber(sessionId, revisionNumber)!;
		const cwdPath = this.db.get<{ cwd_path: string }>(
			"select cwd_path from sessions where id = ?",
			sessionId,
		)?.cwd_path;
		if (cwdPath) {
			await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: cwdPath,
				kind: "revision",
			});
		}
		this.db.run(
			"update review_rounds set state = 'approved', approved_at = ? where id = ?",
			Date.now(),
			revision.id,
		);
		this.setSessionReviewState(sessionId, "approved");
		this.messenger.revisionUpdated(this.getRevision(revision.id)!);
		await this.refreshSession(sessionId);
	}

	buildAddressThisPrompt(revisionId: string): string {
		const revision = this.getRevision(revisionId);
		if (!revision) return "";
		const addressThreads = revision.threads.filter((t) => t.resolution === "address_this");
		if (addressThreads.length === 0) return "";
		const parts = addressThreads.map((thread) => {
			const discussion = thread.messages
				.map((m) => `  - ${m.authorType}: ${m.bodyMarkdown}`)
				.join("\n");
			return `### ${thread.filePath}:${thread.anchor.line}\n${discussion}`;
		});
		return [
			`# Implement changes for Revision ${revision.revisionNumber + 1}`,
			"",
			"The user has reviewed your changes and marked the following threads as needing changes.",
			"Implement the requested changes based on the discussion below.",
			"",
			...parts,
		].join("\n");
	}

	async startNextRevision(sessionId: string) {
		const currentNumber = this.getActiveRevisionNumber(sessionId);
		if (currentNumber === undefined) {
			throw new Error("No active revision to advance from.");
		}
		const current = this.getRevisionByNumber(sessionId, currentNumber)!;
		const cwdPath = this.db.get<{ cwd_path: string }>(
			"select cwd_path from sessions where id = ?",
			sessionId,
		)?.cwd_path;

		// Create a checkpoint for the current state before starting next revision
		let checkpointId: string | undefined;
		if (cwdPath) {
			const cp = await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: cwdPath,
				kind: "revision",
			});
			checkpointId = cp?.id;
		}

		// Mark current revision as superseded
		this.db.run(
			"update review_rounds set state = 'superseded', checkpoint_id = ? where id = ?",
			checkpointId ?? null,
			current.id,
		);

		// Build the prompt from address_this threads
		const prompt = this.buildAddressThisPrompt(current.id);

		// Create new revision
		const newSeq = currentNumber + 1;
		const newId = crypto.randomUUID();
		this.db.run(
			`
			insert into review_rounds (
				id, session_id, seq, state, started_at, freeze_writes, baseline_checkpoint_id, metadata_json
			) values (?, ?, ?, 'active', ?, 1, ?, ?)
			`,
			newId,
			sessionId,
			newSeq,
			Date.now(),
			checkpointId ?? null,
			JSON.stringify({}),
		);

		this.setSessionReviewState(sessionId, "reviewing");
		this.messenger.revisionUpdated(this.getRevision(current.id)!);
		this.messenger.revisionUpdated(this.getRevision(newId)!);
		this.messenger.diffInvalidated({ sessionId });

		// Dispatch the address_this prompt to the agent
		if (prompt) {
			await this.runtimeBridge?.dispatchAddressThis(sessionId, newId, prompt);
		}

		await this.refreshSession(sessionId);
		return this.getRevision(newId)!;
	}

	async applyRevision(sessionId: string) {
		const cwdPath = this.db.get<{ cwd_path: string }>(
			"select cwd_path from sessions where id = ?",
			sessionId,
		)?.cwd_path;
		if (cwdPath) {
			await this.git.commitWorktreeChanges(cwdPath, "Apply approved revision");
		}
		this.db.run(
			"update sessions set status = 'completed', last_activity_at = ? where id = ?",
			Date.now(),
			sessionId,
		);
		await this.refreshSession(sessionId);
	}

	async applyAndMerge(sessionId: string, commitMessage?: string) {
		const row = this.db.get<{
			cwd_path: string;
			worktree_path: string | null;
			worktree_branch: string | null;
			base_ref: string | null;
			project_id: string;
			mode: string;
		}>(
			"select cwd_path, worktree_path, worktree_branch, base_ref, project_id, mode from sessions where id = ?",
			sessionId,
		);
		if (!row) throw new Error("Session not found.");

		// Commit changes
		await this.git.commitWorktreeChanges(row.cwd_path, commitMessage || "Apply approved revision");

		// Merge if worktree mode
		if (row.mode === "worktree" && row.worktree_branch && row.base_ref) {
			const projectRow = this.db.get<{ root_path: string }>(
				"select root_path from projects where id = ?",
				row.project_id,
			);
			if (projectRow) {
				await this.git.mergeWorktreeBranch({
					repoRoot: projectRow.root_path,
					worktreeBranch: row.worktree_branch,
					baseBranch: row.base_ref,
				});
			}
		}

		this.db.run(
			"update sessions set status = 'merged', last_activity_at = ? where id = ?",
			Date.now(),
			sessionId,
		);
		await this.refreshSession(sessionId);
	}

	async buildRevisionDiff(
		sessionId: string,
		revisionNumber: number,
		mode: DiffMode,
	): Promise<DiffSnapshotView> {
		const revision = this.getRevisionByNumber(sessionId, revisionNumber);
		const cwdPath = this.db.get<{ cwd_path: string }>(
			"select cwd_path from sessions where id = ?",
			sessionId,
		)?.cwd_path;
		if (!cwdPath) throw new Error("Session not found.");

		let fromRef: string | undefined;
		let toRef: string | undefined;
		let fromLabel: string;
		let toLabel: string;
		let title: string;

		if (mode === "cumulative") {
			// Baseline → current revision (or working tree)
			const baseline = this.checkpoints.getLatestCheckpoint(sessionId, "baseline");
			fromRef = baseline?.gitTree;
			fromLabel = "Baseline";

			if (revision?.state === "superseded" && revision.checkpointId) {
				const cp = this.checkpoints.getCheckpoint(revision.checkpointId);
				toRef = cp?.gitTree;
				toLabel = `Rev ${revisionNumber}`;
			} else {
				const wt = await this.git.captureWorkingTree(cwdPath);
				toRef = wt.tree;
				toLabel = "Working tree";
			}
			title = `Cumulative — Rev ${revisionNumber}`;
		} else {
			// Incremental: previous revision checkpoint → current
			if (revisionNumber > 1) {
				const prevRevision = this.getRevisionByNumber(sessionId, revisionNumber - 1);
				if (prevRevision?.checkpointId) {
					const cp = this.checkpoints.getCheckpoint(prevRevision.checkpointId);
					fromRef = cp?.gitTree;
				} else if (prevRevision?.baselineCheckpointId) {
					const cp = this.checkpoints.getCheckpoint(prevRevision.baselineCheckpointId);
					fromRef = cp?.gitTree;
				}
			} else {
				const baseline = this.checkpoints.getLatestCheckpoint(sessionId, "baseline");
				fromRef = baseline?.gitTree;
			}
			fromLabel = revisionNumber > 1 ? `Rev ${revisionNumber - 1}` : "Baseline";

			if (revision?.state === "superseded" && revision.checkpointId) {
				const cp = this.checkpoints.getCheckpoint(revision.checkpointId);
				toRef = cp?.gitTree;
				toLabel = `Rev ${revisionNumber}`;
			} else {
				const wt = await this.git.captureWorkingTree(cwdPath);
				toRef = wt.tree;
				toLabel = "Working tree";
			}
			title = `Incremental — Rev ${revisionNumber}`;
		}

		if (!fromRef || !toRef) {
			// Return empty diff
			return this.checkpoints.storeDiffSnapshot({
				sessionId,
				scope: "session_changes",
				title,
				description: `${mode} diff for revision ${revisionNumber}`,
				fromLabel,
				toLabel,
				patch: "",
				stats: { filesChanged: 0, additions: 0, deletions: 0, fileStats: [] },
			});
		}

		const diff = await this.git.diffBetweenRefs(cwdPath, fromRef, toRef);
		const snapshot = this.checkpoints.storeDiffSnapshot({
			sessionId,
			scope: "session_changes",
			title,
			description: `${mode} diff for revision ${revisionNumber}`,
			fromLabel,
			toLabel,
			patch: diff.patch,
			stats: diff.stats,
		});
		// Add revision metadata
		return {
			...snapshot,
			revisionNumber,
			diffMode: mode,
		};
	}

	async handleAgentReviewReply(sessionId: string, payload: ReviewReplyPayload) {
		const round = this.getRevision(payload.reviewRoundId);
		if (!round) return;
		this.db.transaction(() => {
			for (const threadReply of payload.threads) {
				const thread = this.db.get<ThreadRow>(
					"select * from comment_threads where id = ?",
					threadReply.threadId,
				);
				if (!thread) continue;
				this.db.run(
					`
					insert into comment_messages (
						id, thread_id, author_type, body_markdown, created_at, delivery_mode, metadata_json
					) values (?, ?, 'agent', ?, ?, 'system', ?)
					`,
					crypto.randomUUID(),
					threadReply.threadId,
					threadReply.reply,
					Date.now(),
					JSON.stringify({
						disposition: threadReply.disposition,
						plan: threadReply.plan ?? [],
					}),
				);
				this.db.run(
					"update comment_threads set status = 'needs_user', updated_at = ? where id = ?",
					Date.now(),
					threadReply.threadId,
				);
			}
			// Stay in discussing state — threads need resolution
			this.db.run(
				`
				update review_rounds
				set summary_markdown = ?
				where id = ?
				`,
				payload.summary ?? round.summaryMarkdown ?? null,
				payload.reviewRoundId,
			);
		});
		this.setSessionReviewState(sessionId, "discussing");
		const updatedRound = this.getRevision(payload.reviewRoundId)!;
		for (const thread of updatedRound.threads) {
			this.messenger.threadUpdated(thread);
		}
		this.messenger.revisionUpdated(updatedRound);
		await this.refreshSession(sessionId);
	}

	async reanchorThreads(sessionId: string, diff: DiffSnapshotView) {
		const threads = this.db.all<ThreadRow>(
			`
			select * from comment_threads
			where session_id = ?
			  and status in ('open', 'agent_replied', 'needs_user')
			`,
			sessionId,
		);
		if (threads.length === 0) return;
		const files = parseDiff(diff.patch);
		for (const row of threads) {
			const anchor = JSON.parse(row.anchor_json) as CommentAnchor;
			const file = files.find(
				(candidate) =>
					candidate.newPath === anchor.filePath || candidate.oldPath === anchor.filePath,
			);
			if (!file) {
				this.db.run(
					"update comment_threads set status = 'outdated', outdated_at = ?, updated_at = ? where id = ?",
					Date.now(),
					Date.now(),
					row.id,
				);
				continue;
			}
			let matched = false;
			for (const hunk of file.hunks) {
				for (const change of hunk.changes) {
					const changeText = change.content.slice(1);
					if (changeText === anchor.targetLineText.trim()) {
						const nextAnchor: CommentAnchor = {
							...anchor,
							hunkHeader: hunk.content,
							line:
								anchor.side === "new"
									? ("lineNumber" in change
											? (change.lineNumber ?? anchor.line)
											: anchor.line)
									: ("oldLineNumber" in change
											? (change.oldLineNumber ?? anchor.line)
											: anchor.line),
							checkpointId: diff.toCheckpointId ?? anchor.checkpointId,
							diffSnapshotId: diff.id,
						};
						this.db.run(
							"update comment_threads set anchor_json = ?, updated_at = ?, outdated_at = null where id = ?",
							JSON.stringify(nextAnchor),
							Date.now(),
							row.id,
						);
						matched = true;
						break;
					}
				}
				if (matched) break;
			}
			if (!matched) {
				this.db.run(
					"update comment_threads set status = 'outdated', outdated_at = ?, updated_at = ? where id = ?",
					Date.now(),
					Date.now(),
					row.id,
				);
			}
		}
	}
}
