// React replacement for the legacy global-mutable auth state in src/ui/state.js
// (S.authUser / S.authRequired / S.authMode / S.authError / S.authBusy).
// Same contract, expressed as context + hooks instead of a shared mutable
// object + manual render() calls.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler, type PublicUser } from "./api";

interface AuthContextValue {
  user: PublicUser | null;
  /** True once a 401 (outside /api/auth/*) tells us the session is gone. */
  authRequired: boolean;
  setUser: (user: PublicUser | null) => void;
  setAuthRequired: (required: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    // Mirrors the old api.js behavior: any 401 outside of /api/auth/* flips
    // the whole app over to the login card.
    setUnauthorizedHandler(() => {
      setAuthRequired(true);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, authRequired, setUser, setAuthRequired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
