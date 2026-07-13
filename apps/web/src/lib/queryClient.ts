// Single shared QueryClient instance. researchActions.ts needs to invalidate
// the watch-desk query from outside any component (a completed research run
// should make the just-researched company show up on /watch immediately,
// mirroring legacy's refreshWatchDesk() call from research.js) — that requires
// a module-level reference rather than the useQueryClient() hook.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
