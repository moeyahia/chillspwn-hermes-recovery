import type { ReactNode } from "react";
import { QueryProvider } from "../../data/cache/QueryProvider";
import { EventStreamProvider } from "../../data/events/EventStreamProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <EventStreamProvider>{children}</EventStreamProvider>
    </QueryProvider>
  );
}
