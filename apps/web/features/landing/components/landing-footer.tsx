"use client";

import Link from "next/link";
import { MulticaIcon } from "@/components/multica-icon";
import { githubUrl } from "./shared";


const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "How it Works", href: "#how-it-works" },
    { label: "Changelog", href: "/changelog" },
  ],
  Resources: [
    { label: "Documentation", href: githubUrl },
    { label: "API", href: githubUrl },
    { label: "Community", href: githubUrl },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Open Source", href: "#open-source" },
    { label: "GitHub", href: githubUrl },
  ],
};

export function LandingFooter() {
  return (
    <footer className="bg-[#0a0d12] text-white">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Top: CTA + link columns */}
        <div className="flex flex-col gap-12 border-b border-white/10 py-16 sm:py-20 lg:flex-row lg:gap-20">
          {/* Left — newsletter / CTA */}
          <div className="lg:w-[340px] lg:shrink-0">
            <Link href="#product" className="flex items-center gap-3">
              <MulticaIcon className="size-5 text-white" noSpin />
              <span className="text-[18px] font-semibold tracking-[0.04em] lowercase">
                multica
              </span>
            </Link>
            <p className="mt-4 max-w-[300px] text-[14px] leading-[1.7] text-white/50 sm:text-[15px]">
              Project management for human + agent teams. Open source,
              self-hostable, built for the future of work.
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-[11px] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0a0d12] transition-colors hover:bg-white/88"
              >
                Get started
              </Link>
            </div>
          </div>

          {/* Right — link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-4">
            {Object.entries(footerLinks).map(([group, links]) => (
              <div key={group}>
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-white/40">
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
                        className="text-[14px] text-white/50 transition-colors hover:text-white"
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

        {/* Bottom: copyright */}
        <div className="flex items-center justify-between py-6">
          <p className="text-[13px] text-white/36">
            &copy; {new Date().getFullYear()} Multica. All rights reserved.
          </p>
        </div>

        {/* Giant logo */}
        <div className="relative overflow-hidden pb-4">
          <div className="flex items-end gap-6 sm:gap-8">
            <MulticaIcon
              className="size-[clamp(4rem,12vw,10rem)] shrink-0 text-white"
              noSpin
            />
            <span className="font-[family-name:var(--font-serif)] text-[clamp(6rem,22vw,16rem)] font-normal leading-[0.82] tracking-[-0.04em] text-white lowercase">
              multica
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
