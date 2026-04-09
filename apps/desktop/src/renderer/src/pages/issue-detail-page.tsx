import { useParams } from "react-router-dom";
import { IssueDetail } from "@multica/views/issues/components";

export function IssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <IssueDetail issueId={id} />;
}
