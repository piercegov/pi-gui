import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "@shared/models";

function SettingField(props: {
	label: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div className="border-b border-surface-border py-3 last:border-b-0">
			<div className="text-xs text-white/80">{props.label}</div>
			<div className="mt-0.5 text-2xs text-white/35">{props.description}</div>
			<div className="mt-2">{props.children}</div>
		</div>
	);
}

export function ProjectSettingsDialog(props: {
	open: boolean;
	project?: ProjectSummary;
	onOpenChange: (open: boolean) => void;
	onUpdate: (projectId: string, settings: { runCommand?: string }) => Promise<void>;
}) {
	const [runCommand, setRunCommand] = useState("");

	useEffect(() => {
		if (props.open && props.project) {
			setRunCommand((props.project.metadata.runCommand as string) ?? "");
		}
	}, [props.open, props.project]);

	const handleSave = () => {
		if (!props.project) return;
		void props.onUpdate(props.project.id, {
			runCommand: runCommand || undefined,
		});
	};

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 border border-surface-border bg-surface-1 shadow-2xl">
					<div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
						<Dialog.Title className="text-xs font-semibold text-white/90">
							Project Settings{props.project ? ` — ${props.project.name}` : ""}
						</Dialog.Title>
						<Dialog.Close className="rounded-md p-1 text-white/30 transition hover:bg-white/5 hover:text-white/50">
							<X className="h-4 w-4" />
						</Dialog.Close>
					</div>

					<div className="px-5 py-4">
						<SettingField
							label="Run command"
							description="Shell command executed when you click the Run button. E.g. bun run dev:hmr, npm start, make serve."
						>
							<input
								value={runCommand}
								onChange={(e) => setRunCommand(e.target.value)}
								onBlur={handleSave}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSave();
								}}
								placeholder="e.g. bun run dev:hmr"
								className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none font-mono"
							/>
						</SettingField>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
