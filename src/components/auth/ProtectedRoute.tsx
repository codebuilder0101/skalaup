import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "@/lib/auth";

type ProtectedRouteProps = {
  pathKey: string;
  children: ReactNode;
};

export function ProtectedRoute({ pathKey, children }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated, user, canAccess } = useAuth();
  const location = useLocation();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const id = window.setTimeout(() => setLoadingTimedOut(true), 9000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  if (isLoading && !loadingTimedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 border-2 border-current border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Fail-safe: if auth bootstrap hangs, send visitors to sign-in instead of spinning forever.
  if (isLoading && loadingTimedOut && (!isAuthenticated || !user)) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  if (!canAccess(pathKey)) {
    return <Navigate to={roleHomePath[user.role]} replace />;
  }

  return <>{children}</>;
}
