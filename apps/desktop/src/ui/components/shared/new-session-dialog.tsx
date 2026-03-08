import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelCatalogSummary } from "@shared/models";

export interface NewSessionDialogProps {
	open: boolean;
	loading: boolean;
	catalog?: ModelCatalogSummary;
	onConfirm: (value: {
		name?: string;
		modelProvider?: string;
		modelId?: string;
	}) => void;
	onCancel: () => void;
}

function pickInitialSelection(catalog?: ModelCatalogSummary) {
	const provider = catalog?.activeProvider ?? catalog?.providers[0] ?? "";
	const providerModels = catalog?.models.filter((model) => model.provider === provider) ?? [];
	const preferredModel =
		catalog?.activeModelId && providerModels.some((model) => model.id === catalog.activeModelId)
			? catalog.activeModelId
			: providerModels[0]?.id;
	return { provider, modelId: preferredModel ?? "" };
}

export function NewSessionDialog(props: NewSessionDialogProps) {
	const [name, setName] = useState("");
	const [provider, setProvider] = useState("");
	const [modelId, setModelId] = useState("");
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!props.open) return;
		setName("");
		const initial = pickInitialSelection(props.catalog);
		setProvider(initial.provider);
		setModelId(initial.modelId);
	}, [props.open, props.catalog]);

	const providerModels = useMemo(
		() => props.catalog?.models.filter((model) => model.provider === provider) ?? [],
		[props.catalog?.models, provider],
	);

	useEffect(() => {
		if (!provider) return;
		if (providerModels.some((model) => model.id === modelId)) return;
		setModelId(providerModels[0]?.id ?? "");
	}, [provider, providerModels, modelId]);

	const onSubmit = () => {
		const trimmed = name.trim();
		props.onConfirm({
			name: trimmed || undefined,
			modelProvider: provider || undefined,
			modelId: modelId || undefined,
		});
	};

	return (
		<Dialog.Root open={props.open} onOpenChange={(open) => { if (!open) props.onCancel(); }}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content
					className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 border border-surface-border bg-surface-1 p-4 shadow-2xl"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						nameRef.current?.focus();
					}}
				>
					<Dialog.Title className="text-sm font-medium text-white/90">
						New session
					</Dialog.Title>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							onSubmit();
						}}
						className="mt-3 space-y-3"
					>
						<div>
							<div className="mb-1 text-2xs text-white/45">Session name</div>
							<input
								ref={nameRef}
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Session name (optional)"
								className="w-full border border-surface-border bg-surface-0 px-2.5 py-1.5 text-xs text-white/90 outline-none placeholder:text-white/25"
							/>
						</div>

						<div className="grid grid-cols-2 gap-2.5">
							<div>
								<div className="mb-1 text-2xs text-white/45">Provider</div>
								<select
									value={provider}
									onChange={(event) => setProvider(event.target.value)}
									disabled={props.loading || (props.catalog?.providers.length ?? 0) === 0}
									className="w-full border border-surface-border bg-surface-0 px-2.5 py-1.5 text-xs text-white/80 outline-none disabled:opacity-50"
								>
									{(props.catalog?.providers ?? []).map((item) => (
										<option key={item} value={item}>
											{item}
										</option>
									))}
								</select>
							</div>
							<div>
								<div className="mb-1 text-2xs text-white/45">Model</div>
								<select
									value={modelId}
									onChange={(event) => setModelId(event.target.value)}
									disabled={props.loading || providerModels.length === 0}
									className="w-full border border-surface-border bg-surface-0 px-2.5 py-1.5 text-xs text-white/80 outline-none disabled:opacity-50"
								>
									{providerModels.map((item) => (
										<option key={`${item.provider}/${item.id}`} value={item.id}>
											{item.id}
										</option>
									))}
								</select>
							</div>
						</div>

						{props.loading ? (
							<div className="text-2xs text-white/30">Loading model catalog...</div>
						) : modelId ? (
							<div className="text-2xs text-white/35">
								Using <span className="mono text-white/55">{provider}/{modelId}</span>
							</div>
						) : (
							<div className="text-2xs text-white/30">No models available. Session will use runtime defaults.</div>
						)}

						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={props.onCancel}
								className="px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/70"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={props.loading}
								className="bg-accent/20 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/30 disabled:opacity-50"
							>
								Create
							</button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
