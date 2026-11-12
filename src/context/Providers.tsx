"use client";

import { AppProvider } from "@/context/AppContext";
import { MarketplaceProvider } from "@/context/MarketplaceContext";
import { UserProvider } from "@/context/UserContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <MarketplaceProvider>
        <AppProvider>{children}</AppProvider>
      </MarketplaceProvider>
    </UserProvider>
  );
}
