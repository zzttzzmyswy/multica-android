"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/features/issues/components";
import { api } from "@/shared/api";
import type { Issue } from "@/shared/types";

function SearchSkeleton() {
  return (
    <div className="p-2 space-y-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SearchIssuesModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const composingRef = useRef(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.listIssues({ search: q.trim(), limit: 20 });
      setResults(res.issues);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.trim()) setLoading(true);
      debounceRef.current = setTimeout(() => search(q), 300);
    },
    [search]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleValueChange = (value: string) => {
    setQuery(value);
    if (!composingRef.current) {
      scheduleSearch(value);
    }
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    scheduleSearch((e.target as HTMLInputElement).value);
  };

  const handleSelect = (issue: Issue) => {
    onClose();
    router.push(`/issues/${issue.id}`);
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Search Issues"
      description="Search issues by title"
      className="top-[min(33%,12rem)]"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search issues..."
          value={query}
          onValueChange={handleValueChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
        <CommandList className="max-h-[min(18rem,calc(100dvh-10rem))]">
          {!query.trim() ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type to search issues by title
            </div>
          ) : loading ? (
            <SearchSkeleton />
          ) : (
            <>
              <CommandEmpty>No issues found</CommandEmpty>
              <CommandGroup>
                {results.map((issue) => (
                  <CommandItem
                    key={issue.id}
                    value={issue.id}
                    onSelect={() => handleSelect(issue)}
                  >
                    <StatusIcon status={issue.status} className="h-4 w-4" />
                    <span className="flex-1 truncate">{issue.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {issue.identifier}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
