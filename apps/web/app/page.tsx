"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useNavigationStore } from "@/features/navigation";
import { MulticaIcon } from "@/components/multica-icon";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const lastPath = useNavigationStore.getState().lastPath;
    router.replace(lastPath);
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <MulticaIcon className="size-6" />
    </div>
  );
}
