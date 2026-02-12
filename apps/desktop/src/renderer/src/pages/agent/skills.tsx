import { useSkillsStore } from '../../stores/skills'
import { SkillList } from '../../components/skill-list'

export default function SkillsPage() {
  const { skills, loading, error, toggleSkill, refresh } = useSkillsStore()

  return (
    <div className="h-full overflow-auto">
      <div className="container p-6">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-lg font-medium">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Skills are modular capabilities that expand what your agent can do.
          </p>
        </div>

        {/* Content */}
        <SkillList
          skills={skills}
          loading={loading}
          error={error}
          onToggleSkill={toggleSkill}
          onRefresh={refresh}
        />
      </div>
    </div>
  )
}
