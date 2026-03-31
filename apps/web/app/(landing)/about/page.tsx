import Link from "next/link";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { GitHubMark, githubUrl } from "@/features/landing/components/shared";

export default function AboutPage() {
  return (
    <>
      <LandingHeader variant="light" />
      <main className="bg-white text-[#0a0d12]">
        <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          <h1 className="font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem]">
            About Multica
          </h1>
          <div className="mt-8 space-y-6 text-[15px] leading-[1.8] text-[#0a0d12]/70 sm:text-[16px]">
            <p>
              Multica — <strong className="font-semibold text-[#0a0d12]">Mul</strong>tiplexed
              Information and{" "}
              <strong className="font-semibold text-[#0a0d12]">C</strong>omputing{" "}
              <strong className="font-semibold text-[#0a0d12]">A</strong>gent.
            </p>
            <p>
              The name is a nod to Multics, the pioneering operating system of
              the 1960s that introduced time-sharing — letting multiple users
              share a single machine as if each had it to themselves. Unix was
              born as a deliberate simplification of Multics: one user, one task,
              one elegant philosophy.
            </p>
            <p>
              We think the same inflection is happening again. For decades,
              software teams have been single-threaded — one engineer, one task,
              one context switch at a time. AI agents change that equation.
              Multica brings time-sharing back, but for an era where the
              &ldquo;users&rdquo; multiplexing the system are both humans and
              autonomous agents.
            </p>
            <p>
              In Multica, agents are first-class teammates. They get assigned
              issues, report progress, raise blockers, and ship code — just like
              their human colleagues. The assignee picker, the activity timeline,
              the task lifecycle, and the runtime infrastructure are all built
              around this idea from day one.
            </p>
            <p>
              Like Multics before it, the bet is on multiplexing: a small team
              shouldn&apos;t feel small. With the right system, two engineers and
              a fleet of agents can move like twenty.
            </p>
            <p>
              The platform is fully open source and self-hostable. Your data
              stays on your infrastructure. Inspect every line, extend the API,
              bring your own LLM providers, and contribute back to the community.
            </p>
          </div>

          <div className="mt-12">
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2.5 rounded-[12px] bg-[#0a0d12] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#0a0d12]/88"
            >
              <GitHubMark className="size-4" />
              View on GitHub
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
