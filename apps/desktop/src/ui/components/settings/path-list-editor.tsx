import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { rpc } from "@ui/lib/rpc-client";

type PathListEditorProps = {
	paths: string[];
	onUpdate: (paths: string[]) => void;
	addButtonLabel?: string;
};

export function PathListEditor(props: PathListEditorProps) {
	const addPath = () => {
		props.onUpdate([...props.paths, ""]);
	};

	const updatePath = (index: number, nextValue: string) => {
		props.onUpdate(
			props.paths.map((value, currentIndex) =>
				currentIndex === index ? nextValue : value,
			),
		);
	};

	const removePath = (index: number) => {
		props.onUpdate(
			props.paths.filter((_, currentIndex) => currentIndex !== index),
		);
	};

	const addDirectory = async () => {
		const { path } = await rpc.request.pickProjectDirectory();
		if (!path) return;
		if (props.paths.includes(path)) return;
		props.onUpdate([...props.paths, path]);
	};

	return (
		<div className="space-y-2">
			{props.paths.map((path, index) => (
				<div key={index} className="flex items-center gap-2">
					<input
						value={path}
						placeholder="/path/to/skills or /path/to/SKILL.md"
						onChange={(event) => updatePath(index, event.target.value)}
						className="flex-1 border border-surface-border bg-surface-2 px-2.5 py-1.5 text-xs text-white/70 outline-none font-mono"
					/>
					<button
						type="button"
						onClick={() => removePath(index)}
						className="p-1 text-white/20 transition hover:text-red-400"
						title="Remove path"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<button
					type="button"
					onClick={addPath}
					className="flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white/60"
				>
					<Plus className="h-3.5 w-3.5" />
					{props.addButtonLabel ?? "Add path"}
				</button>
				<button
					type="button"
					onClick={() => void addDirectory()}
					className="flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white/60"
				>
					<FolderOpen className="h-3.5 w-3.5" />
					Browse directory
				</button>
			</div>
		</div>
	);
}
