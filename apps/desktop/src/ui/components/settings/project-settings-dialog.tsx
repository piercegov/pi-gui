import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/models";
import { PathListEditor } from "./path-list-editor";

function parseSkillPaths(project?: ProjectSummary) {
	const raw = project?.metadata.agentSkillPaths;
	if (!Array.isArray(raw)) return [];
	const next: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (!trimmed) continue;
		if (next.includes(trimmed)) continue;
		next.push(trimmed);
	}
	return next;
}

export function ProjectSettingsDialog(props: {
	open: boolean;
	project?: ProjectSummary;
	onOpenChange: (open: boolean) => void;
	onUpdate: (projectId: string, settings: Record<string, unknown>) => Promise<void>;
}) {
	const [agentSkillPaths, setAgentSkillPaths] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const persistedSkillPaths = useMemo(
		() => parseSkillPaths(props.project),
		[props.project],
	);

	useEffect(() => {
		if (!props.open) return;
		setAgentSkillPaths(persistedSkillPaths);
	}, [props.open, persistedSkillPaths]);

	const hasChanges =
		JSON.stringify(agentSkillPaths) !== JSON.stringify(persistedSkillPaths);

	const saveSettings = async () => {
		if (!props.project || !hasChanges || saving) return;
		setSaving(true);
		try {
			await props.onUpdate(props.project.id, {
				agentSkillPaths,
			});
		} finally {
			setSaving(false);
		}
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

					<div className="space-y-3 px-5 py-4">
						<div>
							<div className="text-xs text-white/80">Agent Skills paths</div>
							<p className="mt-0.5 text-2xs text-white/35">
								Additional skill directories or SKILL.md files for this project.
								These are merged with global and default skill discovery.
							</p>
						</div>

						<PathListEditor
							paths={agentSkillPaths}
							onUpdate={setAgentSkillPaths}
							addButtonLabel="Add project skill path"
						/>

						<p className="text-2xs text-white/25">
							Changes apply when opening or creating sessions.
						</p>

						<div className="flex justify-end gap-2 border-t border-surface-border pt-3">
							<button
								type="button"
								onClick={() => props.onOpenChange(false)}
								className="px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/70"
							>
								Close
							</button>
							<button
								type="button"
								onClick={() => void saveSettings()}
								disabled={!props.project || !hasChanges || saving}
								className="bg-accent/20 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/30 disabled:opacity-50"
							>
								{saving ? "Saving..." : "Save"}
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
