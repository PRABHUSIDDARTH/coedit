"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BlurText from "@/components/reactbits/BlurText";
import DotGrid from "@/components/reactbits/DotGrid";
import { Button } from "@/components/ui/button";
import { useTokens } from "@/hooks/use-tokens";
import { CouncilDemo, DocDemo } from "./demos";

const TOKENS = ["--border", "--azure"] as const;

export function Hero() {
  const t = useTokens(TOKENS);
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Quiet texture; fades out before it reaches the copy. Decorative, so hidden from assistive tech. */}
      <div aria-hidden className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_70%_30%,black,transparent)]">
        {t["--border"] && <DotGrid baseColor={t["--border"]} activeColor={t["--azure"]} dotSize={4} gap={22} clickShock={false} intro={false} />}
      </div>
      <div className="relative grid gap-12 page-x pb-20 pt-16 lg:grid-cols-12 lg:gap-8 lg:pb-28 lg:pt-24">
        <div className="lg:col-span-6 lg:pt-6">
          <h1 className="font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
            <BlurText text="Write, calculate and think together." animateBy="words" trigger="load" delay={90} className="justify-start" />
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-2">
            Coedit is one workspace for docs, sheets and a canvas. When you are stuck, ask the Council: several AI seats argue it out and hand back one answer.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-11 bg-tidal px-5 text-base text-on-fill hover:opacity-90">
              <Link href="/signup">Start a workspace <ArrowRight data-icon="inline-end" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-5 text-base"><a href="#council">See the Council</a></Button>
          </div>
          <p className="mt-4 text-sm text-ink-3">Free for up to three people. No card needed.</p>
        </div>

        <div className="relative lg:col-span-6" aria-label="Product preview">
          <DocDemo className="relative z-0 lg:mr-10" />
          <div className="relative z-10 -mt-10 ml-6 sm:ml-16 lg:-mt-14 lg:ml-24">
            <CouncilDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
