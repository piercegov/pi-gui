import {
	existsSync,
	mkdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DiffFileStat, DiffStats } from "../../shared/models";
import { appPaths, sanitizeBranchSegment } from "./app-paths";

type ProcessResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export class GitService {
	private async run(
		command: string[],
		options: {
			cwd: string;
			env?: Record<string, string | undefined>;
			allowFailure?: boolean;
		},
	): Promise<ProcessResult> {
		const proc = Bun.spawn(command, {
			cwd: options.cwd,
			env: {
				...process.env,
				...options.env,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0 && !options.allowFailure) {
			throw new Error(
				stderr.trim() || `${command.join(" ")} exited with code ${exitCode}`,
			);
		}
		return { stdout, stderr, exitCode };
	}

	async isGitRepo(path: string) {
		const result = await this.run(
			["git", "rev-parse", "--is-inside-work-tree"],
			{ cwd: path, allowFailure: true },
		);
		return result.exitCode === 0 && result.stdout.trim() === "true";
	}

	async resolveRepoRoot(path: string) {
		const result = await this.run(
			["git", "rev-parse", "--show-toplevel"],
			{ cwd: path },
		);
		return result.stdout.trim();
	}

	async getCurrentHead(path: string) {
		const result = await this.run(
			["git", "rev-parse", "--verify", "HEAD"],
			{ cwd: path, allowFailure: true },
		);
		return result.exitCode === 0 ? result.stdout.trim() : undefined;
	}

	async getCurrentBranch(path: string) {
		const result = await this.run(
			["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
			{ cwd: path, allowFailure: true },
		);
		return result.exitCode === 0 ? result.stdout.trim() : undefined;
	}

	async getDefaultBaseRef(path: string) {
		return (await this.getCurrentBranch(path)) ?? (await this.getCurrentHead(path));
	}

	async createWorktree(params: {
		repoRoot: string;
		worktreePath: string;
		baseRef: string;
		branchName: string;
	}) {
		mkdirSync(dirname(params.worktreePath), { recursive: true });
		const addWithBranch = await this.run(
			[
				"git",
				"worktree",
				"add",
				"-b",
				params.branchName,
				params.worktreePath,
				params.baseRef,
			],
			{ cwd: params.repoRoot, allowFailure: true },
		);
		if (addWithBranch.exitCode !== 0) {
			await this.run(
				["git", "worktree", "add", params.worktreePath, params.branchName],
				{ cwd: params.repoRoot },
			);
		}
	}

	async ensureWorktree(params: {
		repoRoot: string;
		worktreePath: string;
		baseRef: string;
		branchName: string;
	}) {
		if (existsSync(join(params.worktreePath, ".git"))) return;
		await this.createWorktree(params);
	}

	buildSessionBranchName(projectName: string, sessionId: string) {
		return `pi/${sanitizeBranchSegment(projectName)}/${sanitizeBranchSegment(
			sessionId,
		).slice(0, 12)}`;
	}

	getManagedWorktreePath(projectId: string, sessionId: string, projectName: string) {
		return join(
			appPaths.worktreesDir,
			projectId,
			`${sanitizeBranchSegment(projectName)}-${sanitizeBranchSegment(sessionId).slice(0, 8)}`,
		);
	}

	async captureWorkingTree(cwd: string) {
		mkdirSync(appPaths.tempDir, { recursive: true });
		const tempIndexPath = join(appPaths.tempDir, `${crypto.randomUUID()}.index`);
		writeFileSync(tempIndexPath, "");
		const env = {
			GIT_INDEX_FILE: tempIndexPath,
		};
		try {
			const head = await this.getCurrentHead(cwd);
			if (head) {
				await this.run(["git", "read-tree", "HEAD"], { cwd, env });
			} else {
				await this.run(["git", "read-tree", "--empty"], { cwd, env });
			}
			await this.run(["git", "add", "-A"], { cwd, env });
			const tree = await this.run(["git", "write-tree"], { cwd, env });
			return {
				head,
				tree: tree.stdout.trim(),
			};
		} finally {
			if (existsSync(tempIndexPath)) {
				unlinkSync(tempIndexPath);
			}
		}
	}

	private parseNameStatus(output: string) {
		const map = new Map<string, { type: DiffFileStat["type"]; oldPath?: string }>();
		for (const line of output.split("\n")) {
			if (!line.trim()) continue;
			const [statusToken, firstPath, secondPath] = line.split("\t");
			const status = statusToken[0];
			const type =
				status === "A"
					? "add"
					: status === "D"
						? "delete"
						: status === "R"
							? "rename"
							: status === "C"
								? "copy"
								: "modify";
			const path = secondPath ?? firstPath;
			map.set(path, {
				type,
				oldPath: secondPath ? firstPath : undefined,
			});
		}
		return map;
	}

	private parseNumstat(
		output: string,
		typeMap: Map<string, { type: DiffFileStat["type"]; oldPath?: string }>,
	) {
		const files: DiffFileStat[] = [];
		let additions = 0;
		let deletions = 0;
		for (const line of output.split("\n")) {
			if (!line.trim()) continue;
			const [addedRaw, deletedRaw, ...pathBits] = line.split("\t");
			const parsedPath = pathBits[pathBits.length - 1];
			const added = addedRaw === "-" ? 0 : Number(addedRaw);
			const deleted = deletedRaw === "-" ? 0 : Number(deletedRaw);
			const status = typeMap.get(parsedPath);
			files.push({
				path: parsedPath,
				additions: added,
				deletions: deleted,
				type: status?.type ?? "modify",
				oldPath: status?.oldPath,
			});
			additions += added;
			deletions += deleted;
		}
		return {
			filesChanged: files.length,
			additions,
			deletions,
			fileStats: files,
		} satisfies DiffStats;
	}

	private async diffWithArgs(
		cwd: string,
		diffArgs: string[],
		nameStatusArgs: string[],
		numstatArgs: string[],
	) {
		const [patchResult, nameStatusResult, numstatResult] = await Promise.all([
			this.run(["git", ...diffArgs], { cwd }),
			this.run(["git", ...nameStatusArgs], { cwd }),
			this.run(["git", ...numstatArgs], { cwd }),
		]);
		const typeMap = this.parseNameStatus(nameStatusResult.stdout);
		const stats = this.parseNumstat(numstatResult.stdout, typeMap);
		return {
			patch: patchResult.stdout,
			stats,
			files: stats.fileStats,
		};
	}

	async diffBetweenRefs(cwd: string, fromRef: string, toRef: string) {
		return this.diffWithArgs(
			cwd,
			["diff", "--patch", "--find-renames", "--find-copies", "-U3", fromRef, toRef],
			["diff", "--name-status", "--find-renames", "--find-copies", fromRef, toRef],
			["diff", "--numstat", "--find-renames", "--find-copies", fromRef, toRef],
		);
	}

	async diffAgainstWorkingTree(cwd: string, fromRef: string) {
		const current = await this.captureWorkingTree(cwd);
		return {
			...(await this.diffBetweenRefs(cwd, fromRef, current.tree)),
			toTree: current.tree,
		};
	}

	async stagedDiff(cwd: string) {
		return this.diffWithArgs(
			cwd,
			["diff", "--cached", "--patch", "--find-renames", "--find-copies", "-U3"],
			["diff", "--cached", "--name-status", "--find-renames", "--find-copies"],
			["diff", "--cached", "--numstat", "--find-renames", "--find-copies"],
		);
	}

	async unstagedDiff(cwd: string) {
		return this.diffWithArgs(
			cwd,
			["diff", "--patch", "--find-renames", "--find-copies", "-U3"],
			["diff", "--name-status", "--find-renames", "--find-copies"],
			["diff", "--numstat", "--find-renames", "--find-copies"],
		);
	}

	async getGitStatus(cwd: string) {
		const result = await this.run(["git", "status", "--porcelain"], {
			cwd,
			allowFailure: true,
		});
		if (result.exitCode !== 0) {
			return {
				changedFiles: 0,
				stagedFiles: 0,
				unstagedFiles: 0,
			};
		}
		const changed = new Set<string>();
		let staged = 0;
		let unstaged = 0;
		for (const line of result.stdout.split("\n")) {
			if (!line.trim()) continue;
			const status = line.slice(0, 2);
			const path = line.slice(3).split(" -> ").at(-1) ?? line.slice(3);
			changed.add(path);
			if (status[0] !== " " && status[0] !== "?") staged += 1;
			if (status[1] !== " ") unstaged += 1;
		}
		return {
			changedFiles: changed.size,
			stagedFiles: staged,
			unstagedFiles: unstaged,
		};
	}

	async revealMissingWorktree(path: string) {
		return !existsSync(join(path, ".git"));
	}

	cleanupWorktree(path: string) {
		if (existsSync(path)) {
			rmSync(path, { recursive: true, force: true });
		}
	}

	async restoreToTree(cwd: string, treeHash: string) {
		await this.run(["git", "read-tree", "--reset", "-u", treeHash], { cwd });
	}

	getProjectNameFromPath(rootPath: string) {
		return basename(rootPath);
	}
}
