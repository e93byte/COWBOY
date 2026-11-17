"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaControls() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);

    setOffline(!navigator.onLine);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function install() {
    if (!installEvent) {
      setHelpOpen(true);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  return <>
    {offline && <span className="offline-indicator" role="status">Offline · live data paused</span>}
    <button className="install-button" onClick={install} aria-label={installed ? "App installed" : "Install COWBOY app"}>
      {installed ? "Installed" : "Install app"}
    </button>
    {helpOpen && <div className="install-backdrop" role="presentation" onClick={() => setHelpOpen(false)}>
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
        <button className="install-close" onClick={() => setHelpOpen(false)} aria-label="Close install instructions">×</button>
        <img className="install-dialog-mark" src="/cowboy-mark.webp" alt="COWBOY mascot"/>
        <h2 id="install-title">Add COWBOY to your home screen</h2>
        <p>Use your browser’s install option to open this prototype like an app.</p>
        <ol><li><b>iPhone or iPad:</b> Safari Share → Add to Home Screen.</li><li><b>Android:</b> Chrome menu → Install app or Add to Home screen.</li><li><b>Desktop:</b> use the install icon in your browser’s address bar, if shown.</li></ol>
        <button className="review-button" onClick={() => setHelpOpen(false)}>Got it</button>
      </section>
    </div>}
  </>;
}
