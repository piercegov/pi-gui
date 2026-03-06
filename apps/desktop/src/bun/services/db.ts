import { Database, type SQLQueryBindings } from "bun:sqlite";
import { ensureAppPaths, appPaths } from "./app-paths";

const SCHEMA_SQL = `
pragma foreign_keys = on;

create table if not exists projects (
  id text primary key,
  name text not null,
  root_path text not null unique,
  is_git integer not null,
  created_at integer not null,
  last_opened_at integer,
  archived_at integer,
  preferred_editor text,
  default_base_ref text,
  metadata_json text not null default '{}'
);

create table if not exists sessions (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  pi_session_id text not null,
  pi_session_file text,
  display_name text,
  cwd_path text not null,
  mode text not null check (mode in ('worktree','local')),
  worktree_path text,
  worktree_branch text,
  base_ref text,
  baseline_kind text not null check (baseline_kind in ('git_commit','git_tree','snapshot')),
  baseline_value text not null,
  status text not null,
  review_state text not null,
  created_at integer not null,
  last_activity_at integer not null,
  archived_at integer,
  metadata_json text not null default '{}'
);

create table if not exists turns (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  turn_index integer not null,
  started_at integer not null,
  ended_at integer,
  agent_start_event_json text,
  turn_end_event_json text,
  assistant_message_entry_id text,
  checkpoint_before_id text,
  checkpoint_after_id text,
  unique(session_id, turn_index)
);

create table if not exists checkpoints (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  kind text not null,
  turn_id text references turns(id) on delete set null,
  git_head text,
  git_tree text,
  manifest_path text,
  patch_path text,
  stats_json text not null default '{}',
  created_at integer not null,
  parent_checkpoint_id text
);

create table if not exists diff_snapshots (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  scope text not null,
  from_checkpoint_id text,
  to_checkpoint_id text,
  from_ref text,
  to_ref text,
  patch_path text not null,
  stats_json text not null default '{}',
  created_at integer not null
);

create table if not exists review_rounds (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  seq integer not null,
  state text not null,
  started_at integer not null,
  submitted_at integer,
  aligned_at integer,
  applied_at integer,
  freeze_writes integer not null default 1,
  summary_markdown text,
  outcome_message_entry_id text,
  checkpoint_id text,
  baseline_checkpoint_id text,
  approved_at integer,
  metadata_json text not null default '{}',
  unique(session_id, seq)
);

create table if not exists comment_threads (
  id text primary key,
  review_round_id text not null references review_rounds(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  file_path text not null,
  anchor_json text not null,
  status text not null,
  resolution text,
  created_at integer not null,
  updated_at integer not null,
  resolved_at integer,
  outdated_at integer,
  metadata_json text not null default '{}'
);

create table if not exists comment_messages (
  id text primary key,
  thread_id text not null references comment_threads(id) on delete cascade,
  author_type text not null check (author_type in ('user','agent','system')),
  body_markdown text not null,
  created_at integer not null,
  delivery_mode text,
  metadata_json text not null default '{}'
);

create table if not exists ui_preferences (
  key text primary key,
  value_json text not null,
  updated_at integer not null
);
`;

export class AppDb {
	readonly sqlite: Database;

	constructor() {
		ensureAppPaths();
		this.sqlite = new Database(appPaths.dbPath, { create: true });
		this.sqlite.exec(SCHEMA_SQL);
		this.runMigrations();
	}

	private runMigrations() {
		const currentVersion = this.getSchemaVersion();

		// Migration: add columns that might be missing from old schema
		if (currentVersion < 1) {
			// Add new columns safely (they exist in SCHEMA_SQL for fresh installs)
			this.addColumnIfMissing("review_rounds", "checkpoint_id", "TEXT");
			this.addColumnIfMissing("review_rounds", "baseline_checkpoint_id", "TEXT");
			this.addColumnIfMissing("review_rounds", "approved_at", "INTEGER");
			this.addColumnIfMissing("comment_threads", "resolution", "TEXT");

			// Migrate old review_rounds state values to new revision states
			this.sqlite.exec(`
				UPDATE review_rounds SET state = 'discussing'
				WHERE state IN ('draft', 'submitted', 'awaiting_agent', 'awaiting_user');

				UPDATE review_rounds SET state = 'approved'
				WHERE state IN ('aligned', 'applying', 'applied');

				UPDATE review_rounds SET state = 'superseded'
				WHERE state = 'obsolete';
			`);

			// Migrate old session status values
			this.sqlite.exec(`
				UPDATE sessions SET status = 'reviewing'
				WHERE status IN ('waiting_for_review', 'discussion_open', 'aligned');

				UPDATE sessions SET review_state = 'reviewing'
				WHERE review_state IN ('pending', 'open');

				UPDATE sessions SET review_state = 'discussing'
				WHERE review_state IN ('awaiting_agent', 'awaiting_user');

				UPDATE sessions SET review_state = 'approved'
				WHERE review_state IN ('aligned', 'applied');

				UPDATE sessions SET review_state = 'none'
				WHERE review_state = 'obsolete';
			`);

			// Migrate old thread statuses
			this.sqlite.exec(`
				UPDATE comment_threads SET status = 'resolved'
				WHERE status IN ('aligned', 'applied');
			`);

			this.setSchemaVersion(1);
		}

		if (currentVersion < 2) {
			// Drop old CHECK constraint on checkpoints.kind that didn't include 'revision'
			const tableInfo = this.get<{ sql: string }>(
				"SELECT sql FROM sqlite_master WHERE type='table' AND name='checkpoints'",
			);
			if (tableInfo?.sql?.includes("check")) {
				this.sqlite.exec(`
					CREATE TABLE checkpoints_new (
						id text primary key,
						session_id text not null references sessions(id) on delete cascade,
						kind text not null,
						turn_id text references turns(id) on delete set null,
						git_head text,
						git_tree text,
						manifest_path text,
						patch_path text,
						stats_json text not null default '{}',
						created_at integer not null,
						parent_checkpoint_id text
					);
					INSERT INTO checkpoints_new SELECT * FROM checkpoints;
					DROP TABLE checkpoints;
					ALTER TABLE checkpoints_new RENAME TO checkpoints;
				`);
			}
			this.setSchemaVersion(2);
		}
	}

	private getSchemaVersion(): number {
		const row = this.get<{ value_json: string }>(
			"SELECT value_json FROM ui_preferences WHERE key = 'schema_version'",
		);
		if (!row) return 0;
		try {
			return JSON.parse(row.value_json) as number;
		} catch {
			return 0;
		}
	}

	private setSchemaVersion(version: number) {
		this.run(
			`INSERT INTO ui_preferences (key, value_json, updated_at)
			 VALUES ('schema_version', ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
			JSON.stringify(version),
			Date.now(),
		);
	}

	private addColumnIfMissing(table: string, column: string, type: string) {
		try {
			this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
		} catch {
			// Column already exists
		}
	}

	all<T>(sql: string, ...params: SQLQueryBindings[]) {
		return this.sqlite.query(sql).all(...params) as T[];
	}

	get<T>(sql: string, ...params: SQLQueryBindings[]) {
		return this.sqlite.query(sql).get(...params) as T | null;
	}

	run(sql: string, ...params: SQLQueryBindings[]) {
		this.sqlite.query(sql).run(...params);
	}

	transaction<T>(fn: () => T) {
		return this.sqlite.transaction(fn)();
	}
}
