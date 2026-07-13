import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@echo/api";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      headers: () => ({ "X-Echo-Auth": "1" })
    })
  ]
});

export function isUnauthorizedTrpc(error: unknown) {
  return error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";
}
