import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  applyPageCustomization,
  postPageCustomization,
  type LandingPageCustomization,
} from "./page-typography";

export type LandingPageFrameProps = {
  /**
   * CSS selector for the authored visual layer when a complete page is reused
   * as a scene-only Background. The document stays untouched on disk; its UI
   * is suppressed only inside this catalog frame.
   */
  backgroundCanvasSelector?: string | undefined;
  /** Extra authored atmosphere layers (scrims, veils, vignettes) to retain. */
  backgroundVisualSelector?: string | undefined;
  className?: string;
  /** Loaded directly when the packaged document is byte-exact. */
  sourceUrl: string;
  /** Set only for derived variants; the frame renders this instead of fetching sourceUrl. */
  srcDoc?: string;
  style?: CSSProperties;
  title: string;
  /**
   * Typography and colour overrides, appended to the loaded document's own
   * head. The packaged file is never rewritten, so it stays byte-exact.
   */
  customization?: LandingPageCustomization;
  /**
   * Runs against the live frame on every load and whenever the callback's own
   * identity changes, which is how a page that exposes a scene API of its own
   * receives slider values. Memoize it on the values it reads.
   */
  applyScene?: (frame: HTMLIFrameElement) => void;
};

export type LandingPageProps = Omit<
  LandingPageFrameProps,
  "sourceUrl" | "title" | "customization"
>;

const URL_FRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-top-navigation allow-top-navigation-by-user-activation";
const SRCDOC_FRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation allow-top-navigation-by-user-activation";

export function applyBackgroundPresentation(
  frame: HTMLIFrameElement | null,
  backgroundCanvasSelector?: string,
  backgroundVisualSelector?: string,
) {
  const isApp = Boolean(backgroundCanvasSelector);

  try {
    frame?.contentWindow?.postMessage({ type: "kage-app-mode", appMode: isApp }, "*");
  } catch {}

  const applyKage = () => {
    try {
      const doc = frame?.contentDocument;
      const win = frame?.contentWindow as any;
      if (doc?.body) {
        if (isApp) {
          doc.body.classList.add("app-mode");
        } else {
          doc.body.classList.remove("app-mode");
        }
      }
      if (win?.__kage?.WORD?.group) {
        win.__kage.WORD.group.visible = !isApp;
      }
      if (win?.__kage?.WORD?.glyphs) {
        win.__kage.WORD.glyphs.forEach((m: any) => {
          m.visible = !isApp;
        });
      }
      win?.__kage?.resize?.();
    } catch {}
  };

  applyKage();
  setTimeout(applyKage, 80);
  setTimeout(applyKage, 250);
  setTimeout(applyKage, 600);
  setTimeout(applyKage, 1200);
}

export function LandingPageFrame({
  applyScene,
  backgroundCanvasSelector,
  backgroundVisualSelector,
  className = "",
  customization,
  sourceUrl,
  srcDoc,
  style,
  title,
}: LandingPageFrameProps) {
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Re-applied on every change; the load handler covers the first paint and
  // any navigation the page does inside its own frame.
  useEffect(() => {
    applyPageCustomization(frameRef.current, customization);
    postPageCustomization(frameRef.current, customization);
    applyBackgroundPresentation(frameRef.current, backgroundCanvasSelector, backgroundVisualSelector);
    if (frameRef.current) applyScene?.(frameRef.current);
    if (frameRef.current?.contentDocument) {
      setReady(true);
    }
  }, [applyScene, backgroundCanvasSelector, backgroundVisualSelector, customization]);

  return (
    <div
      className={`threeui-background landing-page-frame${className ? ` ${className}` : ""}`}
      data-state={ready ? "ready" : "loading"}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#05070a", pointerEvents: "auto", ...style }}
    >
      <iframe
        ref={frameRef}
        title={title}
        {...(srcDoc ? { srcDoc } : { src: sourceUrl })}
        sandbox={srcDoc ? SRCDOC_FRAME_SANDBOX : URL_FRAME_SANDBOX}
        loading="eager"
        onLoad={(event) => {
          applyPageCustomization(event.currentTarget, customization);
          postPageCustomization(event.currentTarget, customization);
          applyBackgroundPresentation(event.currentTarget, backgroundCanvasSelector, backgroundVisualSelector);
          applyScene?.(event.currentTarget);
          setReady(true);
        }}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          border: 0,
          background: "#05070a",
          opacity: 1,
          pointerEvents: backgroundCanvasSelector ? "none" : "auto",
        }}
      />
    </div>
  );
}
