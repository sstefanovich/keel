import { Component, ReactNode } from "react";
import { WindowControls } from "./WindowControls";

/**
 * Last line of defence: if anything throws while drawing, show what happened and a way back
 * (reload, and the window buttons, since Keel draws its own title bar) instead of a blank window.
 * Nothing is lost: notes are saved as you type.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Keel crashed while drawing:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-bar" data-tauri-drag-region>
          <WindowControls />
        </div>
        <div className="crash-body">
          <h1>Keel hit a problem</h1>
          <p>Your notes are safe: everything is saved as you type. Reloading usually fixes this.</p>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload Keel
          </button>
          <details>
            <summary>Details</summary>
            <pre>{String(error.stack ?? error.message)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
