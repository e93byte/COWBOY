"use client";

import { useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaControls() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [installed, setInstalled] = useState(false);
  const instructions = useRef<HTMLDialogElement>(null);
  const installButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const dialog = instructions.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      installButton.current?.focus({preventScroll:true});
    };
  }, [helpOpen]);

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
    setInstalled(window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & {standalone?: boolean}).standalone === true);
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
    setInstallEvent(null);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setHelpOpen(true);
    }
  }

  return <>
    {offline && <span className="offline-indicator" role="status">Offline · live data paused</span>}
    <a className="cw-discover-link" href="/offline.html">Saved scoreboard</a>
    {installed ? <span className="offline-indicator">App installed</span> :
      <button ref={installButton} className="install-button" onClick={install} aria-label="Install COWBOY app">Install app</button>}
    {helpOpen && <dialog ref={instructions} className="install-dialog" aria-labelledby="install-title"
      onCancel={event=>{event.preventDefault();setHelpOpen(false);}}>
        <button className="install-close" onClick={() => setHelpOpen(false)} aria-label="Close install instructions">×</button>
        <img className="install-dialog-mark" src="/cowboy-mark.webp" alt="COWBOY mascot"/>
        <h2 id="install-title">Add COWBOY to your home screen</h2>
        <p>Open COWBOY from your home screen for quick access to scores and free picks.</p>
        <ol><li><b>iPhone or iPad:</b> Safari Share → Add to Home Screen.</li><li><b>Android:</b> Chrome menu → Install app or Add to Home screen.</li><li><b>Desktop:</b> use the install icon in your browser’s address bar, if shown.</li></ol>
        <button className="review-button" onClick={() => setHelpOpen(false)}>Got it</button>
    </dialog>}
  </>;
}
