import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
	CommandPermissionRule,
	CommandRisk,
	PathPermissionRule,
	PermissionAccess,
	PermissionPrompt,
	PermissionPromptResolution,
	PermissionPromptDecision,
	ProjectPermissionPolicy,
} from "../../shared/models";
import type { AppDb } from "./db";
import type { HostMessenger } from "./host-messenger";

const POLICY_VERSION = 1;
const POLICY_KEY_PREFIX = "permission-policy:";
const PROMPT_TIMEOUT_MS = 120_000;

type PreferenceRow = {
	value_json: string;
};

type PermissionAuthorizeParams = {
	sessionId: string;
	projectId: string;
	projectRoot: string;
	cwdPath: string;
	toolName: string;
	input: Record<string, unknown>;
};

type PermissionAuthorizeResult = {
	allow: boolean;
	reason?: string;
	userMessage?: string;
};

type CommandAssessment = {
	segment: string;
	fullTokens: string[];
	tokens: string[];
	risk: CommandRisk;
};

type AutoAllowEvaluation = {
	allow: boolean;
	nextCwdPath: string;
};

type PendingPrompt = {
	resolve: (resolution: PermissionPromptResolution) => void;
	timer: ReturnType<typeof setTimeout>;
	command?: {
		tokens: string[];
		risk: CommandRisk;
	};
	path?: {
		access: PermissionAccess;
		targetPath: string;
		scopes: Array<{
			id: string;
			path: string;
			recursive: boolean;
		}>;
	};
};

const READ_VERBS = new Set([
	"cat",
	"head",
	"tail",
	"ls",
	"list",
	"show",
	"get",
	"describe",
	"status",
	"diff",
	"log",
	"whoami",
	"pwd",
	"printenv",
]);

const WRITE_VERBS = new Set([
	"put",
	"cp",
	"mv",
	"move",
	"sync",
	"create",
	"update",
	"set",
	"apply",
	"deploy",
	"install",
	"uninstall",
	"commit",
	"push",
	"merge",
	"rebase",
	"checkout",
	"mkdir",
	"touch",
	"chmod",
	"chown",
]);

const DESTRUCTIVE_VERBS = new Set([
	"rm",
	"delete",
	"del",
	"destroy",
	"purge",
	"drop",
	"truncate",
	"terminate",
	"kill",
	"nuke",
	"wipe",
	"format",
	"mkfs",
	"remove",
]);

const DESTRUCTIVE_EXECUTABLES = new Set(["rm", "mkfs", "dd", "shutdown", "reboot"]);

const AWS_READ_OPS = new Set([
	"ls",
	"list",
	"describe",
	"get",
	"head-object",
	"head-bucket",
	"describe-instances",
	"describe-stacks",
	"show",
]);

const AWS_WRITE_OPS = new Set([
	"cp",
	"sync",
	"put-object",
	"create",
	"update",
	"start",
	"stop",
	"tag",
	"untag",
	"attach",
	"detach",
]);

const AWS_DESTRUCTIVE_OPS = new Set([
	"rm",
	"delete",
	"delete-object",
	"delete-bucket",
	"terminate-instances",
	"destroy",
	"purge",
]);

const SAFE_READ_EXECUTABLES = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"ls",
	"wc",
	"sort",
	"uniq",
	"tr",
	"cut",
	"paste",
	"column",
	"nl",
	"grep",
	"rg",
	"ag",
	"ack",
	"fgrep",
	"egrep",
	"file",
	"stat",
	"du",
	"df",
	"tree",
	"find",
	"which",
	"where",
	"type",
	"command",
	"dirname",
	"basename",
	"realpath",
	"readlink",
	"echo",
	"printf",
	"date",
	"uname",
	"id",
	"hostname",
	"arch",
	"true",
	"false",
	"test",
	"[",
	"pwd",
	"printenv",
	"whoami",
	"env",
	"jq",
	"yq",
	"md5sum",
	"sha256sum",
	"shasum",
	"cksum",
	"diff",
	"comm",
	"cmp",
	"strings",
	"od",
	"xxd",
	"hexdump",
	"sed",
	"git",
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
	"status",
	"log",
	"diff",
	"show",
	"branch",
	"tag",
	"remote",
	"rev-parse",
	"config",
	"describe",
	"shortlog",
	"reflog",
	"ls-files",
	"ls-tree",
	"ls-remote",
	"name-rev",
	"merge-base",
	"blame",
	"cat-file",
	"for-each-ref",
]);

const GIT_CONFIG_MUTATION_FLAGS = new Set([
	"--unset",
	"--unset-all",
	"--add",
	"--replace-all",
	"--rename-section",
	"--remove-section",
	"--global",
	"--system",
]);

function normalizeTokens(tokens: string[]) {
	return tokens.map((token) => token.trim().toLowerCase()).filter(Boolean);
}

export class PermissionService {
	private readonly pendingPrompts = new Map<string, PendingPrompt>();

	constructor(
		private readonly db: AppDb,
		private readonly messenger: HostMessenger,
	) {}

	private getPolicyKey(projectId: string) {
		return `${POLICY_KEY_PREFIX}${projectId}`;
	}

	private defaultPolicy(projectId: string): ProjectPermissionPolicy {
		return {
			projectId,
			version: POLICY_VERSION,
			updatedAt: Date.now(),
			commandRules: [],
			pathRules: [],
		};
	}

	private sanitizeCommandRule(rule: CommandPermissionRule): CommandPermissionRule {
		return {
			id: rule.id || crypto.randomUUID(),
			effect: rule.effect,
			tokens: normalizeTokens(rule.tokens),
			risk: rule.risk,
			createdAt: rule.createdAt || Date.now(),
		};
	}

	private sanitizePathRule(rule: PathPermissionRule): PathPermissionRule {
		const cleanedPath = resolve(rule.path);
		return {
			id: rule.id || crypto.randomUUID(),
			effect: rule.effect,
			access: rule.access,
			path: cleanedPath,
			recursive: Boolean(rule.recursive),
			createdAt: rule.createdAt || Date.now(),
		};
	}

	private sanitizePolicy(projectId: string, policy: ProjectPermissionPolicy) {
		return {
			projectId,
			version: POLICY_VERSION,
			updatedAt: Date.now(),
			commandRules: (policy.commandRules ?? []).map((rule) =>
				this.sanitizeCommandRule(rule),
			),
			pathRules: (policy.pathRules ?? []).map((rule) => this.sanitizePathRule(rule)),
		} satisfies ProjectPermissionPolicy;
	}

	getProjectPermissionPolicy(projectId: string): ProjectPermissionPolicy {
		const row = this.db.get<PreferenceRow>(
			"select value_json from ui_preferences where key = ?",
			this.getPolicyKey(projectId),
		);
		if (!row) return this.defaultPolicy(projectId);
		try {
			const parsed = JSON.parse(row.value_json) as ProjectPermissionPolicy;
			return this.sanitizePolicy(projectId, parsed);
		} catch {
			return this.defaultPolicy(projectId);
		}
	}

	updateProjectPermissionPolicy(
		projectId: string,
		policy: ProjectPermissionPolicy,
	): ProjectPermissionPolicy {
		const next = this.sanitizePolicy(projectId, policy);
		this.db.run(
			`
			insert into ui_preferences (key, value_json, updated_at)
			values (?, ?, ?)
			on conflict(key) do update set
				value_json = excluded.value_json,
				updated_at = excluded.updated_at
			`,
			this.getPolicyKey(projectId),
			JSON.stringify(next),
			Date.now(),
		);
		return next;
	}

	resolvePrompt(resolution: PermissionPromptResolution) {
		const pending = this.pendingPrompts.get(resolution.promptId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pendingPrompts.delete(resolution.promptId);
		pending.resolve(resolution);
	}

	private async waitForPromptResolution(
		prompt: PermissionPrompt,
		context: Omit<PendingPrompt, "resolve" | "timer">,
	) {
		const resolution = await new Promise<PermissionPromptResolution>((resolvePrompt) => {
			const timer = setTimeout(() => {
				this.pendingPrompts.delete(prompt.id);
				resolvePrompt({
					promptId: prompt.id,
					decision: "deny_once",
				});
			}, PROMPT_TIMEOUT_MS);
			this.pendingPrompts.set(prompt.id, {
				...context,
				resolve: resolvePrompt,
				timer,
			});
			this.messenger.permissionPrompt(prompt);
		});
		return resolution;
	}

	private isWithinRoot(targetPath: string, rootPath: string) {
		const rel = relative(resolve(rootPath), resolve(targetPath));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	}

	private extractPath(toolName: string, input: Record<string, unknown>) {
		if (!["read", "edit", "write"].includes(toolName)) return undefined;
		const raw = input.path;
		if (typeof raw !== "string" || !raw.trim()) return undefined;
		return raw;
	}

	private getPathAccess(toolName: string): PermissionAccess {
		return toolName === "read" ? "read" : "write";
	}

	private matchPathRule(
		rule: PathPermissionRule,
		access: PermissionAccess,
		targetPath: string,
	) {
		if (rule.access !== access) return false;
		const target = resolve(targetPath);
		const base = resolve(rule.path);
		if (!rule.recursive) {
			return target === base;
		}
		return target === base || target.startsWith(`${base}${sep}`);
	}

	private buildPathScopes(targetPath: string) {
		const scopes: Array<{
			id: string;
			label: string;
			path: string;
			recursive: boolean;
			description: string;
		}> = [
			{
				id: "exact",
				label: "This path only",
				path: targetPath,
				recursive: false,
				description: targetPath,
			},
		];
		let current = dirname(targetPath);
		let depth = 1;
		while (depth <= 6) {
			const parent = dirname(current);
			const label =
				depth === 1
					? "Parent folder"
					: depth === 2
						? "Grandparent folder"
						: `Ancestor +${depth - 1}`;
			scopes.push({
				id: `ancestor-${depth}`,
				label,
				path: current,
				recursive: true,
				description: `${current}${sep}**`,
			});
			if (parent === current) break;
			current = parent;
			depth += 1;
		}
		return scopes;
	}

	private splitCommandSegments(command: string) {
		const segments: string[] = [];
		let current = "";
		let inSingle = false;
		let inDouble = false;
		let escaped = false;
		for (let index = 0; index < command.length; index += 1) {
			const char = command[index];
			if (escaped) {
				current += char;
				escaped = false;
				continue;
			}
			if (char === "\\" && !inSingle) {
				escaped = true;
				continue;
			}
			if (char === "'" && !inDouble) {
				inSingle = !inSingle;
				current += char;
				continue;
			}
			if (char === '"' && !inSingle) {
				inDouble = !inDouble;
				current += char;
				continue;
			}
			if (!inSingle && !inDouble) {
				const next = command[index + 1];
				if (char === ";" || char === "\n") {
					const trimmed = current.trim();
					if (trimmed) segments.push(trimmed);
					current = "";
					continue;
				}
				if ((char === "|" && next === "|") || (char === "&" && next === "&")) {
					const trimmed = current.trim();
					if (trimmed) segments.push(trimmed);
					current = "";
					index += 1;
					continue;
				}
				if (char === "|" || char === "&") {
					const trimmed = current.trim();
					if (trimmed) segments.push(trimmed);
					current = "";
					continue;
				}
			}
			current += char;
		}
		const trimmed = current.trim();
		if (trimmed) segments.push(trimmed);
		return segments;
	}

	private firstExecutableToken(tokens: string[]) {
		let index = 0;
		while (index < tokens.length && tokens[index].includes("=")) {
			index += 1;
		}
		if (tokens[index] === "sudo") {
			index += 1;
			while (index < tokens.length && tokens[index].startsWith("-")) {
				index += 1;
			}
		}
		return index < tokens.length ? index : -1;
	}

	private extractCommandSignature(tokens: string[]) {
		if (tokens.length === 0) return [];
		const executableIndex = this.firstExecutableToken(tokens);
		if (executableIndex < 0) return [];
		const executable = tokens[executableIndex];
		const signature = [
			executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? executable.toLowerCase(),
		];
		for (
			let index = executableIndex + 1;
			index < tokens.length && signature.length < 3;
			index += 1
		) {
			const token = tokens[index];
			if (!token) break;
			if (token.startsWith("-")) continue;
			if (token.includes("=")) continue;
			if (token.includes("/") || token.includes(":")) continue;
			signature.push(token.toLowerCase());
		}
		return signature;
	}

	private classifyCommandRisk(tokens: string[], signature: string[]): CommandRisk {
		const executable = signature[0] ?? "";
		if (!executable) return "unknown";
		if (DESTRUCTIVE_EXECUTABLES.has(executable)) return "destructive";
		const actionToken = signature[2] ?? signature[1] ?? "";
		if (executable === "aws") {
			if (AWS_DESTRUCTIVE_OPS.has(actionToken)) return "destructive";
			if (AWS_WRITE_OPS.has(actionToken)) return "write";
			if (AWS_READ_OPS.has(actionToken)) return "read";
			return "unknown";
		}
		if (DESTRUCTIVE_VERBS.has(actionToken)) return "destructive";
		if (WRITE_VERBS.has(actionToken)) return "write";
		if (READ_VERBS.has(actionToken)) return "read";
		if (DESTRUCTIVE_VERBS.has(executable)) return "destructive";
		if (WRITE_VERBS.has(executable)) return "write";
		if (READ_VERBS.has(executable)) return "read";
		const loweredTokens = tokens.map((token) => token.toLowerCase());
		if (loweredTokens.some((token) => DESTRUCTIVE_VERBS.has(token))) return "destructive";
		if (loweredTokens.some((token) => WRITE_VERBS.has(token))) return "write";
		if (loweredTokens.some((token) => READ_VERBS.has(token))) return "read";
		return "unknown";
	}

	private assessCommand(command: string): CommandAssessment[] {
		const assessments: CommandAssessment[] = [];
		for (const segment of this.splitCommandSegments(command)) {
			const tokens = this.tokenizeSegment(segment);
			const signature = this.extractCommandSignature(tokens);
			if (signature.length === 0) continue;
			assessments.push({
				segment,
				fullTokens: tokens,
				tokens: signature,
				risk: this.classifyCommandRisk(tokens, signature),
			});
		}
		return assessments;
	}

	private tokenizeSegment(segment: string) {
		const tokens: string[] = [];
		let current = "";
		let inSingle = false;
		let inDouble = false;
		let escaped = false;
		for (const char of segment) {
			if (escaped) {
				current += char;
				escaped = false;
				continue;
			}
			if (char === "\\" && !inSingle) {
				escaped = true;
				continue;
			}
			if (char === "'" && !inDouble) {
				inSingle = !inSingle;
				continue;
			}
			if (char === '"' && !inSingle) {
				inDouble = !inDouble;
				continue;
			}
			if (!inSingle && !inDouble && /\s/.test(char)) {
				if (current) {
					tokens.push(current);
					current = "";
				}
				continue;
			}
			current += char;
		}
		if (current) tokens.push(current);
		return tokens;
	}


	private findMatchingCommandRule(
		policy: ProjectPermissionPolicy,
		tokens: string[],
		risk: CommandRisk,
	) {
		const normalizedTokens = normalizeTokens(tokens);
		const matching = policy.commandRules.filter(
			(rule) =>
				rule.risk === risk &&
				rule.tokens.length === normalizedTokens.length &&
				rule.tokens.every((token, index) => token === normalizedTokens[index]),
		);
		if (matching.length === 0) return undefined;
		const deny = matching.find((rule) => rule.effect === "deny");
		if (deny) return deny;
		return matching.find((rule) => rule.effect === "allow");
	}

	private appendCommandRule(
		policy: ProjectPermissionPolicy,
		effect: "allow" | "deny",
		tokens: string[],
		risk: CommandRisk,
	) {
		const normalizedTokens = normalizeTokens(tokens);
		const withoutDuplicate = policy.commandRules.filter(
			(rule) =>
				!(
					rule.risk === risk &&
					rule.tokens.length === normalizedTokens.length &&
					rule.tokens.every((token, index) => token === normalizedTokens[index])
				),
		);
		withoutDuplicate.push({
			id: crypto.randomUUID(),
			effect,
			tokens: normalizedTokens,
			risk,
			createdAt: Date.now(),
		});
		policy.commandRules = withoutDuplicate;
	}

	private appendPathRule(
		policy: ProjectPermissionPolicy,
		effect: "allow" | "deny",
		access: PermissionAccess,
		pathValue: string,
		recursive: boolean,
	) {
		const normalizedPath = resolve(pathValue);
		const withoutDuplicate = policy.pathRules.filter(
			(rule) =>
				!(
					rule.access === access &&
					rule.path === normalizedPath &&
					rule.recursive === recursive
				),
		);
		withoutDuplicate.push({
			id: crypto.randomUUID(),
			effect,
			access,
			path: normalizedPath,
			recursive,
			createdAt: Date.now(),
		});
		policy.pathRules = withoutDuplicate;
	}

	private decisionToEffect(decision: PermissionPromptDecision) {
		return decision.startsWith("allow") ? "allow" : "deny";
	}

	private async authorizePath(
		params: PermissionAuthorizeParams,
		targetPath: string,
	): Promise<PermissionAuthorizeResult> {
		const resolvedTarget = isAbsolute(targetPath)
			? resolve(targetPath)
			: resolve(params.cwdPath, targetPath);
		const defaultRoots = new Set([resolve(params.projectRoot), resolve(params.cwdPath)]);
		for (const root of defaultRoots) {
			if (this.isWithinRoot(resolvedTarget, root)) {
				return { allow: true };
			}
		}
		const access = this.getPathAccess(params.toolName);
		const policy = this.getProjectPermissionPolicy(params.projectId);
		const matchingRules = policy.pathRules
			.filter((rule) => this.matchPathRule(rule, access, resolvedTarget))
			.sort((a, b) => b.path.length - a.path.length);
		const denied = matchingRules.find((rule) => rule.effect === "deny");
		if (denied) {
			return {
				allow: false,
				reason: `Permission denied by path policy: ${denied.path}`,
			};
		}
		const allowed = matchingRules.find((rule) => rule.effect === "allow");
		if (allowed) {
			return { allow: true };
		}
		const scopes = this.buildPathScopes(resolvedTarget);
		const prompt: PermissionPrompt = {
			id: crypto.randomUUID(),
			sessionId: params.sessionId,
			projectId: params.projectId,
			toolName: params.toolName as PermissionPrompt["toolName"],
			reason: "out_of_scope_path",
			message: `${params.toolName} wants ${access} access outside the project scope.`,
			targetPath: resolvedTarget,
			pathAccess: access,
			pathScopes: scopes,
			createdAt: Date.now(),
		};
		const resolution = await this.waitForPromptResolution(prompt, {
			path: {
				access,
				targetPath: resolvedTarget,
				scopes: scopes.map((scope) => ({
					id: scope.id,
					path: scope.path,
					recursive: scope.recursive,
				})),
			},
		});
		if (resolution.decision.endsWith("once")) {
			const allow = resolution.decision.startsWith("allow");
			return {
				allow,
				reason: allow ? undefined : "Permission denied by user",
				userMessage: allow ? undefined : resolution.userMessage,
			};
		}
		const selectedScope =
			scopes.find((scope) => scope.id === resolution.selectedScopeId) ?? scopes[0];
		this.appendPathRule(
			policy,
			this.decisionToEffect(resolution.decision),
			access,
			selectedScope.path,
			selectedScope.recursive,
		);
		this.updateProjectPermissionPolicy(params.projectId, policy);
		const allow = resolution.decision.startsWith("allow");
		return {
			allow,
			reason: allow ? undefined : "Permission denied by user",
			userMessage: allow ? undefined : resolution.userMessage,
		};
	}

	private hasOutputRedirection(segment: string) {
		let inSingle = false;
		let inDouble = false;
		let escaped = false;
		for (let i = 0; i < segment.length; i += 1) {
			const char = segment[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\" && !inSingle) {
				escaped = true;
				continue;
			}
			if (char === "'" && !inDouble) {
				inSingle = !inSingle;
				continue;
			}
			if (char === '"' && !inSingle) {
				inDouble = !inDouble;
				continue;
			}
			if (!inSingle && !inDouble && char === ">") return true;
		}
		return false;
	}

	private getAllowedRoots(projectRoot: string, cwdPath: string) {
		return Array.from(new Set([resolve(projectRoot), resolve(cwdPath)]));
	}

	private isWithinAllowedRoots(targetPath: string, roots: string[]) {
		return roots.some((root) => this.isWithinRoot(targetPath, root));
	}

	private stripAllowedReadOnlyRedirectionTokens(tokens: string[]) {
		const filteredTokens: string[] = [];
		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index];
			if (token === "2>" || token === "2>>") {
				const nextToken = tokens[index + 1];
				if (nextToken === "/dev/null") {
					index += 1;
					continue;
				}
				return undefined;
			}
			if (token === "2>/dev/null" || token === "2>>/dev/null") {
				continue;
			}
			if (token.includes(">")) {
				return undefined;
			}
			filteredTokens.push(token);
		}
		return filteredTokens;
	}

	private hasUnsafeShellExpansion(token: string) {
		return token === "~" || token === "-" || token.includes("$") || token.includes("`");
	}

	private evaluateAutoAllowableCd(
		argsAfterExec: string[],
		allowedRoots: string[],
		cwdPath: string,
	): AutoAllowEvaluation {
		if (argsAfterExec.length !== 1) {
			return { allow: false, nextCwdPath: cwdPath };
		}
		const targetToken = argsAfterExec[0];
		if (
			!targetToken ||
			targetToken.startsWith("-") ||
			this.hasUnsafeShellExpansion(targetToken)
		) {
			return { allow: false, nextCwdPath: cwdPath };
		}
		const resolvedTarget = isAbsolute(targetToken)
			? resolve(targetToken)
			: resolve(cwdPath, targetToken);
		if (!this.isWithinAllowedRoots(resolvedTarget, allowedRoots)) {
			return { allow: false, nextCwdPath: cwdPath };
		}
		return { allow: true, nextCwdPath: resolvedTarget };
	}

	private evaluateSegmentAutoAllowable(
		assessment: CommandAssessment,
		projectRoot: string,
		cwdPath: string,
	): AutoAllowEvaluation {
		const { segment } = assessment;
		let fullTokens = assessment.fullTokens;

		// Reject output redirection
		if (this.hasOutputRedirection(segment)) {
			const sanitizedTokens = this.stripAllowedReadOnlyRedirectionTokens(fullTokens);
			if (!sanitizedTokens) {
				return { allow: false, nextCwdPath: cwdPath };
			}
			fullTokens = sanitizedTokens;
		}

		// Find the executable, rejecting sudo
		const execIndex = this.firstExecutableToken(fullTokens);
		if (execIndex < 0) return { allow: false, nextCwdPath: cwdPath };

		// Check for sudo — even for read-only commands, sudo changes security context
		for (let i = 0; i < execIndex; i += 1) {
			if (fullTokens[i] === "sudo") {
				return { allow: false, nextCwdPath: cwdPath };
			}
		}

		const executable =
			fullTokens[execIndex].split(/[\\/]/).at(-1)?.toLowerCase() ??
			fullTokens[execIndex].toLowerCase();

		// --version special case: any executable + only --version is safe
		const argsAfterExec = fullTokens.slice(execIndex + 1);
		if (
			argsAfterExec.length === 1 &&
			argsAfterExec[0] === "--version"
		) {
			return { allow: true, nextCwdPath: cwdPath };
		}

		const allowedRoots = this.getAllowedRoots(projectRoot, cwdPath);
		if (executable === "cd") {
			return this.evaluateAutoAllowableCd(argsAfterExec, allowedRoots, cwdPath);
		}

		// Check if executable is in the safe set
		if (!SAFE_READ_EXECUTABLES.has(executable)) {
			return { allow: false, nextCwdPath: cwdPath };
		}

		// Git: check subcommand
		if (executable === "git") {
			const subcommand = argsAfterExec.find((t) => !t.startsWith("-"));
			if (!subcommand || !SAFE_GIT_SUBCOMMANDS.has(subcommand)) {
				return { allow: false, nextCwdPath: cwdPath };
			}

			// git config: reject mutation flags and set operations
			if (subcommand === "config") {
				if (argsAfterExec.some((t) => GIT_CONFIG_MUTATION_FLAGS.has(t))) {
					return { allow: false, nextCwdPath: cwdPath };
				}
				// 3+ positional args after "config" means a set operation (key + value)
				const positional = argsAfterExec.filter(
					(t) => !t.startsWith("-") && t !== "config",
				);
				if (positional.length >= 2) {
					return { allow: false, nextCwdPath: cwdPath };
				}
			}

			// git stash: only allow "list" and "show"
			if (subcommand === "stash") {
				const stashAction = argsAfterExec.find(
					(t) => !t.startsWith("-") && t !== "stash",
				);
				if (!stashAction || !["list", "show"].includes(stashAction)) {
					return { allow: false, nextCwdPath: cwdPath };
				}
			}

			// git worktree: only allow "list"
			if (subcommand === "worktree") {
				const worktreeAction = argsAfterExec.find(
					(t) => !t.startsWith("-") && t !== "worktree",
				);
				if (worktreeAction !== "list") {
					return { allow: false, nextCwdPath: cwdPath };
				}
			}
		}

		// sed: reject -i / --in-place
		if (executable === "sed") {
			if (
				argsAfterExec.some(
					(t) => t === "-i" || t === "--in-place" || t.startsWith("-i"),
				)
			)
				return { allow: false, nextCwdPath: cwdPath };
		}

		// Check path scope: all non-flag positional arguments are resolved and
		// verified to be within projectRoot or cwdPath. Bare filenames resolve
		// relative to cwdPath (which is in-scope), but we check explicitly to
		// be defensive. Known non-path arguments (e.g. grep patterns) are hard
		// to distinguish from filenames, so we check them all — a pattern like
		// "foo" resolves to cwdPath/foo which is in-scope, so this is safe.
		for (let i = execIndex + 1; i < fullTokens.length; i += 1) {
			const token = fullTokens[i];
			if (token.startsWith("-")) continue;
			if (token.includes("=")) continue;
			// For git subcommands, skip the subcommand token itself and
			// non-path-like tokens (branch names, refs, patterns, etc.)
			if (executable === "git") continue;
			const resolved = isAbsolute(token) ? resolve(token) : resolve(cwdPath, token);
			if (!this.isWithinAllowedRoots(resolved, allowedRoots)) {
				return { allow: false, nextCwdPath: cwdPath };
			}
		}

		return { allow: true, nextCwdPath: cwdPath };
	}

	private async authorizeCommand(
		params: PermissionAuthorizeParams,
		command: string,
	): Promise<PermissionAuthorizeResult> {
		const policy = this.getProjectPermissionPolicy(params.projectId);
		const assessments = this.assessCommand(command);
		if (assessments.length === 0) {
			return {
				allow: false,
				reason: "Unable to parse command for permission check.",
			};
		}

		let effectiveCwdPath = params.cwdPath;
		let allAutoAllowable = true;
		for (const assessment of assessments) {
			const evaluation = this.evaluateSegmentAutoAllowable(
				assessment,
				params.projectRoot,
				effectiveCwdPath,
			);
			if (!evaluation.allow) {
				allAutoAllowable = false;
				break;
			}
			effectiveCwdPath = evaluation.nextCwdPath;
		}
		if (allAutoAllowable) {
			return { allow: true };
		}

		for (const assessment of assessments) {
			const match = this.findMatchingCommandRule(
				policy,
				assessment.tokens,
				assessment.risk,
			);
			if (match?.effect === "deny") {
				return {
					allow: false,
					reason: `Permission denied by command policy: ${assessment.tokens.join(" ")}`,
				};
			}
			if (match?.effect === "allow") {
				continue;
			}
			const prompt: PermissionPrompt = {
				id: crypto.randomUUID(),
				sessionId: params.sessionId,
				projectId: params.projectId,
				toolName: "bash",
				reason: "unknown_command",
				message: "This command is not allowlisted yet.",
				command: assessment.segment,
				commandTokens: assessment.tokens,
				commandRisk: assessment.risk,
				createdAt: Date.now(),
			};
			const resolution = await this.waitForPromptResolution(prompt, {
				command: {
					tokens: assessment.tokens,
					risk: assessment.risk,
				},
			});
			if (resolution.decision.endsWith("once")) {
				if (resolution.decision.startsWith("deny")) {
					return {
						allow: false,
						reason: "Permission denied by user",
						userMessage: resolution.userMessage,
					};
				}
				continue;
			}
			this.appendCommandRule(
				policy,
				this.decisionToEffect(resolution.decision),
				assessment.tokens,
				assessment.risk,
			);
			this.updateProjectPermissionPolicy(params.projectId, policy);
			if (resolution.decision.startsWith("deny")) {
				return {
					allow: false,
					reason: "Permission denied by user",
					userMessage: resolution.userMessage,
				};
			}
		}
		return { allow: true };
	}

	async authorizeToolCall(
		params: PermissionAuthorizeParams,
	): Promise<PermissionAuthorizeResult> {
		if (params.toolName === "bash") {
			const command = params.input.command;
			if (typeof command !== "string" || !command.trim()) {
				return {
					allow: false,
					reason: "Permission denied: invalid command payload.",
				};
			}
			return this.authorizeCommand(params, command);
		}
		const targetPath = this.extractPath(params.toolName, params.input);
		if (targetPath) {
			return this.authorizePath(params, targetPath);
		}
		return { allow: true };
	}
}
