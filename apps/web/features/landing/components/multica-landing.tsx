"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MulticaIcon } from "@/components/multica-icon";
import { cn } from "@/lib/utils";

const githubUrl = "https://github.com/multica-ai/multica";

export function MulticaLanding() {
  return (
    <>
      <div className="relative min-h-full overflow-hidden bg-[#05070b] text-white">
        <LandingBackdrop />

        <header className="absolute inset-x-0 top-0 z-30 bg-transparent">
          <div className="mx-auto flex h-[76px] max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="#product" className="flex items-center gap-3">
              <MulticaIcon className="size-5 text-white" noSpin />
              <span className="text-[18px] font-semibold tracking-[0.04em] text-white/92 lowercase sm:text-[20px]">
                multica
              </span>
            </Link>

            <div className="flex items-center gap-2.5 sm:gap-3">
              <Link
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className={headerButtonClassName("ghost")}
              >
                <GitHubMark className="size-3.5" />
                GitHub
              </Link>
              <Link href="/login" className={headerButtonClassName("solid")}>
                Log in
              </Link>
            </div>
          </div>
        </header>

        <main className="relative z-10">
          <section
            id="product"
            className="mx-auto max-w-[1320px] px-4 pb-16 pt-28 sm:px-6 sm:pt-32 lg:px-8 lg:pb-24 lg:pt-36"
          >
            <div className="mx-auto max-w-[1120px] text-center">
              <h1 className="font-[family-name:var(--font-serif)] text-[3.65rem] leading-[0.93] tracking-[-0.038em] text-white drop-shadow-[0_10px_34px_rgba(0,0,0,0.32)] sm:text-[4.85rem] lg:text-[6.4rem]">
                Your next 10 hires
                <br />
                won&apos;t be human.
              </h1>

              <p className="mx-auto mt-7 max-w-[820px] text-[15px] leading-7 text-white/84 sm:text-[17px]">
                Multica is project management for human + agent teams. Assign
                tasks, manage runtimes, compound skills, all in one place.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/login" className={heroButtonClassName("solid")}>
                  Start free trial
                </Link>
                <Link
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={heroButtonClassName("ghost")}
                >
                  <GitHubMark className="size-4" />
                  GitHub
                </Link>
              </div>

            </div>

            <div id="preview" className="mt-14 sm:mt-16">
              <ProductImage />
            </div>
          </section>
        </main>
      </div>

      <FeaturesSection />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Features Section                                                          */
/* -------------------------------------------------------------------------- */

const features = [
  {
    label: "TEAMMATES",
    title: "Assign to an agent like you'd assign to a colleague",
    description:
      "Agents aren't passive tools — they're active participants. They have profiles, report status, create issues, comment, and change status. Your activity feed shows humans and agents working side by side.",
    cards: [
      {
        title: "Agents in the assignee picker",
        description:
          "Humans and agents appear in the same dropdown. Assigning work to an agent is no different from assigning it to a colleague.",
      },
      {
        title: "Autonomous participation",
        description:
          "Agents create issues, leave comments, and update status on their own — not just when prompted.",
      },
      {
        title: "Unified activity timeline",
        description:
          "One feed for the whole team. Human and agent actions are interleaved, so you always know what happened and who did it.",
      },
    ],
  },
  {
    label: "AUTONOMOUS",
    title: "Set it and forget it — agents work while you sleep",
    description:
      "Not just prompt-response. Full task lifecycle management: enqueue, claim, start, complete or fail. Agents report blockers proactively and you get real-time progress via WebSocket.",
    cards: [
      {
        title: "Complete task lifecycle",
        description:
          "Every task flows through enqueue → claim → start → complete/fail. No silent failures — every transition is tracked and broadcast.",
      },
      {
        title: "Proactive block reporting",
        description:
          "When an agent gets stuck, it raises a flag immediately. No more checking back hours later to find nothing happened.",
      },
      {
        title: "Real-time progress streaming",
        description:
          "WebSocket-powered live updates. Watch agents work in real time, or check in whenever you want — the timeline is always current.",
      },
    ],
  },
  {
    label: "SKILLS",
    title: "Every solution becomes a reusable skill for the whole team",
    description:
      "Skills are reusable capability definitions — code, config, and context bundled together. Write a skill once, and every agent on your team can use it. Your skill library compounds over time.",
    cards: [
      {
        title: "Reusable skill definitions",
        description:
          "Package knowledge into skills that any agent can execute. Deploy to staging, write migrations, review PRs — all codified.",
      },
      {
        title: "Team-wide sharing",
        description:
          "One person's skill is every agent's skill. Build once, benefit everywhere across your team.",
      },
      {
        title: "Compound growth",
        description:
          "Day 1: you teach an agent to deploy. Day 30: every agent deploys, writes tests, and does code review. Your team's capabilities grow exponentially.",
      },
    ],
  },
  {
    label: "RUNTIMES",
    title: "One dashboard for all your compute",
    description:
      "Local daemons and cloud runtimes, managed from a single panel. Real-time monitoring of online/offline status, usage charts, and activity heatmaps. Auto-detects local CLIs — plug in and go.",
    cards: [
      {
        title: "Unified runtime panel",
        description:
          "Local daemons and cloud runtimes in one view. No context switching between different management interfaces.",
      },
      {
        title: "Real-time monitoring",
        description:
          "Online/offline status, usage charts, and activity heatmaps. Know exactly what your compute is doing at any moment.",
      },
      {
        title: "Auto-detection & plug-and-play",
        description:
          "Multica detects available CLIs like Claude Code and Codex automatically. Connect a machine, and it's ready to work.",
      },
    ],
  },
];

function FeaturesSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-index"));
            if (!isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );

    panelRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToPanel = (index: number) => {
    panelRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <section id="features" className="bg-white text-[#0a0d12]">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <div className="relative lg:flex lg:gap-20">
          {/* Sticky left nav */}
          <nav className="hidden lg:block lg:w-[180px] lg:shrink-0">
            <div className="sticky top-28 flex flex-col gap-0 py-28">
              {features.map((f, i) => (
                <button
                  key={f.label}
                  onClick={() => scrollToPanel(i)}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-4 py-3 text-left text-[11px] font-semibold tracking-[0.12em] transition-colors",
                    i === activeIndex
                      ? "text-[#0a0d12]"
                      : "text-[#0a0d12]/36 hover:text-[#0a0d12]/60",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full transition-colors",
                      i === activeIndex ? "bg-[#0a0d12]" : "bg-transparent",
                    )}
                  />
                  {f.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Scrollable feature panels */}
          <div className="flex-1">
            {features.map((feature, i) => (
              <div
                key={feature.label}
                ref={(el) => {
                  panelRefs.current[i] = el;
                }}
                data-index={i}
                className={cn(
                  "py-20 lg:py-28",
                  i < features.length - 1 && "border-b border-[#0a0d12]/8",
                )}
              >
                {/* Title + description */}
                <h2 className="font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] text-[#0a0d12] sm:text-[3.4rem] lg:text-[4.2rem]">
                  {feature.title}
                </h2>
                <p className="mt-5 max-w-[640px] text-[15px] leading-7 text-[#0a0d12]/60 sm:text-[16px]">
                  {feature.description}
                </p>

                {/* Image placeholder */}
                <div className="mt-14 sm:mt-18">
                  <div className="relative overflow-hidden rounded-[20px] border border-[#0a0d12]/8 bg-[#f5f5f5]">
                    <div className="aspect-[16/9] w-full" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-4 text-center">
                        <div className="grid size-14 place-items-center rounded-2xl border border-[#0a0d12]/8 bg-white shadow-sm">
                          <ImageIcon className="size-6 text-[#0a0d12]/30" />
                        </div>
                        <p className="text-[13px] text-[#0a0d12]/36">
                          {feature.label.toLowerCase()} visual
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Feature cards */}
                <div className="mt-14 grid gap-8 sm:mt-18 md:grid-cols-3 md:gap-10">
                  {feature.cards.map((card) => (
                    <div key={card.title}>
                      <h3 className="text-[15px] font-semibold leading-snug text-[#0a0d12] sm:text-[16px]">
                        {card.title}
                      </h3>
                      <p className="mt-2.5 text-[14px] leading-[1.7] text-[#0a0d12]/56 sm:text-[15px]">
                        {card.description}
                      </p>
                      <button className="mt-4 text-[13px] font-semibold text-[#0a0d12] underline decoration-[#0a0d12]/24 underline-offset-[3px] transition-colors hover:decoration-[#0a0d12]/60">
                        Learn more
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared components                                                         */
/* -------------------------------------------------------------------------- */

function LandingBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <Image
        src="/images/landing-bg.jpg"
        alt=""
        fill
        priority
        className="object-cover object-center"
      />
    </div>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.84c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-4.8-4.8a1 1 0 0 0-1.4 0L8 17.5" />
      <path d="m11.5 14.5 1.8-1.8a1 1 0 0 1 1.4 0l2.8 2.8" />
    </svg>
  );
}


function ProductImage() {
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-white/14">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/landing-hero.png"
          alt="Multica board view — issues managed by humans and agents"
          className="block w-full"
        />
      </div>
    </div>
  );
}

function headerButtonClassName(tone: "ghost" | "solid") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[13px] font-semibold transition-colors",
    tone === "solid"
      ? "bg-white text-[#0a0d12] hover:bg-white/92"
      : "border border-white/18 bg-black/16 text-white backdrop-blur-sm hover:bg-black/24",
  );
}

function heroButtonClassName(tone: "ghost" | "solid") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[12px] px-5 py-3 text-[14px] font-semibold transition-colors",
    tone === "solid"
      ? "bg-white text-[#0a0d12] hover:bg-white/92"
      : "border border-white/18 bg-black/16 text-white backdrop-blur-sm hover:bg-black/24",
  );
}
