import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X, CheckCircle2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { AppSettings } from "@shared/models";

const CODE_FONTS = [
	"JetBrains Mono",
	"SF Mono",
	"Menlo",
	"Monaco",
	"Consolas",
] as const;

function useActiveFont(): string | null {
	const [active, setActive] = useState<string | null>(null);
	useEffect(() => {
		const check = () => {
			for (const font of CODE_FONTS) {
				if (document.fonts.check(`12px "${font}"`)) {
					setActive(font);
					return;
				}
			}
			setActive("monospace");
		};
		if (document.fonts.status === "loaded") {
			check();
		} else {
			void document.fonts.ready.then(check);
		}
	}, []);
	return active;
}

function SettingField(props: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="border-b border-surface-border py-3 last:border-b-0">
			<div className="text-xs text-white/80">{props.label}</div>
			<div className="mt-0.5 text-2xs text-white/35">{props.description}</div>
			<div className="mt-2">{props.children}</div>
		</div>
	);
}

const ENV_VAR_SUGGESTIONS = [
	"AWS_PROFILE",
	"AWS_REGION",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"MISTRAL_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"AZURE_OPENAI_BASE_URL",
] as const;

function EnvironmentOverridesEditor(props: {
	overrides: Record<string, string>;
	onUpdate: (overrides: Record<string, string>) => void;
}) {
	const entries = Object.entries(props.overrides);

	const addEntry = () => {
		props.onUpdate({ ...props.overrides, "": "" });
	};

	const removeEntry = (key: string) => {
		const next = { ...props.overrides };
		delete next[key];
		props.onUpdate(next);
	};

	const updateEntry = (oldKey: string, newKey: string, value: string) => {
		const next: Record<string, string> = {};
		for (const [k, v] of Object.entries(props.overrides)) {
			if (k === oldKey) {
				next[newKey] = value;
			} else {
				next[k] = v;
			}
		}
		props.onUpdate(next);
	};

	return (
		<div className="space-y-2">
			{entries.map(([key, value], index) => (
				<div key={index} className="flex items-center gap-2">
					<input
						list="env-var-suggestions"
						value={key}
						placeholder="VARIABLE_NAME"
						onChange={(e) => updateEntry(key, e.target.value, value)}
						className="w-[180px] border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none font-mono"
					/>
					<span className="text-xs text-white/30">=</span>
					<input
						value={value}
						placeholder="value"
						onChange={(e) => updateEntry(key, key, e.target.value)}
						type={key.toLowerCase().includes("key") || key.toLowerCase().includes("secret") ? "password" : "text"}
						className="flex-1 border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none font-mono"
					/>
					<button
						type="button"
						onClick={() => removeEntry(key)}
						className="p-1 text-white/20 transition hover:text-red-400"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
			<datalist id="env-var-suggestions">
				{ENV_VAR_SUGGESTIONS.filter((s) => !props.overrides[s]).map((s) => (
					<option key={s} value={s} />
				))}
			</datalist>
			<button
				type="button"
				onClick={addEntry}
				className="flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white/60"
			>
				<Plus className="h-3.5 w-3.5" />
				Add variable
			</button>
			{entries.length > 0 && (
				<p className="text-2xs text-white/25">
					Changes take effect on the next session created. Restart existing sessions to pick up new values.
				</p>
			)}
		</div>
	);
}

export function SettingsDialog(props: {
	open: boolean;
	settings?: AppSettings;
	onOpenChange: (open: boolean) => void;
	onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
}) {
	const activeFont = useActiveFont();
	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[680px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-surface-border bg-surface-1 shadow-2xl">
					<div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
						<Dialog.Title className="text-xs font-semibold text-white/90">
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
										className="border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
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
										className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="appearance" className="space-y-0">
								<SettingField
									label="Accent color"
									description="Primary UI highlight color used for links, buttons, and active states."
								>
									<div className="flex items-center gap-3">
										<input
											type="color"
											value={props.settings?.accentColor ?? "#05A0D1"}
											onChange={(event) =>
												void props.onUpdate({ accentColor: event.target.value })
											}
											className="h-8 w-8 cursor-pointer border border-surface-border bg-transparent p-0"
										/>
										<input
											value={props.settings?.accentColor ?? "#05A0D1"}
											onChange={(event) =>
												void props.onUpdate({ accentColor: event.target.value })
											}
											className="w-28 border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs uppercase text-white/70 outline-none"
										/>
									</div>
								</SettingField>
								<SettingField
									label="Status colors"
									description="Colors for session status indicators."
								>
									<div className="grid grid-cols-2 gap-3">
										{([
											["stateRunningColor", "Running", "#3ddc84"],
											["stateReviewColor", "Reviewing", "#f0a830"],
											["stateErrorColor", "Error", "#f44336"],
											["stateAppliedColor", "Applied", "#66bb6a"],
										] as const).map(([key, label, fallback]) => (
											<div key={key} className="flex items-center gap-2">
												<input
													type="color"
													value={props.settings?.[key] ?? fallback}
													onChange={(event) =>
														void props.onUpdate({ [key]: event.target.value })
													}
													className="h-6 w-6 cursor-pointer border border-surface-border bg-transparent p-0"
												/>
												<span className="text-xs text-white/50">{label}</span>
											</div>
										))}
									</div>
								</SettingField>
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
										className="border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
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
												value={props.settings?.markdownFontSize ?? 13}
												onChange={(event) =>
													void props.onUpdate({
														markdownFontSize: Number(event.target.value),
													})
												}
												className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
											/>
										</div>
										<div>
											<div className="mb-1 text-2xs text-white/30">Code / Diff</div>
											<input
												type="number"
												value={props.settings?.codeFontSize ?? 13}
												onChange={(event) =>
													void props.onUpdate({
														codeFontSize: Number(event.target.value),
													})
												}
												className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
											/>
										</div>
									</div>
									<div className="mt-2 flex items-center gap-1.5">
										{activeFont === "JetBrains Mono" ? (
											<CheckCircle2 className="h-3 w-3 text-green-400/80" />
										) : (
											<AlertCircle className="h-3 w-3 text-state-review" />
										)}
										<span className="text-2xs text-white/40">
											Active font:{" "}
											<span className="mono text-white/60">{activeFont ?? "detecting..."}</span>
											{activeFont && activeFont !== "JetBrains Mono" && (
												<span className="text-white/30"> (JetBrains Mono not loaded)</span>
											)}
										</span>
									</div>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="review" className="space-y-0">
								<SettingField
									label="Write freeze"
									description="Mutating tools are always blocked during review discussion."
								>
									<span className="text-xs text-white/40">
										Writes are automatically frozen during discussion
									</span>
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
										className="w-full border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none"
									/>
								</SettingField>
								<SettingField
									label="Environment variables"
									description="Injected into the process before creating agent sessions. Useful for AWS_PROFILE, API keys, AWS_REGION, etc."
								>
									<EnvironmentOverridesEditor
										overrides={props.settings?.environmentOverrides ?? {}}
										onUpdate={(environmentOverrides) =>
											void props.onUpdate({ environmentOverrides })
										}
									/>
								</SettingField>
							</Tabs.Content>

							<Tabs.Content value="advanced" className="space-y-0">
								<SettingField
									label="Archive visibility"
									description="Show archived sessions in the sidebar."
								>
									<label className="inline-flex items-center gap-2 text-xs text-white/60">
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
