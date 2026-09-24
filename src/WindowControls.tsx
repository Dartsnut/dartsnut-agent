import { useEffect, useState, type SVGProps } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function MinimizeWin(props: SVGProps<SVGSVGElement>) {
  return <svg width="10" height="1" viewBox="0 0 10 1" fill="none" {...props}><path d="M.498 1.001A.498.498 0 0 1 0 .503.498.498 0 0 1 .498 0h9.004A.498.498 0 0 1 10 .503a.498.498 0 0 1-.498.498H.498Z" fill="currentColor" fillOpacity=".8956" /></svg>;
}

function MaximizeWin(props: SVGProps<SVGSVGElement>) {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}><path d="M1.475 10.001A1.475 1.475 0 0 1 0 8.526v-7.05A1.475 1.475 0 0 1 1.475 0h7.05A1.475 1.475 0 0 1 10 1.476v7.05a1.475 1.475 0 0 1-1.475 1.475h-7.05ZM8.5 9A.499.499 0 0 0 9 8.502V1.5a.499.499 0 0 0-.5-.498H1.5a.499.499 0 0 0-.499.498v7.002A.499.499 0 0 0 1.5 9h7Z" fill="currentColor" fillOpacity=".8956" /></svg>;
}

function RestoreWin(props: SVGProps<SVGSVGElement>) {
  return <svg width="10" height="11" viewBox="0 0 10 11" fill="none" {...props}><path d="M9 2.981A1.963 1.963 0 0 0 6.997 1.018H2.085A1.5 1.5 0 0 1 3.501.017h3.496A3.002 3.002 0 0 1 10 3.015v3.501A1.5 1.5 0 0 1 9 7.932V2.981ZM1.475 10.017A1.475 1.475 0 0 1 0 8.542V3.494A1.475 1.475 0 0 1 1.475 2.02h5.048a1.475 1.475 0 0 1 1.475 1.475v5.048a1.475 1.475 0 0 1-1.475 1.475H1.475Zm5.024-1.001a.499.499 0 0 0 .503-.498v-5a.499.499 0 0 0-.503-.503h-5a.499.499 0 0 0-.498.503v5a.499.499 0 0 0 .498.498h5Z" fill="currentColor" fillOpacity=".8956" /></svg>;
}

function CloseWin(props: SVGProps<SVGSVGElement>) {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}><path d="M5 5.709.854 9.854a.498.498 0 1 1-.708-.708L4.292 5 .146.855A.498.498 0 1 1 .854.147L5 4.293 9.146.147a.498.498 0 1 1 .708.708L5.708 5l4.146 4.146a.498.498 0 1 1-.708.708L5 5.71Z" fill="currentColor" fillOpacity=".8956" /></svg>;
}

/** Custom controls for frameless Windows/Linux windows. macOS uses native traffic lights. */
export function WindowControls({ className = "" }: { className?: string }): JSX.Element {
  const [maximized, setMaximized] = useState(false);
  const platform = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "gnome";

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      try {
        const value = await windowHandle.isMaximized();
        if (!disposed) setMaximized(value);
      } catch {
        // Best-effort during startup and test environments.
      }
    };
    void sync();
    void windowHandle.onResized(() => { void sync(); }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const windowHandle = getCurrentWindow();

  return (
    <div className={`window-controls window-controls--${platform} ${className}`} aria-label="Window controls">
      <button type="button" className="window-control window-control--minimize" onClick={() => void windowHandle.minimize()} aria-label="Minimize" title="Minimize"><MinimizeWin /></button>
      <button type="button" className="window-control window-control--maximize" onClick={() => void windowHandle.toggleMaximize()} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"}>{maximized ? <RestoreWin /> : <MaximizeWin />}</button>
      <button type="button" className="window-control window-control--close" onClick={() => void windowHandle.close()} aria-label="Close" title="Close"><CloseWin /></button>
    </div>
  );
}
