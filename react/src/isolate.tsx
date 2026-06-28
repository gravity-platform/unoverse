/**
 * <IsolatedRoot> — mounts `children` inside an open Shadow DOM for complete CSS isolation.
 *
 * The SDK is the renderer for EVERY consumer (the canvas node preview, the live channel,
 * the workbench, external host apps), so the isolation boundary lives HERE — once — rather
 * than being bolted onto each host (today only the canvas wraps; the channel renders
 * unprotected, so page styles and component styles leak both ways).
 *
 * Why a portal, not a nested React root: `createPortal` renders into the shadow root while
 * keeping the SAME React tree/context, so the SDK's client/store/theme context still flows
 * to the rendered components. A separate `createRoot` would sever that.
 *
 * Web-only — this file lives in `unoverse-react`, never in the framework-agnostic core
 * (Flutter/Swift have no DOM). Token VALUES are already resolved inline by the renderer, so
 * concrete styles work unchanged inside the shadow root; only inherited typography needs the
 * reset below, after which the served `theme.root` is the sole typographic baseline.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shadow DOM blocks style SELECTORS but NOT inheritance: inherited properties (font, colour,
// line-height, letter-spacing) still pierce the boundary, and <button>/<input> fall back to
// the UA font. `:host { all: initial }` neutralizes the inherited cascade; `display: contents`
// keeps the host out of layout (the consumer owns the outer box). The themed child the SDK
// passes in (theme.root) then re-establishes the design-system typography.
const RESET_CSS = `
  :host { all: initial; display: contents; }
  .uno-isolate-root { box-sizing: border-box; }
  .uno-isolate-root *, .uno-isolate-root *::before, .uno-isolate-root *::after { box-sizing: border-box; }
  .uno-isolate-root button, .uno-isolate-root input, .uno-isolate-root textarea, .uno-isolate-root select {
    font: inherit; letter-spacing: inherit; color: inherit; margin: 0;
  }
`;

export function IsolatedRoot({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Reuse an existing shadow root across re-mounts (attachShadow throws if called twice).
    setShadow(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);

  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      {shadow &&
        createPortal(
          <>
            <style>{RESET_CSS}</style>
            <div className="uno-isolate-root">{children}</div>
          </>,
          shadow as unknown as Element,
        )}
    </div>
  );
}
