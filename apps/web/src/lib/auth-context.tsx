// Shared authentication state expressed as React context and hooks.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler, type PublicUser } from "./api";

interface AuthContextValue {
  user: PublicUser | null;
  /** True once a 401 (outside /api/auth/*) tells us the session is gone. */
  authRequired: boolean;
  /** Whether the server requires signed multi-user sessions. */
  multiUser: boolean;
  setUser: (user: PublicUser | null) => void;
  setAuthRequired: (required: boolean) => void;
  setMultiUser: (multiUser: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [multiUser, setMultiUser] = useState(false);

  useEffect(() => {
    // Any 401 outside of /api/auth/* flips
    // the whole app over to the login card.
    setUnauthorizedHandler(() => {
      setAuthRequired(true);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, authRequired, multiUser, setUser, setAuthRequired, setMultiUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
