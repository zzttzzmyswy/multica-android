"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { useChatStore } from "../store";

export function ChatFab() {
  const toggle = useChatStore((s) => s.toggle);

  return (
    <Button
      onClick={toggle}
      size="icon"
      className="fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg bg-purple-600 hover:bg-purple-700 text-white"
    >
      <MessageCircle className="size-5" />
    </Button>
  );
}
