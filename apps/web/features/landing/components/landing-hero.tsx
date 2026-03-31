import Image from "next/image";
import Link from "next/link";
import {
  ClaudeCodeLogo,
  CodexLogo,
  GitHubMark,
  githubUrl,
  heroButtonClassName,
} from "./shared";

export function LandingHero() {
  return (
    <div className="relative min-h-full overflow-hidden bg-[#05070b] text-white">
      <LandingBackdrop />

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
              Multica is an open-source platform that turns coding agents into
              real teammates. Assign tasks, track progress, compound skills —
              manage your human + agent workforce in one place.
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
  );
}

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

function ProductImage() {
  return (
    <div>
      <div className="relative overflow-hidden border border-white/14">
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
