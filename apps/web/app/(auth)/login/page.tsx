"use client";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-bold">Multica</h1>
        <p className="text-muted-foreground">AI-native task management</p>
        <button className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
