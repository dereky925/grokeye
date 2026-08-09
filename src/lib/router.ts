import { useEffect, useState } from "react";

/**
 * Minimal history-API routing — three static routes ("/", "/videos",
 * "/organization") don't justify a router dependency. Vite dev and the
 * production Express fallback both serve index.html for extensionless paths.
 */
export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}
