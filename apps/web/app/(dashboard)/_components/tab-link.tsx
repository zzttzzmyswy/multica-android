"use client";

import Link from "next/link";
import { useTabStore } from "../../../lib/tab-store";

export function TabLink({
  href,
  title,
  iconKey,
  children,
  ...props
}: {
  href: string;
  title: string;
  iconKey?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "onClick" | "href">) {
  const { openTab } = useTabStore();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    openTab(href, title, { replace: false, iconKey });
  };

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
