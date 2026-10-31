import { useSyncExternalStore } from 'react';

// Installing to the home screen. Android hands us a prompt to trigger; iOS has no such
// API, so there we can only explain the Share menu step.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'menu';

let promptEvent: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function currentMode(): InstallMode {
  if (installed || isStandalone()) return 'installed';
  if (promptEvent) return 'prompt';
  return isIos() ? 'ios' : 'menu';
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    listeners.forEach((l) => l());
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Offline mode is unavailable.', error));
    });
  }
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, currentMode);
}

export function promptInstall(): void {
  void promptEvent?.prompt();
}
