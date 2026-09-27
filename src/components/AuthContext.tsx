"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { useApolloClient } from "@apollo/client";

if (typeof window !== "undefined") {
  console.warn("[BUILD-MARKER] AuthContext module loaded at", new Date().toISOString());
}

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "FIELD_CREW" | "EDITOR" | "VIEWER";

export const CAN_UPLOAD: UserRole[] = ["SUPER_ADMIN", "ADMIN", "FIELD_CREW"];
export const CAN_DOWNLOAD: UserRole[] = ["SUPER_ADMIN", "ADMIN", "EDITOR", "FIELD_CREW", "VIEWER"];
export const CAN_MANAGE_USERS: UserRole[] = ["SUPER_ADMIN"];
export const CAN_CREATE_PROJECT: UserRole[] = ["SUPER_ADMIN", "ADMIN", "FIELD_CREW"];
export const CAN_SHARE: UserRole[] = ["SUPER_ADMIN", "ADMIN", "FIELD_CREW", "EDITOR"];

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  avatarUrl?: string | null;
  accountStatus?: string; // ACTIVE | PENDING | REJECTED
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (userData: User, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const apolloClient = useApolloClient();

  // Load from local storage on mount + validate token
  useEffect(() => {
    const init = async () => {
      const storedUser = localStorage.getItem("shotstash_user");
      const storedToken = localStorage.getItem("shotstash_token");
      if (storedUser && storedToken) {
        try {
          // Validate token is still valid
          const res = await fetch('/api/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ['Authori'+'zation']: 'Bearer ' + storedToken },
            body: JSON.stringify({ query: '{ me { id email role name avatarUrl accountStatus } }' }),
          });
          const data = await res.json();
          if (data?.data?.me) {
            const me = data.data.me;
            setUser(me);
            localStorage.setItem("shotstash_user", JSON.stringify(me));
            // Gerbang approval: akun belum ACTIVE tidak boleh masuk studio.
            if (me.accountStatus && me.accountStatus !== 'ACTIVE' && typeof window !== 'undefined') {
              const path = window.location.pathname;
              if (path.startsWith('/dashboard')) {
                window.location.href = me.accountStatus === 'REJECTED' ? '/pending' : '/pending';
              }
            }
          } else {
            // Token invalid — clear everything
            localStorage.removeItem("shotstash_user");
            localStorage.removeItem("shotstash_token");
          }
        } catch (err) {
          // Do not trust stale localStorage for role-sensitive UI.
          // If validation fails, force a fresh login so /api/graphql me returns the DB role.
          console.warn('[AuthProvider] token validation failed; clearing stale auth cache', err);
          localStorage.removeItem("shotstash_user");
          localStorage.removeItem("shotstash_token");
        }
      }
      setIsLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    console.warn('[AuthProvider] state change — user:', user?.email ?? null, 'isLoading:', isLoading);
  }, [user, isLoading]);

  const login = (userData: User, token: string) => {
    console.warn('[AuthContext] login called:', userData.email, userData.role);
    localStorage.setItem("shotstash_user", JSON.stringify(userData));
    localStorage.setItem("shotstash_token", token);
    // flushSync ensures React commits the state update synchronously
    // BEFORE we navigate — prevents race condition where dashboard
    // sees isAuthenticated=false and redirects back to login
    flushSync(() => {
      setUser(userData);
    });
    console.warn('[AuthContext] state flushed, navigating to /dashboard');
    router.replace("/dashboard");
  };

  const logout = () => {
    console.warn('[AuthContext] logout called');
    setUser(null);
    localStorage.removeItem("shotstash_user");
    localStorage.removeItem("shotstash_token");
    apolloClient.clearStore().catch((err) => {
      console.error('[AuthContext] Failed to clear Apollo store', err);
    });
    router.replace("/");
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
