import { createContext, type MouseEvent, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

interface NavigationContextValue {
  pathname: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

function safeInternalPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo<NavigationContextValue>(() => ({
    pathname,
    navigate: (path, options) => {
      const target = safeInternalPath(path);
      if (target === window.location.pathname) return;
      window.history[options?.replace ? "replaceState" : "pushState"]({}, "", target);
      setPathname(target);
      window.scrollTo({ top: 0, behavior: "instant" });
    },
  }), [pathname]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigation must be used inside NavigationProvider");
  return value;
}

export function AppLink({ href, children, className, onClick, ...props }: {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  "aria-label"?: string;
}) {
  const { navigate } = useNavigation();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
    onClick?.();
  };
  return <a href={href} className={className} onClick={handleClick} {...props}>{children}</a>;
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart.startsWith(":")) params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    else if (patternPart !== pathPart) return null;
  }
  return params;
}
