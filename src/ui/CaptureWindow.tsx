import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Capture } from "../core/capture";
import { hideWindow, onCaptureOpen, sendCapture, setWindowHeight } from "../lib/platform";
import { useHold } from "./HoldContext";
import { QuickCapture } from "./Modals";
import { refreshSpace } from "./space";

const WIDTH = 680;
/** How long the confirmation shows before the box hides */
const DONE_MS = 650;

/**
 * The small always-on-top window Ctrl+Alt+K opens while Keel isn't in front: just the capture box.
 * It parses and suggests from its own read-only index; the main window does the saving.
 */
export function CaptureWindow() {
  const { hold, bump, focus } = useHold();
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | undefined>();
  const box = useRef<HTMLDivElement>(null);
  const closing = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(closing.current);
    closing.current = undefined;
    void hideWindow();
  }, []);

  // each open starts empty, with fresh suggestions
  useEffect(
    () =>
      onCaptureOpen(() => {
        window.clearTimeout(closing.current);
        closing.current = undefined;
        setStatus(undefined);
        refreshSpace(); // the mode may have changed in the main window
        setSession((s) => s + 1);
        void hold.reindex().then((changed) => changed && bump());
      }),
    [hold, bump],
  );

  // clicking anywhere else dismisses it, like the Windows search box
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const un = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && closing.current === undefined) close();
    });
    return () => {
      un.then((f) => f());
    };
  }, [close]);

  // the window is exactly as tall as the box (it grows while the @ list is open)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => void setWindowHeight(WIDTH, el.getBoundingClientRect().height);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [session]);

  const submit = async (c: Capture) => {
    setStatus(undefined);
    try {
      const text = await sendCapture(c);
      setStatus({ text });
      closing.current = window.setTimeout(close, DONE_MS);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("capture-mode");
  }, []);

  return (
    // typing again clears an error so the preview comes back
    <div className="capture-window" onKeyDownCapture={(e) => status?.error && e.key !== "Enter" && setStatus(undefined)}>
      <QuickCapture key={session} standalone boxRef={box} onSubmit={submit} onClose={close} focus={focus} status={status} />
    </div>
  );
}
