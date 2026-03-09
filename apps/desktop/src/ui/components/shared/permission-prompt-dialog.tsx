import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	PermissionPathScopeOption,
	PermissionPrompt,
	PermissionPromptDecision,
} from "@shared/models";

function scopeLabel(scope: PermissionPathScopeOption) {
	return scope.recursive ? `${scope.label} (${scope.path}/**)` : `${scope.label} (${scope.path})`;
}

export function PermissionPromptDialog(props: {
	open: boolean;
	prompt?: PermissionPrompt;
	onResolve: (decision: PermissionPromptDecision, selectedScopeId?: string, userMessage?: string) => void;
}) {
	const [selectedScopeId, setSelectedScopeId] = useState<string | undefined>(undefined);
	const [denyMessage, setDenyMessage] = useState("");
	const denyInputRef = useRef<HTMLTextAreaElement>(null);
	const scopeOptions = props.prompt?.pathScopes ?? [];

	useEffect(() => {
		if (!props.open) return;
		setSelectedScopeId(scopeOptions[0]?.id);
		setDenyMessage("");
	}, [props.open, props.prompt?.id, scopeOptions]);

	const title = useMemo(() => {
		if (!props.prompt) return "Permission required";
		return props.prompt.reason === "unknown_command"
			? "Command permission required"
			: "Path permission required";
	}, [props.prompt]);

	return (
		<Dialog.Root
			open={props.open}
			onOpenChange={(open) => {
				if (!open) {
					props.onResolve("deny_once", selectedScopeId, denyMessage.trim() || undefined);
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[620px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 border border-surface-border bg-surface-1 shadow-2xl">
					<div className="border-b border-surface-border px-5 py-3">
						<Dialog.Title className="text-xs font-semibold text-white/90">{title}</Dialog.Title>
					</div>
					<div className="space-y-4 px-5 py-4">
						<p className="text-xs leading-relaxed text-white/65">
							{props.prompt?.message ?? "This action needs your approval."}
						</p>

						<div className="space-y-2 border border-surface-border bg-surface-0 px-3 py-2">
							<div className="text-2xs uppercase tracking-wider text-white/35">Tool</div>
							<div className="mono text-xs text-white/70">{props.prompt?.toolName}</div>
							{props.prompt?.command ? (
								<>
									<div className="pt-2 text-2xs uppercase tracking-wider text-white/35">Command</div>
									<pre className="overflow-x-auto text-xs text-white/60 mono">{props.prompt.command}</pre>
								</>
							) : null}
							{props.prompt?.commandTokens?.length ? (
								<div className="text-2xs text-white/40">
									Signature:{" "}
									<span className="mono text-white/60">
										{props.prompt.commandTokens.join(" ")}
									</span>
									{props.prompt.commandRisk ? (
										<span className="ml-2 text-white/45">({props.prompt.commandRisk})</span>
									) : null}
								</div>
							) : null}
							{props.prompt?.targetPath ? (
								<>
									<div className="pt-2 text-2xs uppercase tracking-wider text-white/35">Target path</div>
									<div className="mono text-xs text-white/60">{props.prompt.targetPath}</div>
								</>
							) : null}
						</div>

						{scopeOptions.length > 0 ? (
							<div className="space-y-2">
								<div className="text-2xs uppercase tracking-wider text-white/35">
									Scope for “Always allow/deny”
								</div>
								<div className="max-h-44 overflow-auto border border-surface-border bg-surface-0 p-2">
									{scopeOptions.map((scope) => (
										<label
											key={scope.id}
											className="mb-1 flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs text-white/65 transition hover:bg-white/5"
										>
											<input
												type="radio"
												name="permission-scope"
												value={scope.id}
												checked={selectedScopeId === scope.id}
												onChange={() => setSelectedScopeId(scope.id)}
												className="mt-[2px] accent-accent"
											/>
											<span className="leading-relaxed">{scopeLabel(scope)}</span>
										</label>
									))}
								</div>
							</div>
						) : null}
					</div>
					<div className="border-t border-surface-border px-5 py-3 space-y-3">
						<div className="space-y-1.5">
							<label className="text-2xs uppercase tracking-wider text-white/35">
								Deny with message <span className="normal-case tracking-normal text-white/25">(optional — leave empty to stop the agent)</span>
							</label>
							<textarea
								ref={denyInputRef}
								value={denyMessage}
								onChange={(e) => setDenyMessage(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										props.onResolve("deny_once", selectedScopeId, denyMessage.trim() || undefined);
									}
								}}
								placeholder="e.g. Try a different approach instead..."
								className="w-full resize-none border border-surface-border bg-surface-0 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 focus:border-white/20 focus:outline-none"
								rows={2}
							/>
						</div>
						<div className="flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => props.onResolve("deny_once", selectedScopeId, denyMessage.trim() || undefined)}
								className="border border-surface-border px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/5 hover:text-white/80"
							>
								{denyMessage.trim() ? "Deny & redirect" : "Deny & stop"}
							</button>
							<button
								type="button"
								onClick={() => props.onResolve("deny_always", selectedScopeId, denyMessage.trim() || undefined)}
								className="border border-state-error/30 bg-state-error/10 px-3 py-1.5 text-xs text-state-error transition hover:bg-state-error/20"
							>
								Always deny
							</button>
							<button
								type="button"
								onClick={() => props.onResolve("allow_once", selectedScopeId)}
								className="border border-surface-border px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10"
							>
								Allow once
							</button>
							<button
								type="button"
								onClick={() => props.onResolve("allow_always", selectedScopeId)}
								className="bg-accent px-3 py-1.5 text-xs font-medium text-black transition hover:brightness-110"
							>
								Always allow
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
