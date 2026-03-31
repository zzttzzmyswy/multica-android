"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

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
    question:
      "How is this different from just using Claude Code or Codex directly?",
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

export function FAQSection() {
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
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
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
                  openIndex === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
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
