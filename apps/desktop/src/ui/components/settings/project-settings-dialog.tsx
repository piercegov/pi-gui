import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { ProjectPermissionPolicy, ProjectSummary } from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

export function ProjectSettingsDialog(props: {
	open: boolean;
	project?: ProjectSummary;
	onOpenChange: (open: boolean) => void;
}) {
	const [policy, setPolicy] = useState<ProjectPermissionPolicy | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const projectId = props.project?.id;

	useEffect(() => {
		if (!props.open || !projectId) return;
		setLoading(true);
		setError(undefined);
		void rpc.request
			.getProjectPermissionPolicy({ projectId })
			.then((nextPolicy) => {
				setPolicy(nextPolicy);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Failed to load permissions.");
			})
			.finally(() => setLoading(false));
	}, [projectId, props.open]);

	const persistPolicy = async (nextPolicy: ProjectPermissionPolicy) => {
		if (!projectId) return;
		setSaving(true);
		setError(undefined);
		try {
			const saved = await rpc.request.updateProjectPermissionPolicy({
				projectId,
				policy: nextPolicy,
			});
			setPolicy(saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update permissions.");
		} finally {
			setSaving(false);
		}
	};

	const commandRules = policy?.commandRules ?? [];
	const pathRules = policy?.pathRules ?? [];
	const hasRules = commandRules.length > 0 || pathRules.length > 0;
	const canReset = Boolean(policy && hasRules && !saving);
	const policySummary = useMemo(() => {
		return `${commandRules.length} command rules · ${pathRules.length} path rules`;
	}, [commandRules.length, pathRules.length]);

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[78vh] w-[760px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-surface-border bg-surface-1 shadow-2xl">
					<div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
						<Dialog.Title className="text-xs font-semibold text-white/90">
							Project Settings{props.project ? ` — ${props.project.name}` : ""}
						</Dialog.Title>
						<Dialog.Close className="rounded-md p-1 text-white/30 transition hover:bg-white/5 hover:text-white/50">
							<X className="h-4 w-4" />
						</Dialog.Close>
					</div>

					<div className="max-h-[calc(78vh-52px)] overflow-auto px-5 py-4">
						<div className="mb-4 flex items-center justify-between">
							<div>
								<div className="text-xs text-white/75">Permission policy</div>
								<div className="text-2xs text-white/35">{policySummary}</div>
							</div>
							<button
								type="button"
								disabled={!canReset}
								onClick={() => {
									if (!policy) return;
									void persistPolicy({
										...policy,
										commandRules: [],
										pathRules: [],
									});
								}}
								className="border border-surface-border px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/8 hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35"
							>
								Reset all rules
							</button>
						</div>

						{loading ? (
							<p className="text-xs text-white/35">Loading policy…</p>
						) : (
							<div className="space-y-5">
								<section>
									<div className="mb-2 text-2xs uppercase tracking-wider text-white/35">
										Command rules
									</div>
									{commandRules.length === 0 ? (
										<p className="text-xs text-white/30">No persisted command rules.</p>
									) : (
										<div className="space-y-1">
											{commandRules.map((rule) => (
												<div
													key={rule.id}
													className="flex items-center gap-3 border border-surface-border bg-surface-0 px-3 py-2"
												>
													<div className="min-w-0 flex-1 text-xs text-white/65">
														<div className="mono truncate text-white/75">
															{rule.tokens.join(" ")}
														</div>
														<div className="text-2xs text-white/35">
															{rule.effect} · {rule.risk}
														</div>
													</div>
													<button
														type="button"
														disabled={saving || !policy}
														onClick={() => {
															if (!policy) return;
															void persistPolicy({
																...policy,
																commandRules: policy.commandRules.filter(
																	(entry) => entry.id !== rule.id,
																),
															});
														}}
														className="p-1 text-white/25 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
														title="Remove rule"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</button>
												</div>
											))}
										</div>
									)}
								</section>

								<section>
									<div className="mb-2 text-2xs uppercase tracking-wider text-white/35">
										Path rules
									</div>
									{pathRules.length === 0 ? (
										<p className="text-xs text-white/30">No persisted path rules.</p>
									) : (
										<div className="space-y-1">
											{pathRules.map((rule) => (
												<div
													key={rule.id}
													className="flex items-center gap-3 border border-surface-border bg-surface-0 px-3 py-2"
												>
													<div className="min-w-0 flex-1 text-xs text-white/65">
														<div className="mono truncate text-white/75">
															{rule.recursive ? `${rule.path}/**` : rule.path}
														</div>
														<div className="text-2xs text-white/35">
															{rule.effect} · {rule.access} ·{" "}
															{rule.recursive ? "recursive" : "exact"}
														</div>
													</div>
													<button
														type="button"
														disabled={saving || !policy}
														onClick={() => {
															if (!policy) return;
															void persistPolicy({
																...policy,
																pathRules: policy.pathRules.filter(
																	(entry) => entry.id !== rule.id,
																),
															});
														}}
														className="p-1 text-white/25 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
														title="Remove rule"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</button>
												</div>
											))}
										</div>
									)}
								</section>
							</div>
						)}

						{error ? (
							<p className="mt-3 text-xs text-state-error">{error}</p>
						) : null}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
