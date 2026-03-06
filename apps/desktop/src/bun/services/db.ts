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
  kind text not null check (kind in (
    'baseline','pre_turn','post_turn','review_start','alignment','manual'
  )),
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
