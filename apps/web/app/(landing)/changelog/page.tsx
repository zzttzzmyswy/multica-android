import { LandingHeader } from "@/features/landing/components/landing-header";
import { LandingFooter } from "@/features/landing/components/landing-footer";

const changelog = [
  {
    version: "0.1.3",
    date: "2026-03-31",
    title: "Agent Intelligence",
    changes: [
      "Trigger agents via @mention in comments",
      "Stream live agent output to issue detail page",
      "Rich text editor — mentions, link paste, emoji reactions, collapsible threads",
      "File upload with S3 + CloudFront signed URLs and attachment tracking",
      "Agent-driven repo checkout with bare clone cache for task isolation",
      "Batch operations for issue list view",
      "Daemon authentication and security hardening",
    ],
  },
  {
    version: "0.1.2",
    date: "2026-03-28",
    title: "Collaboration",
    changes: [
      "Email verification login and browser-based CLI auth",
      "Multi-workspace daemon with hot-reload",
      "Runtime dashboard with usage charts and activity heatmaps",
      "Subscriber-driven notification model replacing hardcoded triggers",
      "Unified activity timeline with threaded comment replies",
      "Kanban board redesign with drag sorting, filters, and display settings",
      "Human-readable issue identifiers (e.g. JIA-1)",
      "Skill import from ClawHub and Skills.sh",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-03-25",
    title: "Core Platform",
    changes: [
      "Multi-workspace switching and creation",
      "Agent management UI with skills, tools, and triggers",
      "Unified agent SDK supporting Claude Code and Codex backends",
      "Comment CRUD with real-time WebSocket updates",
      "Task service layer and daemon REST protocol",
      "Event bus with workspace-scoped WebSocket isolation",
      "Inbox notifications with unread badge and archive",
      "CLI with cobra subcommands for workspace and issue management",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-03-22",
    title: "Foundation",
    changes: [
      "Go backend with REST API, JWT auth, and real-time WebSocket",
      "Next.js frontend with Linear-inspired UI",
      "Issues with board and list views and drag-and-drop kanban",
      "Agents, Inbox, and Settings pages",
      "One-click setup, migration CLI, and seed tool",
      "Comprehensive test suite — Go unit/integration, Vitest, Playwright E2E",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <LandingHeader variant="light" />
      <main className="bg-white text-[#0a0d12]">
        <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          <h1 className="font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem]">
            Changelog
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-[#0a0d12]/60 sm:text-[16px]">
            New updates and improvements to Multica.
          </p>

          <div className="mt-16 space-y-16">
            {changelog.map((release) => (
              <div key={release.version} className="relative">
                <div className="flex items-baseline gap-3">
                  <span className="text-[13px] font-semibold tabular-nums">
                    v{release.version}
                  </span>
                  <span className="text-[13px] text-[#0a0d12]/40">
                    {release.date}
                  </span>
                </div>
                <h2 className="mt-2 text-[20px] font-semibold leading-snug sm:text-[22px]">
                  {release.title}
                </h2>
                <ul className="mt-4 space-y-2">
                  {release.changes.map((change) => (
                    <li
                      key={change}
                      className="flex items-start gap-2.5 text-[14px] leading-[1.7] text-[#0a0d12]/60 sm:text-[15px]"
                    >
                      <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[#0a0d12]/30" />
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
