"use client";

import { useState } from "react";
import { Settings, Users, Building2, Save, Crown, Shield, User } from "lucide-react";
import type { MemberWithUser, MemberRole } from "@multica/types";
import { useAuth } from "../../../lib/auth-context";
import { api } from "../../../lib/api";

const roleConfig: Record<MemberRole, { label: string; icon: typeof Crown }> = {
  owner: { label: "Owner", icon: Crown },
  admin: { label: "Admin", icon: Shield },
  member: { label: "Member", icon: User },
};

function MemberRow({ member }: { member: MemberWithUser }) {
  const rc = roleConfig[member.role];
  const RoleIcon = rc.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {member.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{member.name}</div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RoleIcon className="h-3 w-3" />
        {rc.label}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { workspace, members, updateWorkspace } = useAuth();

  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(
    workspace?.description ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!workspace) return;
    setSaving(true);
    try {
      const updated = await api.updateWorkspace(workspace.id, {
        name,
        description: description || undefined,
      });
      updateWorkspace(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to update workspace", e);
    } finally {
      setSaving(false);
    }
  };

  if (!workspace) return null;

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      {/* Workspace info */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Workspace</h2>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="What does this workspace focus on?"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Slug
            </label>
            <div className="mt-1 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {workspace.slug}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            {saved && (
              <span className="text-xs text-green-600">Saved!</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </section>

      {/* Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              Members ({members.length})
            </h2>
          </div>
        </div>

        <div className="space-y-2">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">No members found.</p>
          )}
        </div>
      </section>
    </div>
  );
}
