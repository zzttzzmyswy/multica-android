import { useEffect } from "react";
import { useAgentStore } from "@multica/store";
import type { ApiClient } from "@multica/sdk";

export function useAgents(api: ApiClient) {
  const { agents, setAgents } = useAgentStore();

  useEffect(() => {
    api.listAgents().then(setAgents);
  }, [api, setAgents]);

  return { agents };
}
