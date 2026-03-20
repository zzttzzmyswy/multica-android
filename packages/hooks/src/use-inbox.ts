import { useEffect } from "react";
import { useInboxStore } from "@multica/store";
import type { ApiClient } from "@multica/sdk";

export function useInbox(api: ApiClient) {
  const { items, setItems, unreadCount } = useInboxStore();

  useEffect(() => {
    api.listInbox().then(setItems);
  }, [api, setItems]);

  return { items, unreadCount };
}
