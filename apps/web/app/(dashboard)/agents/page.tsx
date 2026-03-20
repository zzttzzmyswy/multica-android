export default function AgentsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Add Agent
        </button>
      </div>
      <p className="mt-4 text-muted-foreground">
        No agents configured yet. Add your first agent to start automating tasks.
      </p>
    </div>
  );
}
