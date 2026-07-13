// Minimal pub/sub replacement for the legacy toast() in src/ui/format.js
// (which imperatively pokes a single #toast DOM node). The React analogue
// mounts one <Toast /> per Shell instance and subscribes to this module's
// listener set instead of touching the DOM directly.
type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function showToast(message: string) {
  for (const listener of listeners) listener(message);
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
