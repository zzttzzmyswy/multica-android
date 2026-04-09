import { createHashRouter, Navigate } from "react-router-dom";
import { DashboardShell } from "./components/dashboard-shell";
import { LoginPage } from "./pages/login";
import { IssueDetailPage } from "./pages/issue-detail-page";
import { PlaceholderPage } from "./pages/placeholder";

// Extracted pages from @multica/views
import { IssuesPage } from "@multica/views/issues/components";
import { MyIssuesPage } from "@multica/views/my-issues";
import { RuntimesPage } from "@multica/views/runtimes";
import { SkillsPage } from "@multica/views/skills";

export const router = createHashRouter([
  {
    path: "/",
    element: <DashboardShell />,
    children: [
      { index: true, element: <Navigate to="/issues" replace /> },
      { path: "issues", element: <IssuesPage /> },
      { path: "issues/:id", element: <IssueDetailPage /> },
      { path: "my-issues", element: <MyIssuesPage /> },
      { path: "runtimes", element: <RuntimesPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "agents", element: <PlaceholderPage title="Agents" /> },
      { path: "inbox", element: <PlaceholderPage title="Inbox" /> },
      { path: "settings", element: <PlaceholderPage title="Settings" /> },
      { path: "board", element: <PlaceholderPage title="Board" /> },
    ],
  },
  { path: "/login", element: <LoginPage /> },
]);
