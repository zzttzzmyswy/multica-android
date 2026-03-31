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

            <div className="mt-10 flex items-center justify-center gap-8">
              <span className="text-[15px] text-white/50">Works with</span>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2.5 text-white/80">
                  <ClaudeCodeLogo className="size-5" />
                  <span className="text-[15px] font-medium">Claude Code</span>
                </div>
                <div className="flex items-center gap-2.5 text-white/80">
                  <CodexLogo className="size-5" />
                  <span className="text-[15px] font-medium">Codex</span>
                </div>
              </div>
            </div>

            <div id="preview" className="mt-10 sm:mt-12">
              <ProductImage />
            </div>
          </section>
        </main>
      </div>

      <FeaturesSection />
      <HowItWorksSection />
      <OpenSourceSection />
      <FAQSection />
      <LandingFooter />
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
/*  How it Works Section                                                      */
/* -------------------------------------------------------------------------- */

const steps = [
  {
    number: "01",
    title: "Sign up & create your workspace",
    description:
      "Enter your email, verify with a code, and you're in. Your workspace is created automatically — no setup wizard, no configuration forms.",
  },
  {
    number: "02",
    title: "Install the CLI & connect your machine",
    description:
      "Run multica login to authenticate, then multica daemon start. The daemon auto-detects Claude Code and Codex on your machine — plug in and go.",
  },
  {
    number: "03",
    title: "Create your first agent",
    description:
      "Give it a name, write instructions, attach skills, and set triggers. Choose when it activates: on assignment, on comment, or on mention.",
  },
  {
    number: "04",
    title: "Assign an issue and watch it work",
    description:
      "Pick your agent from the assignee dropdown — just like assigning to a teammate. The task is queued, claimed, and executed automatically. Watch progress in real time.",
  },
];

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-[#05070b] text-white">
      <div className="mx-auto max-w-[1320px] px-4 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Get started
        </p>
        <h2 className="mt-4 font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem] lg:text-[4.2rem]">
          Hire your first AI employee
          <br />
          <span className="text-white/40">in the next hour.</span>
        </h2>

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="flex flex-col bg-[#05070b] p-8 lg:p-10"
            >
              <span className="text-[13px] font-semibold tabular-nums text-white/28">
                {step.number}
              </span>
              <h3 className="mt-4 text-[17px] font-semibold leading-snug text-white sm:text-[18px]">
                {step.title}
              </h3>
              <p className="mt-3 text-[14px] leading-[1.7] text-white/50 sm:text-[15px]">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-4">
          <Link href="/login" className={heroButtonClassName("solid")}>
            Get started
          </Link>
          <Link
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className={heroButtonClassName("ghost")}
          >
            <GitHubMark className="size-4" />
            View on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Open Source Section                                                       */
/* -------------------------------------------------------------------------- */

const openSourceHighlights = [
  {
    title: "Self-host anywhere",
    description:
      "Run Multica on your own infrastructure. Docker Compose, single binary, or Kubernetes — your data never leaves your network.",
  },
  {
    title: "No vendor lock-in",
    description:
      "Bring your own LLM provider, swap agent backends, extend the API. You own the stack, top to bottom.",
  },
  {
    title: "Transparent by default",
    description:
      "Every line of code is auditable. See exactly how your agents make decisions, how tasks are routed, and where your data flows.",
  },
  {
    title: "Community-driven",
    description:
      "Built with the community, not just for it. Contribute skills, integrations, and agent backends that benefit everyone.",
  },
];

function OpenSourceSection() {
  return (
    <section id="open-source" className="bg-white text-[#0a0d12]">
      <div className="mx-auto max-w-[1320px] px-4 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
        <div className="flex flex-col gap-16 lg:flex-row lg:items-start lg:gap-24">
          {/* Left column — heading + CTA */}
          <div className="lg:w-[480px] lg:shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0a0d12]/40">
              Open source
            </p>
            <h2 className="mt-4 font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem] lg:text-[4.2rem]">
              Open source
              <br />
              for all.
            </h2>
            <p className="mt-6 max-w-[420px] text-[15px] leading-7 text-[#0a0d12]/60 sm:text-[16px]">
              Multica is fully open source under the MIT license. Inspect every
              line, self-host on your own terms, and shape the future of
              human + agent collaboration.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2.5 rounded-[12px] bg-[#0a0d12] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#0a0d12]/88"
              >
                <GitHubMark className="size-4" />
                Star on GitHub
              </Link>
            </div>
          </div>

          {/* Right column — highlight grid */}
          <div className="flex-1">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-[#0a0d12]/8 bg-[#0a0d12]/8 sm:grid-cols-2">
              {openSourceHighlights.map((item) => (
                <div key={item.title} className="bg-white p-8 lg:p-10">
                  <h3 className="text-[17px] font-semibold leading-snug text-[#0a0d12] sm:text-[18px]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-[14px] leading-[1.7] text-[#0a0d12]/56 sm:text-[15px]">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  FAQ Section                                                               */
/* -------------------------------------------------------------------------- */

const faqs = [
  {
    question: "What coding agents does Multica support?",
    answer:
      "Multica currently supports Claude Code and OpenAI Codex out of the box. The daemon auto-detects whichever CLIs you have installed. More backends are on the roadmap — and since it's open source, you can add your own.",
  },
  {
    question: "Do I need to self-host, or is there a cloud version?",
    answer:
      "Both. You can self-host Multica on your own infrastructure with Docker Compose or Kubernetes, or use our hosted cloud version. Your data, your choice.",
  },
  {
    question: "How is this different from just using Claude Code or Codex directly?",
    answer:
      "Coding agents are great at executing. Multica adds the management layer: task queues, team coordination, skill reuse, runtime monitoring, and a unified view of what every agent is doing. Think of it as the project manager for your agents.",
  },
  {
    question: "Can agents work on long-running tasks autonomously?",
    answer:
      "Yes. Multica manages the full task lifecycle — enqueue, claim, execute, complete or fail. Agents report blockers proactively and stream progress in real time. You can check in whenever you want or let them run overnight.",
  },
  {
    question: "Is my code safe? Where does agent execution happen?",
    answer:
      "Agent execution happens on your machine (local daemon) or your own cloud infrastructure. Code never passes through Multica servers. The platform only coordinates task state and broadcasts events.",
  },
  {
    question: "How many agents can I run?",
    answer:
      "As many as your hardware supports. Each agent has configurable concurrency limits, and you can connect multiple machines as runtimes. There are no artificial caps in the open source version.",
  },
];

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-[#f8f8f8] text-[#0a0d12]">
      <div className="mx-auto max-w-[860px] px-4 py-24 sm:px-6 sm:py-32 lg:py-40">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0a0d12]/40">
            FAQ
          </p>
          <h2 className="mt-4 font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem] lg:text-[4.2rem]">
            Questions & answers.
          </h2>
        </div>

        <div className="mt-14 divide-y divide-[#0a0d12]/10 sm:mt-16">
          {faqs.map((faq, i) => (
            <div key={faq.question}>
              <button
                onClick={() =>
                  setOpenIndex(openIndex === i ? null : i)
                }
                className="flex w-full items-start justify-between gap-4 py-6 text-left"
              >
                <span className="text-[16px] font-semibold leading-snug text-[#0a0d12] sm:text-[17px]">
                  {faq.question}
                </span>
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-[#0a0d12]/12 text-[#0a0d12]/40 transition-transform",
                    openIndex === i && "rotate-45",
                  )}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M6 1v10M1 6h10" />
                  </svg>
                </span>
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  openIndex === i
                    ? "grid-rows-[1fr]"
                    : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <p className="pb-6 pr-12 text-[14px] leading-[1.7] text-[#0a0d12]/56 sm:text-[15px]">
                    {faq.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Footer                                                                    */
/* -------------------------------------------------------------------------- */

const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "How it Works", href: "#how-it-works" },
    { label: "Pricing", href: "#" },
    { label: "Changelog", href: "#" },
  ],
  Resources: [
    { label: "Documentation", href: "#" },
    { label: "API Reference", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Community", href: "#" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Open Source", href: "#open-source" },
    { label: "GitHub", href: githubUrl },
    { label: "Contact", href: "#" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "#" },
    { label: "Terms of Service", href: "#" },
    { label: "MIT License", href: `${githubUrl}/blob/main/LICENSE` },
  ],
};

function LandingFooter() {
  return (
    <footer className="bg-white text-[#0a0d12]">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Top: CTA + link columns */}
        <div className="flex flex-col gap-12 border-b border-[#0a0d12]/8 py-16 sm:py-20 lg:flex-row lg:gap-20">
          {/* Left — newsletter / CTA */}
          <div className="lg:w-[340px] lg:shrink-0">
            <Link href="#product" className="flex items-center gap-3">
              <MulticaIcon className="size-5 text-[#0a0d12]" noSpin />
              <span className="text-[18px] font-semibold tracking-[0.04em] lowercase">
                multica
              </span>
            </Link>
            <p className="mt-4 max-w-[300px] text-[14px] leading-[1.7] text-[#0a0d12]/56 sm:text-[15px]">
              Project management for human + agent teams. Open source, self-hostable, built for the future of work.
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-[11px] bg-[#0a0d12] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#0a0d12]/88"
              >
                Get started
              </Link>
            </div>
          </div>

          {/* Right — link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-4">
            {Object.entries(footerLinks).map(([group, links]) => (
              <div key={group}>
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#0a0d12]/40">
                  {group}
                </h4>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        {...(link.href.startsWith("http")
                          ? { target: "_blank", rel: "noreferrer" }
                          : {})}
                        className="text-[14px] text-[#0a0d12]/60 transition-colors hover:text-[#0a0d12]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: copyright + legal */}
        <div className="flex items-center justify-between py-6">
          <p className="text-[13px] text-[#0a0d12]/36">
            &copy; {new Date().getFullYear()} Multica. All rights reserved.
          </p>
        </div>

        {/* Giant logo + Game of Life */}
        <div className="relative overflow-hidden pb-4">
          <div className="flex items-end gap-6 sm:gap-8">
            <MulticaIcon
              className="size-[clamp(4rem,12vw,10rem)] shrink-0 text-[#0a0d12]"
              noSpin
            />
            <span className="font-[family-name:var(--font-serif)] text-[clamp(6rem,22vw,16rem)] font-normal leading-[0.82] tracking-[-0.04em] text-[#0a0d12] lowercase">
              multica
            </span>
          </div>
          <div className="pointer-events-none absolute bottom-0 right-0 top-0 w-[40%]">
            <GameOfLife />
          </div>
        </div>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Game of Life                                                              */
/* -------------------------------------------------------------------------- */

function GameOfLife() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellSize = 10;
    let cols = 0;
    let rows = 0;
    let grid: boolean[][] = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const newCols = Math.ceil(rect.width / cellSize);
      const newRows = Math.ceil(rect.height / cellSize);

      if (newCols !== cols || newRows !== rows) {
        cols = newCols;
        rows = newRows;
        grid = initGrid(cols, rows);
      }
    }

    function initGrid(c: number, r: number): boolean[][] {
      return Array.from({ length: c }, () =>
        Array.from({ length: r }, () => Math.random() < 0.3),
      );
    }

    function step() {
      const next: boolean[][] = Array.from({ length: cols }, () =>
        Array(rows).fill(false),
      );
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          let neighbors = 0;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && grid[nx]?.[ny]) {
                neighbors++;
              }
            }
          }
          if (grid[x]?.[y]) {
            next[x]![y] = neighbors === 2 || neighbors === 3;
          } else {
            next[x]![y] = neighbors === 3;
          }
        }
      }
      grid = next;
    }

    function draw() {
      const rect = canvas!.getBoundingClientRect();
      ctx!.clearRect(0, 0, rect.width, rect.height);
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          if (grid[x]?.[y]) {
            ctx!.fillStyle = "rgba(10, 13, 18, 0.12)";
            ctx!.beginPath();
            ctx!.arc(
              x * cellSize + cellSize / 2,
              y * cellSize + cellSize / 2,
              3,
              0,
              Math.PI * 2,
            );
            ctx!.fill();
          }
        }
      }
    }

    resize();

    let frame: number;
    let lastStep = 0;
    const interval = 300;

    function loop(time: number) {
      if (time - lastStep > interval) {
        step();
        draw();
        lastStep = time;
      }
      frame = requestAnimationFrame(loop);
    }

    draw();
    frame = requestAnimationFrame(loop);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="size-full"
      style={{ maskImage: "linear-gradient(to right, transparent, black 30%)" }}
    />
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


function ClaudeCodeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M15.31 3.99A11.2 11.2 0 0 0 12 3.6c-1.14 0-2.24.14-3.31.39C5.45 4.93 3 7.98 3 12c0 4.02 2.45 7.07 5.69 8.01A11.2 11.2 0 0 0 12 20.4c1.14 0 2.24-.14 3.31-.39C18.55 19.07 21 16.02 21 12c0-4.02-2.45-7.07-5.69-8.01ZM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm2.75 13.5a.75.75 0 0 1-1.06.06l-1.5-1.33-1.5 1.33a.75.75 0 1 1-1-1.12l1.75-1.56V9.5a.75.75 0 0 1 1.5 0v3.38l1.75 1.56a.75.75 0 0 1 .06 1.06Z" />
    </svg>
  );
}

function CodexLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.018ZM8.318 12.898l-2.024-1.168a.074.074 0 0 1-.038-.052V6.095a4.494 4.494 0 0 1 7.37-3.456l-.14.081-4.78 2.758a.795.795 0 0 0-.392.681l-.014 6.739h.018Zm1.1-2.36 2.602-1.5 2.595 1.5v2.999l-2.595 1.5-2.602-1.5v-3Z" />
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
