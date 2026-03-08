import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ProjectSummary } from "@shared/models";

export function ProjectSettingsDialog(props: {
	open: boolean;
	project?: ProjectSummary;
	onOpenChange: (open: boolean) => void;
	onUpdate: (projectId: string, settings: Record<string, unknown>) => Promise<void>;
}) {
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
						<p className="text-2xs text-white/30">No project-level settings available yet.</p>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
