import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function enterRequestUser(userId = "local") {
  storage.enterWith({ userId });
}

export function currentUserId() {
  return storage.getStore()?.userId || "local";
}
