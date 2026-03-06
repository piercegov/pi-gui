import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import type { AppSettings } from "@shared/models";

function SettingField(props: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-black/8 bg-white/70 p-4">
			<div className="text-sm font-semibold">{props.label}</div>
			<div className="mt-1 text-sm text-black/55">{props.description}</div>
			<div className="mt-3">{props.children}</div>
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
				<Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[760px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border border-black/10 bg-[#f8f2e8] shadow-2xl">
					<div className="border-b border-black/10 px-6 py-4">
						<Dialog.Title className="text-2xl font-semibold">
							Settings
						</Dialog.Title>
						<Dialog.Description className="mt-1 text-sm text-black/55">
							Pi auth, providers, and models remain owned by Pi. These settings
							cover app layout, review defaults, and terminal behavior.
						</Dialog.Description>
					</div>

					<Tabs.Root defaultValue="general" className="grid h-[70vh] grid-cols-[170px_minmax(0,1fr)]">
						<Tabs.List className="border-r border-black/10 bg-white/50 p-4">
							{["general", "appearance", "review", "integrations", "advanced"].map((value) => (
								<Tabs.Trigger
									key={value}
									value={value}
									className="mb-2 block w-full rounded-2xl px-3 py-2 text-left text-sm capitalize text-black/65 data-[state=active]:bg-[color:var(--accent)] data-[state=active]:text-white"
								>
									{value}
								</Tabs.Trigger>
							))}
						</Tabs.List>
						<div className="overflow-auto p-6">
							<Tabs.Content value="general" className="space-y-4">
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
										className="rounded-xl border border-black/10 bg-white px-3 py-2"
									>
										<option value="worktree">Worktree</option>
										<option value="local">Local</option>
									</select>
								</SettingField>
								<SettingField
									label="Default editor"
									description="Used for the project “Open editor” action."
								>
									<input
										value={props.settings?.defaultEditor ?? ""}
										onChange={(event) =>
											void props.onUpdate({ defaultEditor: event.target.value })
										}
										className="w-full rounded-xl border border-black/10 bg-white px-3 py-2"
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="appearance" className="space-y-4">
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
										className="rounded-xl border border-black/10 bg-white px-3 py-2"
									>
										<option value="split">Split</option>
										<option value="unified">Unified</option>
									</select>
								</SettingField>
								<SettingField
									label="Typography"
									description="Adjust markdown and code sizes independently."
								>
									<div className="grid grid-cols-2 gap-3">
										<input
											type="number"
											value={props.settings?.markdownFontSize ?? 14}
											onChange={(event) =>
												void props.onUpdate({
													markdownFontSize: Number(event.target.value),
												})
											}
											className="rounded-xl border border-black/10 bg-white px-3 py-2"
										/>
										<input
											type="number"
											value={props.settings?.codeFontSize ?? 13}
											onChange={(event) =>
												void props.onUpdate({
													codeFontSize: Number(event.target.value),
												})
											}
											className="rounded-xl border border-black/10 bg-white px-3 py-2"
										/>
									</div>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="review" className="space-y-4">
								<SettingField
									label="Freeze writes"
									description="Block mutating tools while review discussion is active."
								>
									<label className="inline-flex items-center gap-2 text-sm">
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
										/>
										Always freeze writes during review
									</label>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="integrations" className="space-y-4">
								<SettingField
									label="Terminal shell"
									description="POSIX shell used for the embedded terminal."
								>
									<input
										value={props.settings?.terminalShell ?? ""}
										onChange={(event) =>
											void props.onUpdate({
												terminalShell: event.target.value,
											})
										}
										className="w-full rounded-xl border border-black/10 bg-white px-3 py-2"
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="advanced" className="space-y-4">
								<SettingField
									label="Archive visibility"
									description="Keep archived sessions visible in the sidebar."
								>
									<label className="inline-flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={props.settings?.showArchived ?? false}
											onChange={(event) =>
												void props.onUpdate({
													showArchived: event.target.checked,
												})
											}
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
