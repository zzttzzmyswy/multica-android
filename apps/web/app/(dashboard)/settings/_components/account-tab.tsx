"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuthStore } from "@/features/auth";
import { api } from "@/shared/api";

export function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    setProfileName(user?.name ?? "");
    setAvatarUrl(user?.avatar_url ?? "");
  }, [user]);

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const updated = await api.updateMe({
        name: profileName,
        avatar_url: avatarUrl || undefined,
      });
      setUser(updated);
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Profile</h2>

        <Card>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                type="search"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Avatar URL</Label>
              <Input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="mt-1"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleProfileSave}
                disabled={profileSaving || !profileName.trim()}
              >
                <Save className="h-3 w-3" />
                {profileSaving ? "Updating..." : "Update Profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
