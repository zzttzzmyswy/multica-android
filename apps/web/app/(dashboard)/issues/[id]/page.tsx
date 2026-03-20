export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Issue Detail</h1>
      <p className="mt-2 text-muted-foreground">Issue detail view</p>
    </div>
  );
}
