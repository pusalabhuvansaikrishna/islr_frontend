"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { BASE_URL } from "@/config/api";

interface CurrentUser {
  user_id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  permissions: string[];
  is_active: boolean;
}

interface UserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  error: string;
  refetch: () => void;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${BASE_URL}/me`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        router.replace("/");
        return;
      }

      const data = await response.json();
      setUser(data);
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE_URL}/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      document.cookie = "has_session=; path=/; max-age=0; SameSite=Lax";
      setUser(null);
    }
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, error, refetch: fetchUser, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
}