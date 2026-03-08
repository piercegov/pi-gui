import type { HostMessenger } from "./host-messenger";

type TerminalSession = {
	id: string;
	sessionId: string;
	terminal: Bun.Terminal;
	process: Bun.Subprocess;
	finalize: (exitCode: number) => void;
};

function isFishShell(shell: string) {
	const command = shell.trim();
	return command === "fish" || command.endsWith("/fish");
}

function quoteForShell(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(shell: string) {
	if (process.platform === "linux" && isFishShell(shell) && Bun.which("script")) {
		// Fish expects a controlling TTY for job control. Wrapping it with script(1)
		// provides a real session/PTY on Linux where Bun.Terminal can be insufficient.
		return ["script", "-qefc", `exec ${quoteForShell(shell)} -i`, "/dev/null"];
	}
	return [shell];
}

export class TerminalService {
	private readonly terminals = new Map<string, TerminalSession>();
	private readonly terminalIdBySession = new Map<string, string>();

	constructor(private readonly messenger: HostMessenger) {}

	async open(params: {
		sessionId: string;
		cwd: string;
		shell: string;
	}) {
		if (process.platform === "win32") {
			throw new Error(
				"Embedded PTY support is currently disabled on Windows. Tool logs and Git output remain available.",
			);
		}

		const existingTerminalId = this.terminalIdBySession.get(params.sessionId);
		if (existingTerminalId) {
			const existing = this.terminals.get(existingTerminalId);
			if (existing) {
				return { terminalId: existing.id };
			}
			this.terminalIdBySession.delete(params.sessionId);
		}

		const id = crypto.randomUUID();
		let finalized = false;
		const finalize = (exitCode: number) => {
			if (finalized) return;
			finalized = true;
			this.terminals.delete(id);
			if (this.terminalIdBySession.get(params.sessionId) === id) {
				this.terminalIdBySession.delete(params.sessionId);
			}
			this.messenger.terminalExit({
				terminalId: id,
				sessionId: params.sessionId,
				exitCode,
			});
		};
		const terminal = new Bun.Terminal({
			cols: 120,
			rows: 30,
			data: (_terminal, chunk) => {
				this.messenger.terminalData({
					terminalId: id,
					sessionId: params.sessionId,
					data: new TextDecoder().decode(chunk),
				});
			},
			exit: (_terminal, code) => {
				finalize(code);
			},
		});
		const proc = Bun.spawn(buildShellCommand(params.shell), {
			cwd: params.cwd,
			env: { ...process.env, TERM: "xterm-256color" },
			terminal,
		});
		this.terminals.set(id, {
			id,
			sessionId: params.sessionId,
			terminal,
			process: proc,
			finalize,
		});
		this.terminalIdBySession.set(params.sessionId, id);
		void proc.exited.then((exitCode) => {
			finalize(exitCode);
		});
		return { terminalId: id };
	}

	resize(terminalId: string, cols: number, rows: number) {
		const session = this.terminals.get(terminalId);
		if (!session) return;
		session.terminal.resize(cols, rows);
	}

	write(terminalId: string, data: string) {
		const session = this.terminals.get(terminalId);
		if (!session) return;
		session.terminal.write(data);
	}

	close(terminalId: string) {
		const session = this.terminals.get(terminalId);
		if (!session) return;
		session.process.kill();
		session.terminal.close();
		session.finalize(typeof session.process.exitCode === "number" ? session.process.exitCode : 0);
	}
}
