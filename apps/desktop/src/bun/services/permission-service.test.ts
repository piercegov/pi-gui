import { describe, expect, test } from "bun:test";
import type {
	PermissionPrompt,
	ProjectPermissionPolicy,
} from "../../shared/models";
import { PermissionService } from "./permission-service";

class FakeDb {
	private readonly store = new Map<string, string>();

	get<T>(sql: string, key: string): T | null {
		if (!sql.includes("select value_json from ui_preferences where key = ?")) {
			return null;
		}
		const value = this.store.get(key);
		if (!value) return null;
		return { value_json: value } as T;
	}

	run(sql: string, key: string, value: string): void {
		if (!sql.includes("insert into ui_preferences")) return;
		this.store.set(key, value);
	}
}

function createHarness() {
	const prompts: PermissionPrompt[] = [];
	const messenger = {
		permissionPrompt(prompt: PermissionPrompt) {
			prompts.push(prompt);
		},
	};
	const service = new PermissionService(
		new FakeDb() as unknown as ConstructorParameters<typeof PermissionService>[0],
		messenger as unknown as ConstructorParameters<typeof PermissionService>[1],
	);
	const base = {
		sessionId: "session-1",
		projectId: "project-1",
		projectRoot: "/repo",
		cwdPath: "/repo",
	};
	return { service, prompts, base };
}

async function waitForPrompt(prompts: PermissionPrompt[], index: number) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const prompt = prompts[index];
		if (prompt) return prompt;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error(`Timed out waiting for prompt at index ${index}`);
}

describe("PermissionService", () => {
	test("allows in-scope read without prompting", async () => {
		const { service, prompts, base } = createHarness();
		const result = await service.authorizeToolCall({
			...base,
			toolName: "read",
			input: { path: "src/app.tsx" },
		});
		expect(result.allow).toBe(true);
		expect(prompts.length).toBe(0);
	});

	test("out-of-scope read with allow_once does not persist", async () => {
		const { service, prompts, base } = createHarness();
		const firstRequest = service.authorizeToolCall({
			...base,
			toolName: "read",
			input: { path: "/tmp/outside/file-a.txt" },
		});
		const prompt1 = await waitForPrompt(prompts, 0);
		service.resolvePrompt({
			promptId: prompt1.id,
			decision: "allow_once",
			selectedScopeId: "exact",
		});
		const firstResult = await firstRequest;
		expect(firstResult.allow).toBe(true);

		const secondRequest = service.authorizeToolCall({
			...base,
			toolName: "read",
			input: { path: "/tmp/outside/file-a.txt" },
		});
		const prompt2 = await waitForPrompt(prompts, 1);
		service.resolvePrompt({
			promptId: prompt2.id,
			decision: "allow_once",
			selectedScopeId: "exact",
		});
		const secondResult = await secondRequest;
		expect(secondResult.allow).toBe(true);
		expect(prompts.length).toBe(2);
	});

	test("out-of-scope write allow_always persists selected folder scope", async () => {
		const { service, prompts, base } = createHarness();
		const firstRequest = service.authorizeToolCall({
			...base,
			toolName: "write",
			input: { path: "/tmp/scope/file-a.txt", content: "a" },
		});
		const prompt = await waitForPrompt(prompts, 0);
		const folderScope = prompt.pathScopes?.find((scope) => scope.id === "ancestor-1");
		expect(folderScope).toBeTruthy();
		service.resolvePrompt({
			promptId: prompt.id,
			decision: "allow_always",
			selectedScopeId: folderScope?.id,
		});
		const firstResult = await firstRequest;
		expect(firstResult.allow).toBe(true);

		const secondResult = await service.authorizeToolCall({
			...base,
			toolName: "write",
			input: { path: "/tmp/scope/file-b.txt", content: "b" },
		});
		expect(secondResult.allow).toBe(true);
		expect(prompts.length).toBe(1);
	});

	test("path deny_always persists and blocks follow-up", async () => {
		const { service, prompts, base } = createHarness();
		const firstRequest = service.authorizeToolCall({
			...base,
			toolName: "edit",
			input: { path: "/tmp/deny-path/a.txt", oldText: "a", newText: "b" },
		});
		const prompt = await waitForPrompt(prompts, 0);
		service.resolvePrompt({
			promptId: prompt.id,
			decision: "deny_always",
			selectedScopeId: "exact",
		});
		const firstResult = await firstRequest;
		expect(firstResult.allow).toBe(false);

		const secondResult = await service.authorizeToolCall({
			...base,
			toolName: "edit",
			input: { path: "/tmp/deny-path/a.txt", oldText: "x", newText: "y" },
		});
		expect(secondResult.allow).toBe(false);
		expect(prompts.length).toBe(1);
	});

	test("allowing aws s3 ls does not trust aws s3 rm", async () => {
		const { service, prompts, base } = createHarness();
		const allowRequest = service.authorizeToolCall({
			...base,
			toolName: "bash",
			input: { command: "aws s3 ls s3://example" },
		});
		const allowPrompt = await waitForPrompt(prompts, 0);
		expect(allowPrompt.commandTokens).toEqual(["aws", "s3", "ls"]);
		expect(allowPrompt.commandRisk).toBe("read");
		service.resolvePrompt({
			promptId: allowPrompt.id,
			decision: "allow_always",
		});
		const allowResult = await allowRequest;
		expect(allowResult.allow).toBe(true);

		const trustedRepeat = await service.authorizeToolCall({
			...base,
			toolName: "bash",
			input: { command: "aws s3 ls s3://other" },
		});
		expect(trustedRepeat.allow).toBe(true);

		const denyRequest = service.authorizeToolCall({
			...base,
			toolName: "bash",
			input: { command: "aws s3 rm s3://example/key" },
		});
		const denyPrompt = await waitForPrompt(prompts, 1);
		expect(denyPrompt.commandTokens).toEqual(["aws", "s3", "rm"]);
		expect(denyPrompt.commandRisk).toBe("destructive");
		service.resolvePrompt({
			promptId: denyPrompt.id,
			decision: "deny_once",
		});
		const denyResult = await denyRequest;
		expect(denyResult.allow).toBe(false);
	});

	test("handles chained commands with env assignment and sudo", async () => {
		const { service, prompts, base } = createHarness();
		const request = service.authorizeToolCall({
			...base,
			toolName: "bash",
			input: {
				command: "AWS_PROFILE=dev aws s3 ls s3://bucket && sudo rm -rf /tmp/a",
			},
		});
		const prompt1 = await waitForPrompt(prompts, 0);
		expect(prompt1.commandTokens).toEqual(["aws", "s3", "ls"]);
		expect(prompt1.commandRisk).toBe("read");
		service.resolvePrompt({
			promptId: prompt1.id,
			decision: "allow_once",
		});

		const prompt2 = await waitForPrompt(prompts, 1);
		expect(prompt2.commandTokens).toEqual(["rm"]);
		expect(prompt2.commandRisk).toBe("destructive");
		service.resolvePrompt({
			promptId: prompt2.id,
			decision: "deny_once",
		});
		const result = await request;
		expect(result.allow).toBe(false);
	});

	test("command deny rules take precedence over matching allow rules", async () => {
		const { service, base } = createHarness();
		const policy: ProjectPermissionPolicy = {
			projectId: base.projectId,
			version: 1,
			updatedAt: Date.now(),
			commandRules: [
				{
					id: "allow-rule",
					effect: "allow",
					tokens: ["aws", "s3", "rm"],
					risk: "destructive",
					createdAt: Date.now(),
				},
				{
					id: "deny-rule",
					effect: "deny",
					tokens: ["aws", "s3", "rm"],
					risk: "destructive",
					createdAt: Date.now(),
				},
			],
			pathRules: [],
		};
		service.updateProjectPermissionPolicy(base.projectId, policy);
		const result = await service.authorizeToolCall({
			...base,
			toolName: "bash",
			input: { command: "aws s3 rm s3://bucket/key" },
		});
		expect(result.allow).toBe(false);
		expect(result.reason).toContain("denied");
	});

	test("ignores stale prompt resolution ids safely", () => {
		const { service } = createHarness();
		expect(() =>
			service.resolvePrompt({
				promptId: "missing-id",
				decision: "allow_once",
			}),
		).not.toThrow();
	});

	describe("auto-allow read-only in-scope commands", () => {
		test("auto-allows ls without prompting", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "ls" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows cat with in-scope relative path", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "cat src/file.ts" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows grep -r with in-scope path", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: 'grep -r "pattern" src/' },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows git status", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "git status" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows git log --oneline", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "git log --oneline" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows git diff", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "git diff HEAD~1" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows node --version", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "node --version" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows compound safe commands: pwd && echo hello", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "pwd && echo hello" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows pipeline of safe commands", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "cat src/file.ts | grep pattern | wc -l" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows git config --get", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "git config --get user.email" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("auto-allows sed without -i flag", async () => {
			const { service, prompts, base } = createHarness();
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "sed -n 's/foo/bar/p' ./src/file.ts" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("prompts for cat with out-of-scope path", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "cat /etc/hosts" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for sed -i (mutation flag)", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "sed -i 's/a/b/' ./src/file.ts" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for git push (write git subcommand)", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "git push origin main" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for curl (not in safe set)", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "curl https://example.com" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for mixed safe/unsafe compound: ls && rm file.txt", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "ls src/ && rm file.txt" },
			});
			// Should fall through to normal prompting since rm is unsafe
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "allow_once",
			});
			const prompt2 = await waitForPrompt(prompts, 1);
			service.resolvePrompt({
				promptId: prompt2.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for output redirection: grep foo > output.txt", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "grep foo > output.txt" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("prompts for grep with out-of-scope file argument", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "grep password /etc/passwd" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});

		test("auto-allows grep with bare pattern (no path arg)", async () => {
			const { service, prompts, base } = createHarness();
			// grep with just a pattern and no file - reads stdin, safe
			const result = await service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "echo test | grep pattern" },
			});
			expect(result.allow).toBe(true);
			expect(prompts.length).toBe(0);
		});

		test("prompts for sudo cat (sudo rejected)", async () => {
			const { service, prompts, base } = createHarness();
			const request = service.authorizeToolCall({
				...base,
				toolName: "bash",
				input: { command: "sudo cat /etc/passwd" },
			});
			const prompt = await waitForPrompt(prompts, 0);
			expect(prompt.toolName).toBe("bash");
			service.resolvePrompt({
				promptId: prompt.id,
				decision: "deny_once",
			});
			const result = await request;
			expect(result.allow).toBe(false);
		});
	});
});
