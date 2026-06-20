import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
} from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  type PropsWithChildren,
  useMemo,
  useState,
} from "react";

import { useAuth } from "./auth";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: DAY_IN_MS,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

const shouldPersistQuery = (queryKey: readonly unknown[]) => queryKey[0] === "members-index";

export const AppQueryProvider = ({ children }: PropsWithChildren) => {
  const { user } = useAuth();
  const [queryClient] = useState(createAppQueryClient);
  const tenantStorageKey = `shepherd-hub-query-cache:${user?.tenantId ?? "anonymous"}`;

  const persister = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return createSyncStoragePersister({
      key: tenantStorageKey,
      storage: window.localStorage,
    });
  }, [tenantStorageKey]);

  if (!persister) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      key={tenantStorageKey}
      persistOptions={{
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => shouldPersistQuery(query.queryKey),
        },
        maxAge: DAY_IN_MS,
        persister,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
};
