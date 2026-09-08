"use client";

import Link from "next/link";
import {
  GEIST,
  INSTRUMENT_SERIF,
  NEWSREADER,
  type PageFont,
  type PageTypographyRecipe,
  splitTypographyProps,
  usePageTypography,
  type PageTypographyProps,
} from "./page-typography";
import { LandingPageFrame, type LandingPageProps } from "./landing-page-frame";
import styles from "./kage-landing.module.css";

const n = (value: number) => Number(value.toFixed(3));
const px = (value: number) => `${n(value)}px`;

export const ONEST: PageFont = {
  value: "onest",
  label: "Onest",
  stack: "'Onest', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
};

export const KAGE_TYPOGRAPHY: PageTypographyRecipe = {
  headingFonts: [ONEST, INSTRUMENT_SERIF, NEWSREADER, GEIST],
  bodyFonts: [ONEST, GEIST, NEWSREADER, INSTRUMENT_SERIF],
  headingWeights: ["400", "500", "600", "700"],
  headingWeight: "400",
  bodyWeights: ["300", "400", "500", "600"],
  bodyWeight: "300",
  primaryColor: "#e0231c",
  headingSize: [30, 46, 72],
  bodySize: [13, 17, 24],
  headingLetterSpacing: [-0.06, -0.012, 0.12],
  css: (type) => `
:root {
  --vermilion: ${type.primary};
  --ember: ${type.retone("#ff5a3c")};
}
body { font-family: ${type.body}; }
body, .body, .body-lg, .num { font-weight: ${type.bodyWeight}; }
h1:not(.jp), h2:not(.jp), h3:not(.jp), .display:not(.jp) {
  font-family: ${type.heading};
  font-weight: ${type.headingWeight};
}
.display { letter-spacing: ${type.headingLetterSpacing}em; }
.h-hero { font-size: clamp(26px, 3.05vw, ${px(type.headingSize)}); }
.h-sec { font-size: clamp(30px, 4vw, ${px((type.headingSize * 60) / 46)}); }
.body-lg { font-size: clamp(14px, 1.02vw, ${px(type.bodySize)}); }
.body { font-size: ${px(Math.max(11, type.bodySize - 3))}; }
`,
};

export function KageLandingPage(props: LandingPageProps & PageTypographyProps & { sourceUrl?: string }) {
  const [type, frame] = splitTypographyProps(props);
  const customization = usePageTypography(KAGE_TYPOGRAPHY, type);
  return (
    <LandingPageFrame
      {...frame}
      customization={customization}
      title="Kage — Where stillness reveals the unseen"
      sourceUrl={props.sourceUrl || "/landing-pages/kage.html"}
    />
  );
}
export function KageHeroView() {
  // Floating overlay removed per requirement: navigation is directly embedded into the Kage landing page
  return null;
}
