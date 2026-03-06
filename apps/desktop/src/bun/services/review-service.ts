import { parseDiff } from "react-diff-view";
import type {
	CommentAnchor,
	CommentMessageView,
	CommentThreadView,
	DiffSnapshotView,
	ReviewRoundPayload,
	ReviewRoundView,
	ReviewState,
	ReviewReplyPayload,
	ThreadStatus,
} from "../../shared/models";
import { SettingsService } from "./settings-service";
import { AppDb } from "./db";
import { CheckpointService } from "./checkpoint-service";
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
	metadata_json: string;
};

type ThreadRow = {
	id: string;
	review_round_id: string;
	session_id: string;
	file_path: string;
	anchor_json: string;
	status: ThreadStatus;
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
	dispatchReviewRound(sessionId: string, roundId: string): Promise<void>;
	dispatchThreadReply(sessionId: string, roundId: string): Promise<void>;
	applyAlignedRound(reviewRoundId: string): Promise<void>;
};

export class ReviewService {
	private runtimeBridge?: RuntimeReviewBridge;
	private sessionRefresh?: (sessionId: string) => Promise<void>;

	constructor(
		private readonly db: AppDb,
		private readonly settings: SettingsService,
		private readonly checkpoints: CheckpointService,
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
		const round = this.getReviewRound(reviewRoundId);
		if (!round) return "";
		return this.buildRoundSummaryMarkdown(round);
	}

	buildAlignedOutcome(reviewRoundId: string) {
		const round = this.getReviewRound(reviewRoundId);
		if (!round) return "";
		return this.buildAlignedOutcomeMarkdown(round);
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

	private mapRound(row: ReviewRoundRow): ReviewRoundView {
		const threads = this.getThreads(row.id);
		const unresolvedCount = threads.filter((thread) =>
			["open", "agent_replied", "needs_user", "aligned"].includes(thread.status),
		).length;
		return {
			id: row.id,
			sessionId: row.session_id,
			seq: row.seq,
			state: row.state as ReviewRoundView["state"],
			startedAt: row.started_at,
			submittedAt: row.submitted_at ?? undefined,
			alignedAt: row.aligned_at ?? undefined,
			appliedAt: row.applied_at ?? undefined,
			freezeWrites: Boolean(row.freeze_writes),
			summaryMarkdown: row.summary_markdown ?? undefined,
			unresolvedCount,
			threads,
			metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
		};
	}

	listReviewRounds(sessionId: string) {
		return this.db
			.all<ReviewRoundRow>(
				"select * from review_rounds where session_id = ? order by seq desc",
				sessionId,
			)
			.map((row) => this.mapRound(row));
	}

	getReviewRound(reviewRoundId: string) {
		const row = this.db.get<ReviewRoundRow>(
			"select * from review_rounds where id = ?",
			reviewRoundId,
		);
		return row ? this.mapRound(row) : null;
	}

	getActiveReviewRoundId(sessionId: string) {
		const row = this.db.get<{ id: string }>(
			`
			select id from review_rounds
			where session_id = ?
			  and state in ('draft', 'submitted', 'awaiting_agent', 'awaiting_user', 'aligned', 'applying')
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		return row?.id;
	}

	isFreezeActive(sessionId: string) {
		const row = this.db.get<{ state: string; freeze_writes: number }>(
			`
			select state, freeze_writes
			from review_rounds
			where session_id = ?
			  and state in ('submitted', 'awaiting_agent', 'awaiting_user')
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		return Boolean(row?.freeze_writes);
	}

	private setSessionReviewState(sessionId: string, reviewState: ReviewState) {
		this.db.run(
			"update sessions set review_state = ?, status = ?, last_activity_at = ? where id = ?",
			reviewState,
			reviewState === "aligned"
				? "aligned"
				: reviewState === "applied"
					? "completed"
					: reviewState === "pending"
						? "waiting_for_review"
						: "discussion_open",
			Date.now(),
			sessionId,
		);
	}

	ensureDraftRound(sessionId: string) {
		const existingId = this.getActiveReviewRoundId(sessionId);
		if (existingId) {
			const existing = this.getReviewRound(existingId);
			if (existing && existing.state === "draft") {
				return existing;
			}
		}
		const seq =
			(
				this.db.get<{ seq: number }>(
					"select coalesce(max(seq), 0) as seq from review_rounds where session_id = ?",
					sessionId,
				)?.seq ?? 0
			) + 1;
		const id = crypto.randomUUID();
		this.db.run(
			`
			insert into review_rounds (
				id, session_id, seq, state, started_at, freeze_writes, metadata_json
			) values (?, ?, ?, 'draft', ?, ?, ?)
			`,
			id,
			sessionId,
			seq,
			Date.now(),
			this.settings.getAppSettings().alwaysFreezeWritesDuringReview ? 1 : 0,
			JSON.stringify({}),
		);
		return this.getReviewRound(id)!;
	}

	async createThread(reviewRoundId: string, anchor: CommentAnchor, body: string) {
		const round = this.getReviewRound(reviewRoundId);
		if (!round) throw new Error("Review round not found.");
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
		this.messenger.reviewRoundUpdated(this.getReviewRound(reviewRoundId)!);
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
				"update review_rounds set state = 'awaiting_agent' where id = ?",
				thread.review_round_id,
			);
		});
		const message = this.mapMessage(
			this.db.get<MessageRow>("select * from comment_messages where id = ?", messageId)!,
		);
		const round = this.getReviewRound(thread.review_round_id)!;
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		this.messenger.reviewRoundUpdated(round);
		this.setSessionReviewState(round.sessionId, "awaiting_agent");
		await this.refreshSession(round.sessionId);
		await this.runtimeBridge?.dispatchThreadReply(round.sessionId, round.id);
		return message;
	}

	async resolveThread(threadId: string) {
		const thread = this.db.get<ThreadRow>(
			"select * from comment_threads where id = ?",
			threadId,
		);
		if (!thread) return;
		this.db.run(
			"update comment_threads set status = 'resolved', resolved_at = ?, updated_at = ? where id = ?",
			Date.now(),
			Date.now(),
			threadId,
		);
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		this.messenger.reviewRoundUpdated(this.getReviewRound(thread.review_round_id)!);
		await this.refreshSession(thread.session_id);
	}

	async reopenThread(threadId: string) {
		const thread = this.db.get<ThreadRow>(
			"select * from comment_threads where id = ?",
			threadId,
		);
		if (!thread) return;
		this.db.run(
			"update comment_threads set status = 'open', resolved_at = null, outdated_at = null, updated_at = ? where id = ?",
			Date.now(),
			threadId,
		);
		this.messenger.threadUpdated(
			this.mapThread(
				this.db.get<ThreadRow>("select * from comment_threads where id = ?", threadId)!,
			),
		);
		this.messenger.reviewRoundUpdated(this.getReviewRound(thread.review_round_id)!);
		await this.refreshSession(thread.session_id);
	}

	buildRoundPayload(reviewRoundId: string): ReviewRoundPayload {
		const round = this.getReviewRound(reviewRoundId);
		if (!round) throw new Error("Review round not found.");
		return {
			reviewRoundId: round.id,
			objective: "Address the inline review comments and align on the next patch.",
			freezeWrites: round.freezeWrites,
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

	private buildRoundSummaryMarkdown(round: ReviewRoundView) {
		const threadEntries = round.threads.map((thread) => {
			const body = thread.messages
				.map((message) => `- ${message.authorType}: ${message.bodyMarkdown}`)
				.join("\n");
			return `### ${thread.filePath}:${thread.anchor.line} (thread: ${thread.id})\n${body}`;
		});
		return [
			`# Review round ${round.seq}`,
			"",
			"You MUST respond using the **review_reply** tool. Do NOT reply in chat.",
			`Pass reviewRoundId: "${round.id}" and include a response for each thread below.`,
			"For each thread, provide: threadId, disposition (acknowledged|needs_clarification|proposed_change|decline_change), and reply text.",
			"",
			...threadEntries,
		].join("\n");
	}

	async submitReview(sessionId: string) {
		const round = this.ensureDraftRound(sessionId);
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
			set state = 'awaiting_agent', submitted_at = ?, summary_markdown = ?
			where id = ?
			`,
			Date.now(),
			this.buildRoundSummaryMarkdown(round),
			round.id,
		);
		this.setSessionReviewState(sessionId, "awaiting_agent");
		this.messenger.reviewRoundUpdated(this.getReviewRound(round.id)!);
		this.messenger.diffInvalidated({ sessionId, scope: "review_round_changes" });
		await this.runtimeBridge?.dispatchReviewRound(sessionId, round.id);
		await this.refreshSession(sessionId);
		return this.getReviewRound(round.id)!;
	}

	async markAligned(reviewRoundId: string) {
		const round = this.getReviewRound(reviewRoundId);
		if (!round) return;
		await this.checkpoints.createCheckpoint({
			sessionId: round.sessionId,
			cwd:
				this.db.get<{ cwd_path: string }>(
					"select cwd_path from sessions where id = ?",
					round.sessionId,
				)?.cwd_path ?? "",
			kind: "alignment",
		});
		this.db.transaction(() => {
			this.db.run(
				"update review_rounds set state = 'aligned', aligned_at = ? where id = ?",
				Date.now(),
				reviewRoundId,
			);
			this.db.run(
				`
				update comment_threads
				set status = case
					when status in ('resolved', 'applied') then status
					else 'aligned'
				end,
				    updated_at = ?
				where review_round_id = ?
				`,
				Date.now(),
				reviewRoundId,
			);
		});
		this.setSessionReviewState(round.sessionId, "aligned");
		this.messenger.reviewRoundUpdated(this.getReviewRound(reviewRoundId)!);
		await this.refreshSession(round.sessionId);
	}

	private buildAlignedOutcomeMarkdown(round: ReviewRoundView) {
		const alignedThreads = round.threads.filter((thread) =>
			["aligned", "open", "agent_replied", "needs_user"].includes(thread.status),
		);
		return [
			`Aligned outcome for review round ${round.seq}`,
			"",
			...alignedThreads.map((thread) => {
				const lastAgentReply = [...thread.messages]
					.reverse()
					.find((message) => message.authorType === "agent");
				return `- ${thread.filePath}:${thread.anchor.line} ${lastAgentReply?.bodyMarkdown ?? "Apply the agreed change."}`;
			}),
		].join("\n");
	}

	async applyAlignedChanges(reviewRoundId: string) {
		const round = this.getReviewRound(reviewRoundId);
		if (!round) return;
		this.db.run(
			"update review_rounds set state = 'applying' where id = ?",
			reviewRoundId,
		);
		this.db.run(
			"update sessions set status = 'applying', last_activity_at = ? where id = ?",
			Date.now(),
			round.sessionId,
		);
		this.messenger.reviewRoundUpdated(this.getReviewRound(reviewRoundId)!);
		await this.runtimeBridge?.applyAlignedRound(reviewRoundId);
	}

	async handleAgentReviewReply(sessionId: string, payload: ReviewReplyPayload) {
		const round = this.getReviewRound(payload.reviewRoundId);
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
			this.db.run(
				`
				update review_rounds
				set state = 'awaiting_user', summary_markdown = ?
				where id = ?
				`,
				payload.summary ?? round.summaryMarkdown ?? null,
				payload.reviewRoundId,
			);
		});
		this.setSessionReviewState(sessionId, "awaiting_user");
		const updatedRound = this.getReviewRound(payload.reviewRoundId)!;
		for (const thread of updatedRound.threads) {
			this.messenger.threadUpdated(thread);
		}
		this.messenger.reviewRoundUpdated(updatedRound);
		await this.refreshSession(sessionId);
	}

	async markRoundAppliedForSession(sessionId: string) {
		const round = this.db.get<{ id: string }>(
			`
			select id
			from review_rounds
			where session_id = ? and state = 'applying'
			order by seq desc
			limit 1
			`,
			sessionId,
		);
		if (!round) return;
		this.db.transaction(() => {
			this.db.run(
				"update review_rounds set state = 'applied', applied_at = ? where id = ?",
				Date.now(),
				round.id,
			);
			this.db.run(
				`
				update comment_threads
				set status = case when status = 'resolved' then status else 'applied' end,
				    updated_at = ?
				where review_round_id = ?
				`,
				Date.now(),
				round.id,
			);
		});
		this.setSessionReviewState(sessionId, "applied");
		this.messenger.reviewRoundUpdated(this.getReviewRound(round.id)!);
		await this.refreshSession(sessionId);
	}

	async reanchorThreads(sessionId: string, diff: DiffSnapshotView) {
		const threads = this.db.all<ThreadRow>(
			`
			select * from comment_threads
			where session_id = ?
			  and status in ('open', 'agent_replied', 'needs_user', 'aligned')
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
