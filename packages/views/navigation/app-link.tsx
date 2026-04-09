"use client";

import { forwardRef } from "react";
import { useNavigation } from "./context";

interface AppLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink({ href, children, onClick, ...props }, ref) {
    const { push } = useNavigation();

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Allow ctrl/cmd+click to open in new tab
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      onClick?.(e);
      push(href);
    };

    return (
      <a ref={ref} href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  },
);
