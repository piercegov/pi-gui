import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { AppSettings } from "@shared/models";

function SettingField(props: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="border-b border-surface-border py-3 last:border-b-0">
			<div className="text-sm text-white/80">{props.label}</div>
			<div className="mt-0.5 text-2xs text-white/35">{props.description}</div>
			<div className="mt-2">{props.children}</div>
		</div>
	);
}

export function SettingsDialog(props: {
	open: boolean;
	settings?: AppSettings;
	onOpenChange: (open: boolean) => void;
	onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
}) {
	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[680px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-surface-border bg-surface-1 shadow-2xl">
					<div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
						<Dialog.Title className="text-sm font-semibold text-white/90">
							Settings
						</Dialog.Title>
						<Dialog.Close className="rounded-md p-1 text-white/30 transition hover:bg-white/5 hover:text-white/50">
							<X className="h-4 w-4" />
						</Dialog.Close>
					</div>

					<Tabs.Root defaultValue="general" className="grid h-[65vh] grid-cols-[160px_minmax(0,1fr)]">
						<Tabs.List className="border-r border-surface-border bg-surface-0 p-2">
							{["general", "appearance", "review", "integrations", "advanced"].map((value) => (
								<Tabs.Trigger
									key={value}
									value={value}
									className="mb-px block w-full px-3 py-1.5 text-left text-xs capitalize text-white/40 transition hover:text-white/60 data-[state=active]:bg-white/8 data-[state=active]:text-white/80"
								>
									{value}
								</Tabs.Trigger>
							))}
						</Tabs.List>
						<div className="overflow-auto px-5 py-4">
							<Tabs.Content value="general" className="space-y-0">
								<SettingField
									label="Default session mode"
									description="Prefer worktrees when the project is a Git repository."
								>
									<select
										value={props.settings?.defaultSessionMode ?? "worktree"}
										onChange={(event) =>
											void props.onUpdate({
												defaultSessionMode: event.target.value as AppSettings["defaultSessionMode"],
											})
										}
										className="border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
									>
										<option value="worktree">Worktree</option>
										<option value="local">Local</option>
									</select>
								</SettingField>
								<SettingField
									label="Default editor"
									description='Used for the project "Open editor" action.'
								>
									<input
										value={props.settings?.defaultEditor ?? ""}
										onChange={(event) =>
											void props.onUpdate({ defaultEditor: event.target.value })
										}
										className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="appearance" className="space-y-0">
								<SettingField
									label="Diff view"
									description="Choose the default diff rendering mode."
								>
									<select
										value={props.settings?.defaultDiffView ?? "split"}
										onChange={(event) =>
											void props.onUpdate({
												defaultDiffView: event.target.value as AppSettings["defaultDiffView"],
											})
										}
										className="border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
									>
										<option value="split">Split</option>
										<option value="unified">Unified</option>
									</select>
								</SettingField>
								<SettingField
									label="Typography"
									description="Adjust markdown and code font sizes."
								>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<div className="mb-1 text-2xs text-white/30">Markdown</div>
											<input
												type="number"
												value={props.settings?.markdownFontSize ?? 14}
												onChange={(event) =>
													void props.onUpdate({
														markdownFontSize: Number(event.target.value),
													})
												}
												className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
											/>
										</div>
										<div>
											<div className="mb-1 text-2xs text-white/30">Code</div>
											<input
												type="number"
												value={props.settings?.codeFontSize ?? 13}
												onChange={(event) =>
													void props.onUpdate({
														codeFontSize: Number(event.target.value),
													})
												}
												className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
											/>
										</div>
									</div>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="review" className="space-y-0">
								<SettingField
									label="Freeze writes"
									description="Block mutating tools while review is active."
								>
									<label className="inline-flex items-center gap-2 text-sm text-white/60">
										<input
											type="checkbox"
											checked={
												props.settings?.alwaysFreezeWritesDuringReview ?? true
											}
											onChange={(event) =>
												void props.onUpdate({
													alwaysFreezeWritesDuringReview:
														event.target.checked,
												})
											}
											className="accent-accent"
										/>
										Always freeze writes during review
									</label>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="integrations" className="space-y-0">
								<SettingField
									label="Terminal shell"
									description="POSIX shell for the embedded terminal."
								>
									<input
										value={props.settings?.terminalShell ?? ""}
										onChange={(event) =>
											void props.onUpdate({
												terminalShell: event.target.value,
											})
										}
										className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-sm text-white/70 outline-none"
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="advanced" className="space-y-0">
								<SettingField
									label="Archive visibility"
									description="Show archived sessions in the sidebar."
								>
									<label className="inline-flex items-center gap-2 text-sm text-white/60">
										<input
											type="checkbox"
											checked={props.settings?.showArchived ?? false}
											onChange={(event) =>
												void props.onUpdate({
													showArchived: event.target.checked,
												})
											}
											className="accent-accent"
										/>
										Show archived sessions
									</label>
								</SettingField>
							</Tabs.Content>
						</div>
					</Tabs.Root>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
