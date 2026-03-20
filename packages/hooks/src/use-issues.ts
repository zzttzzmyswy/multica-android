import { useEffect } from "react";
import { useIssueStore } from "@multica/store";
import type { ApiClient } from "@multica/sdk";

export function useIssues(api: ApiClient) {
  const { issues, setIssues } = useIssueStore();

  useEffect(() => {
    api.listIssues().then((res) => setIssues(res.issues));
  }, [api, setIssues]);

  return { issues };
}
