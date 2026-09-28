import { createContext } from "react";
import type { SourceDestination, SourceResolution } from "@agent-replay/core";
export const SourceNavigationContext = createContext<{
  resolve: (href: string) => SourceResolution;
  navigate: (destination: SourceDestination) => void;
} | null>(null);
