"use client";

import { DashboardLayout } from "@multica/views/layout";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { SearchCommand } from "@/features/search";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout
      loadingIndicator={<MulticaIcon className="size-6" />}
      extra={<SearchCommand />}
    >
      {children}
    </DashboardLayout>
  );
}
