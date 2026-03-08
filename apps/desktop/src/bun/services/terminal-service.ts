import type { HostMessenger } from "./host-messenger";

type TerminalSession = {
	id: string;
	sessionId: string;
	terminal: Bun.Terminal;
	process: Bun.Subprocess;
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

		const id = crypto.randomUUID();
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
				this.messenger.terminalExit({
					terminalId: id,
					sessionId: params.sessionId,
					exitCode: code,
				});
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
		});
		void proc.exited.then((exitCode) => {
			this.messenger.terminalExit({
				terminalId: id,
				sessionId: params.sessionId,
				exitCode,
			});
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
		session.terminal.close();
		session.process.kill();
		this.terminals.delete(terminalId);
	}
}
