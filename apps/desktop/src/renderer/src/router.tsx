import { createHashRouter, Navigate } from "react-router-dom";
import { DashboardShell } from "./components/dashboard-shell";
import { DesktopLoginPage } from "./pages/login";
import { IssueDetailPage } from "./pages/issue-detail-page";
// Extracted pages from @multica/views
import { IssuesPage } from "@multica/views/issues/components";
import { MyIssuesPage } from "@multica/views/my-issues";
import { RuntimesPage } from "@multica/views/runtimes";
import { SkillsPage } from "@multica/views/skills";
import { AgentsPage } from "@multica/views/agents";
import { InboxPage } from "@multica/views/inbox";
import { SettingsPage } from "@multica/views/settings";

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
      { path: "agents", element: <AgentsPage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "/login", element: <DesktopLoginPage /> },
]);
