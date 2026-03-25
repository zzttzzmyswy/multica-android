"use client";

import { create } from "zustand";
import type { Workspace, MemberWithUser, Agent, Skill } from "@multica/types";
import { api } from "@/shared/api";

interface WorkspaceState {
  workspace: Workspace | null;
  workspaces: Workspace[];
  members: MemberWithUser[];
  agents: Agent[];
  skills: Skill[];
}

interface WorkspaceActions {
  hydrateWorkspace: (
    wsList: Workspace[],
    preferredWorkspaceId?: string | null,
  ) => Promise<Workspace | null>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<Workspace[]>;
  refreshMembers: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  createWorkspace: (data: {
    name: string;
    slug: string;
    description?: string;
  }) => Promise<Workspace>;
  updateWorkspace: (ws: Workspace) => void;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  clearWorkspace: () => void;
}

type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  // State
  workspace: null,
  workspaces: [],
  members: [],
  agents: [],
  skills: [],

  // Actions
  hydrateWorkspace: async (wsList, preferredWorkspaceId) => {
    set({ workspaces: wsList });

    const nextWorkspace =
      (preferredWorkspaceId
        ? wsList.find((item) => item.id === preferredWorkspaceId)
        : null) ??
      wsList[0] ??
      null;

    if (!nextWorkspace) {
      api.setWorkspaceId(null);
      localStorage.removeItem("multica_workspace_id");
      set({ workspace: null, members: [], agents: [], skills: [] });
      return null;
    }

    api.setWorkspaceId(nextWorkspace.id);
    localStorage.setItem("multica_workspace_id", nextWorkspace.id);
    set({ workspace: nextWorkspace });

    const [nextMembers, nextAgents, nextSkills] = await Promise.all([
      api.listMembers(nextWorkspace.id),
      api.listAgents({ workspace_id: nextWorkspace.id }),
      api.listSkills().catch(() => [] as Skill[]),
    ]);
    set({ members: nextMembers, agents: nextAgents, skills: nextSkills });

    return nextWorkspace;
  },

  switchWorkspace: async (workspaceId) => {
    const { workspaces, hydrateWorkspace } = get();
    const ws = workspaces.find((item) => item.id === workspaceId);
    if (!ws) return;

    await hydrateWorkspace(workspaces, ws.id);
  },

  refreshWorkspaces: async () => {
    const { workspace, hydrateWorkspace } = get();
    const storedWorkspaceId = localStorage.getItem("multica_workspace_id");
    const wsList = await api.listWorkspaces();
    await hydrateWorkspace(wsList, workspace?.id ?? storedWorkspaceId);
    return wsList;
  },

  refreshMembers: async () => {
    const { workspace } = get();
    if (!workspace) return;
    const members = await api.listMembers(workspace.id);
    set({ members });
  },

  refreshAgents: async () => {
    const { workspace } = get();
    if (!workspace) return;
    const agents = await api.listAgents({ workspace_id: workspace.id });
    set({ agents });
  },

  refreshSkills: async () => {
    const { workspace } = get();
    if (!workspace) return;
    const skills = await api.listSkills();
    set({ skills });
  },

  createWorkspace: async (data) => {
    const ws = await api.createWorkspace(data);
    set((state) => ({ workspaces: [...state.workspaces, ws] }));
    return ws;
  },

  updateWorkspace: (ws) => {
    set((state) => ({
      workspace: state.workspace?.id === ws.id ? ws : state.workspace,
      workspaces: state.workspaces.map((item) =>
        item.id === ws.id ? ws : item,
      ),
    }));
  },

  leaveWorkspace: async (workspaceId) => {
    await api.leaveWorkspace(workspaceId);
    const { workspace, hydrateWorkspace } = get();
    const wsList = await api.listWorkspaces();
    const preferredWorkspaceId =
      workspace?.id === workspaceId ? null : (workspace?.id ?? null);
    await hydrateWorkspace(wsList, preferredWorkspaceId);
  },

  deleteWorkspace: async (workspaceId) => {
    await api.deleteWorkspace(workspaceId);
    const { workspace, hydrateWorkspace } = get();
    const wsList = await api.listWorkspaces();
    const preferredWorkspaceId =
      workspace?.id === workspaceId ? null : (workspace?.id ?? null);
    await hydrateWorkspace(wsList, preferredWorkspaceId);
  },

  clearWorkspace: () => {
    api.setWorkspaceId(null);
    localStorage.removeItem("multica_workspace_id");
    set({ workspace: null, workspaces: [], members: [], agents: [], skills: [] });
  },
}));
