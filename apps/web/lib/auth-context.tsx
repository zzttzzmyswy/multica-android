"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { User, Workspace, MemberWithUser, Agent } from "@multica/types";
import { api } from "./api";

interface AuthContextValue {
  user: User | null;
  workspace: Workspace | null;
  members: MemberWithUser[];
  agents: Agent[];
  isLoading: boolean;
  login: (email: string, name?: string) => Promise<void>;
  logout: () => void;
  updateWorkspace: (ws: Workspace) => void;
  refreshMembers: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  getMemberName: (userId: string) => string;
  getAgentName: (agentId: string) => string;
  getActorName: (type: string, id: string) => string;
  getActorInitials: (type: string, id: string) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Initialize from stored token
  useEffect(() => {
    const token = localStorage.getItem("multica_token");
    const wsId = localStorage.getItem("multica_workspace_id");
    if (!token) {
      setIsLoading(false);
      return;
    }

    api.setToken(token);
    if (wsId) api.setWorkspaceId(wsId);

    (async () => {
      try {
        const me = await api.getMe();
        setUser(me);

        const workspaces = await api.listWorkspaces();
        if (workspaces.length > 0) {
          const ws = workspaces[0]!;
          setWorkspace(ws);
          api.setWorkspaceId(ws.id);
          localStorage.setItem("multica_workspace_id", ws.id);

          const [m, a] = await Promise.all([
            api.listMembers(ws.id),
            api.listAgents({ workspace_id: ws.id }),
          ]);
          setMembers(m);
          setAgents(a);
        }
      } catch {
        // Token invalid, clear it
        localStorage.removeItem("multica_token");
        localStorage.removeItem("multica_workspace_id");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, name?: string) => {
    const { token, user: u } = await api.login(email, name);
    api.setToken(token);
    localStorage.setItem("multica_token", token);
    setUser(u);

    // Load workspace
    const workspaces = await api.listWorkspaces();
    if (workspaces.length > 0) {
      const ws = workspaces[0]!;
      setWorkspace(ws);
      api.setWorkspaceId(ws.id);
      localStorage.setItem("multica_workspace_id", ws.id);

      const [m, a] = await Promise.all([
        api.listMembers(ws.id),
        api.listAgents({ workspace_id: ws.id }),
      ]);
      setMembers(m);
      setAgents(a);
    }

    router.push("/issues");
  }, [router]);

  const logout = useCallback(() => {
    localStorage.removeItem("multica_token");
    localStorage.removeItem("multica_workspace_id");
    setUser(null);
    setWorkspace(null);
    setMembers([]);
    setAgents([]);
    router.push("/login");
  }, [router]);

  const updateWorkspaceState = useCallback((ws: Workspace) => {
    setWorkspace(ws);
  }, []);

  const refreshMembers = useCallback(async () => {
    if (!workspace) return;
    const m = await api.listMembers(workspace.id);
    setMembers(m);
  }, [workspace]);

  const refreshAgents = useCallback(async () => {
    if (!workspace) return;
    const a = await api.listAgents({ workspace_id: workspace.id });
    setAgents(a);
  }, [workspace]);

  const getMemberName = useCallback(
    (userId: string) => {
      const m = members.find((m) => m.user_id === userId);
      return m?.name ?? "Unknown";
    },
    [members],
  );

  const getAgentName = useCallback(
    (agentId: string) => {
      const a = agents.find((a) => a.id === agentId);
      return a?.name ?? "Unknown Agent";
    },
    [agents],
  );

  const getActorName = useCallback(
    (type: string, id: string) => {
      if (type === "member") return getMemberName(id);
      if (type === "agent") return getAgentName(id);
      return "System";
    },
    [getMemberName, getAgentName],
  );

  const getActorInitials = useCallback(
    (type: string, id: string) => {
      const name = getActorName(type, id);
      return name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    },
    [getActorName],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        workspace,
        members,
        agents,
        isLoading,
        login,
        logout,
        updateWorkspace: updateWorkspaceState,
        refreshMembers,
        refreshAgents,
        getMemberName,
        getAgentName,
        getActorName,
        getActorInitials,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
