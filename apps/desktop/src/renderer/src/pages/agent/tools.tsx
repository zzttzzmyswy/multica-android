import { useToolsStore } from '../../stores/tools'
import { ToolList } from '../../components/tool-list'

export default function ToolsPage() {
  const { tools, loading, error, toggleTool, refresh } = useToolsStore()

  return (
    <div className="h-full overflow-auto">
      <div className="container p-6">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-lg font-medium">Tools</h1>
          <p className="text-sm text-muted-foreground">
            Toggle tools to control what your agent can do.
          </p>
        </div>

        {/* Content */}
        <ToolList
          tools={tools}
          loading={loading}
          error={error}
          onToggleTool={toggleTool}
          onRefresh={refresh}
        />
      </div>
    </div>
  )
}
