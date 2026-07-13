// Minimal pub/sub for the single React toast surface.
type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function showToast(message: string) {
  for (const listener of listeners) listener(message);
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
