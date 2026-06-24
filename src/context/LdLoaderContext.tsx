import { createContext, useContext, type ReactNode } from "react";
import { useLdLoader } from "@/hooks/useLdLoader";

type LdLoaderValue = ReturnType<typeof useLdLoader>;

const LdLoaderContext = createContext<LdLoaderValue | null>(null);

export function LdLoaderProvider({ children }: { children: ReactNode }) {
  const value = useLdLoader();
  return <LdLoaderContext.Provider value={value}>{children}</LdLoaderContext.Provider>;
}

export function useLdLoaderContext(): LdLoaderValue {
  const ctx = useContext(LdLoaderContext);
  if (!ctx) {
    throw new Error("useLdLoaderContext must be used within an LdLoaderProvider");
  }
  return ctx;
}
