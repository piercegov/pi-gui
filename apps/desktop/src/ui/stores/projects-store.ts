import { create } from "zustand";
import type { ProjectSummary } from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

type ProjectsState = {
	projects: ProjectSummary[];
	selectedProjectId?: string;
	loading: boolean;
	loadProjects: () => Promise<void>;
	addProject: (path: string) => Promise<ProjectSummary>;
	removeProject: (projectId: string) => Promise<void>;
	selectProject: (projectId: string) => void;
	updateProjectSettings: (projectId: string, settings: { runCommand?: string }) => Promise<void>;
};

export const useProjectsStore = create<ProjectsState>((set, get) => ({
	projects: [],
	selectedProjectId: undefined,
	loading: false,
	async loadProjects() {
		set({ loading: true });
		const projects = await rpc.request.listProjects();
		const currentSelectedProjectId = get().selectedProjectId;
		const selectedProjectId = projects.some(
			(project) => project.id === currentSelectedProjectId,
		)
			? currentSelectedProjectId
			: projects[0]?.id;
		set({
			projects,
			selectedProjectId,
			loading: false,
		});
	},
	async addProject(path) {
		const project = await rpc.request.addProject({ path });
		await get().loadProjects();
		set({ selectedProjectId: project.id });
		return project;
	},
	async removeProject(projectId) {
		await rpc.request.removeProject({ projectId });
		await get().loadProjects();
	},
	selectProject(projectId) {
		set({ selectedProjectId: projectId });
	},
	async updateProjectSettings(projectId, settings) {
		await rpc.request.updateProjectSettings({ projectId, settings });
		await get().loadProjects();
	},
}));
