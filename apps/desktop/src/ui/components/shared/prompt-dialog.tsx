import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";

export interface PromptDialogProps {
	open: boolean;
	title: string;
	placeholder?: string;
	defaultValue?: string;
	confirmLabel?: string;
	onConfirm: (value: string) => void;
	onCancel: () => void;
}

export function PromptDialog(props: PromptDialogProps) {
	const [value, setValue] = useState(props.defaultValue ?? "");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (props.open) {
			setValue(props.defaultValue ?? "");
		}
	}, [props.open, props.defaultValue]);

	const handleSubmit = () => {
		const trimmed = value.trim();
		props.onConfirm(trimmed);
	};

	return (
		<Dialog.Root open={props.open} onOpenChange={(open) => { if (!open) props.onCancel(); }}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
				<Dialog.Content
					className="fixed left-1/2 top-1/2 z-50 w-[360px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 border border-surface-border bg-surface-1 p-4 shadow-2xl"
					onOpenAutoFocus={(e) => {
						e.preventDefault();
						inputRef.current?.focus();
						inputRef.current?.select();
					}}
				>
					<Dialog.Title className="text-sm font-medium text-white/90">
						{props.title}
					</Dialog.Title>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleSubmit();
						}}
						className="mt-3"
					>
						<input
							ref={inputRef}
							type="text"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={props.placeholder}
							className="w-full rounded-md border border-surface-border bg-surface-0 px-2.5 py-1.5 text-xs text-white/90 outline-none placeholder:text-white/25 focus:border-accent/50"
						/>

						<div className="mt-3 flex justify-end gap-2">
							<button
								type="button"
								onClick={props.onCancel}
								className="rounded-md px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/70"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="rounded-md bg-accent/20 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/30"
							>
								{props.confirmLabel ?? "OK"}
							</button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
