import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/platform/auth";
import { useWorkspaceStore } from "@/platform/workspace";
import { api } from "@/platform/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import { Label } from "@multica/ui/components/ui/label";
import { MulticaIcon } from "../components/multica-icon";
import { TitleBar } from "../components/title-bar";

export function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendCode = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await useAuthStore.getState().sendCode(email);
      setStep("code");
    } catch {
      setError("Failed to send code");
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleVerify = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await useAuthStore.getState().verifyCode(email, code);
      const wsList = await api.listWorkspaces();
      useWorkspaceStore.getState().hydrateWorkspace(wsList);
      navigate("/issues", { replace: true });
    } catch {
      setError("Invalid code");
    } finally {
      setLoading(false);
    }
  }, [email, code, navigate]);

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <div className="flex flex-1 items-center justify-center">
        <Card className="w-[380px]">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <MulticaIcon bordered size="lg" />
            </div>
            <CardTitle>Sign in to Multica</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Enter your email to get a login code"
                : `We sent a code to ${email}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "email" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendCode();
                }}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button className="w-full" disabled={!email || loading}>
                    {loading ? "Sending..." : "Send Code"}
                  </Button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerify();
                }}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Verification Code</Label>
                    <Input
                      id="code"
                      placeholder="Enter 6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button className="w-full" disabled={!code || loading}>
                    {loading ? "Verifying..." : "Verify"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError("");
                    }}
                  >
                    Back
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
