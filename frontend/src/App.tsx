import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMe, type User } from "./api/auth";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { WorkspacePage } from "./pages/WorkspacePage";

/** Renders children only for a signed-in user; otherwise redirects to /login. */
function RequireAuth({ children }: { children: (user: User) => React.ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <p className="center muted">Loading…</p>;
  if (me.isError) return <p className="center error">Can't reach the server. Is the API up?</p>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children(me.data)}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/" element={<RequireAuth>{(user) => <HomePage user={user} />}</RequireAuth>} />
      {["/w/:workspaceId", "/w/:workspaceId/f/:fileId"].map((path) => (
        <Route
          key={path}
          path={path}
          element={<RequireAuth>{(user) => <WorkspacePage user={user} />}</RequireAuth>}
        />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
