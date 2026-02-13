import ChatPage from "@/components/pages/chat-page";
import { AuthGuard } from "@/components/auth-guard";

export default function Page() {
  return (
    <AuthGuard>
      <ChatPage />
    </AuthGuard>
  );
}
