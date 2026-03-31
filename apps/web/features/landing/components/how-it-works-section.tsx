import Link from "next/link";
import { GitHubMark, githubUrl, heroButtonClassName } from "./shared";

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

export function HowItWorksSection() {
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
