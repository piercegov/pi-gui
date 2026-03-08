import { basename } from "node:path";
import type { ProjectSummary } from "../../shared/models";
import { AppDb } from "./db";
import { GitService } from "./git-service";

type ProjectRow = {
	id: string;
	name: string;
	root_path: string;
	is_git: number;
	default_base_ref: string | null;
	last_opened_at: number | null;
	metadata_json: string;
	session_count: number;
	archived_session_count: number;
};

export class ProjectService {
	constructor(
		private readonly db: AppDb,
		private readonly git: GitService,
	) {}

	private toSummary(row: ProjectRow): ProjectSummary {
		return {
			id: row.id,
			name: row.name,
			rootPath: row.root_path,
			isGit: Boolean(row.is_git),
			defaultBaseRef: row.default_base_ref ?? undefined,
			lastOpenedAt: row.last_opened_at ?? undefined,
			sessionCount: row.session_count,
			archivedSessionCount: row.archived_session_count,
			metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
		};
	}

	listProjects() {
		const rows = this.db.all<ProjectRow>(
			`
			select
				p.id,
				p.name,
				p.root_path,
				p.is_git,
				p.default_base_ref,
				p.last_opened_at,
				p.metadata_json,
				sum(case when s.archived_at is null then 1 else 0 end) as session_count,
				sum(case when s.archived_at is not null then 1 else 0 end) as archived_session_count
			from projects p
			left join sessions s on s.project_id = p.id
			where p.archived_at is null
			group by p.id
			order by coalesce(p.last_opened_at, 0) desc, p.name asc
			`,
		);
		return rows.map((row) => this.toSummary(row));
	}

	getProject(projectId: string) {
		const row = this.db.get<ProjectRow>(
			`
			select
				p.id,
				p.name,
				p.root_path,
				p.is_git,
				p.default_base_ref,
				p.last_opened_at,
				p.metadata_json,
				sum(case when s.archived_at is null then 1 else 0 end) as session_count,
				sum(case when s.archived_at is not null then 1 else 0 end) as archived_session_count
			from projects p
			left join sessions s on s.project_id = p.id
			where p.id = ?
			group by p.id
			`,
			projectId,
		);
		return row ? this.toSummary(row) : null;
	}

	async addProject(path: string) {
		const now = Date.now();
		const isGit = await this.git.isGitRepo(path);
		const defaultBaseRef = isGit ? await this.git.getDefaultBaseRef(path) : undefined;
		const id = crypto.randomUUID();
		this.db.run(
			`
			insert into projects (
				id, name, root_path, is_git, created_at, last_opened_at, default_base_ref, metadata_json
			) values (?, ?, ?, ?, ?, ?, ?, ?)
			on conflict(root_path) do update set
				name = excluded.name,
				is_git = excluded.is_git,
				last_opened_at = excluded.last_opened_at,
				default_base_ref = excluded.default_base_ref
			`,
			id,
			basename(path),
			path,
			isGit ? 1 : 0,
			now,
			now,
			defaultBaseRef ?? null,
			JSON.stringify({ addedFromApp: true }),
		);
		const existing = this.db.get<{ id: string }>(
			"select id from projects where root_path = ?",
			path,
		);
		if (!existing) {
			throw new Error("Failed to persist project.");
		}
		return this.getProject(existing.id)!;
	}

	removeProject(projectId: string) {
		this.db.run("delete from projects where id = ?", projectId);
	}

	markOpened(projectId: string) {
		this.db.run(
			"update projects set last_opened_at = ? where id = ?",
			Date.now(),
			projectId,
		);
	}

	updateDefaultBaseRef(projectId: string, baseRef?: string) {
		this.db.run(
			"update projects set default_base_ref = ? where id = ?",
			baseRef ?? null,
			projectId,
		);
	}

	updateProjectMetadata(projectId: string, patch: Record<string, unknown>) {
		const existing = this.db.get<{ metadata_json: string }>(
			"select metadata_json from projects where id = ?",
			projectId,
		);
		if (!existing) throw new Error("Project not found.");
		const current = JSON.parse(existing.metadata_json || "{}") as Record<string, unknown>;
		const merged = { ...current, ...patch };
		this.db.run(
			"update projects set metadata_json = ? where id = ?",
			JSON.stringify(merged),
			projectId,
		);
		return this.getProject(projectId)!;
	}
}
