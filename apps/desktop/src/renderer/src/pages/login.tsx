import { useNavigate } from "react-router-dom";
import { LoginPage } from "@multica/views/auth";
import { MulticaIcon } from "../components/multica-icon";
import { TitleBar } from "../components/title-bar";

export function DesktopLoginPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <LoginPage
        logo={<MulticaIcon bordered size="lg" />}
        onSuccess={() => navigate("/issues", { replace: true })}
      />
    </div>
  );
}
