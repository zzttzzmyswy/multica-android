export default function IssuesPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Issues</h1>
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          New Issue
        </button>
      </div>
      <p className="mt-4 text-muted-foreground">
        No issues yet. Create your first issue to get started.
      </p>
    </div>
  );
}
