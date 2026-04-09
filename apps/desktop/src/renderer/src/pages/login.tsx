import { useNavigate } from "react-router-dom";
import { LoginPage } from "@multica/views/auth";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export function DesktopLoginPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col">
      {/* Traffic light inset */}
      <div
        className="h-[38px] shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <LoginPage
        logo={<MulticaIcon bordered size="lg" />}
        onSuccess={() => navigate("/issues", { replace: true })}
      />
    </div>
  );
}
