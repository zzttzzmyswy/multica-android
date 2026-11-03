// @vitest-environment jsdom

/**
 * The cloud runtime dialog's node timestamps must follow the APP locale
 * (iteration 284, MYS-2580).
 *
 * `formatDateTime` used `Intl.DateTimeFormat(undefined, …)`, and an undefined
 * locale is not "the app's language" — it is `navigator.language`. A member
 * reading the Chinese UI in an English-language browser therefore got
 * "Nov 2, 09:30 AM" inside an otherwise Chinese dialog. `i18n/use-locale.ts`
 * exists to prevent exactly this, and its docstring names the symptom.
 *
 * Rendering through the real provider at `locale="zh-Hans"` is what makes this
 * a regression test rather than a unit test of a helper: it fails both when
 * the call site omits the locale AND when it hardcodes a tag, because in the
 * second case the zh case renders English.
 */
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import type { CloudRuntimeNode } from "@multica/core/runtimes";
import type { SupportedLocale } from "@multica/core/i18n";
import { renderWithI18n } from "../../test/i18n";

function makeNode(overrides: Partial<CloudRuntimeNode> = {}): CloudRuntimeNode {
  return {
    id: "node-1",
    owner_id: "user-1",
    instance_id: "i-0001",
    region: "us-east-1",
    instance_type: "t4g.medium",
    image_id: "ami-0001",
    subnet_id: "subnet-0001",
    name: "build-node",
    status: "running",
    tags: {},
    metadata: {},
    created_at: "2026-11-02T09:30:00Z",
    updated_at: "2026-11-02T09:30:00Z",
    ...overrides,
  };
}

const NODE = makeNode();

// The dialog's own hooks reach the API singleton; none of them feed the row
// timestamp. `cloudRuntimeNodeListOptions` is replaced with a stable key so the
// test can seed that exact query.
const NODES_KEY = ["test", "cloud-runtime-nodes"];

vi.mock("@multica/core/runtimes", async () => {
  const actual = await vi.importActual<
    typeof import("@multica/core/runtimes")
  >("@multica/core/runtimes");
  return {
    ...actual,
    cloudRuntimeNodeListOptions: () => ({
      queryKey: ["test", "cloud-runtime-nodes"],
      queryFn: () => Promise.resolve([]),
    }),
    useCreateCloudRuntimeNode: () => ({
      mutate: vi.fn(),
      isPending: false,
      mutateAsync: vi.fn(),
    }),
    useDeleteCloudRuntimeNode: () => ({
      mutate: vi.fn(),
      isPending: false,
      mutateAsync: vi.fn(),
    }),
  };
});

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { CloudRuntimeDialog } from "./cloud-runtime-dialog";

// Pin TZ so 09:30Z renders as 09:30 on any machine. Set at module scope: the
// formatter reads the process TZ when Intl builds the string, and a per-test
// assignment would race the first render's memoization.
process.env.TZ = "UTC";

function renderDialog(locale: SupportedLocale) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(NODES_KEY, [NODE]);
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <CloudRuntimeDialog onClose={() => {}} />
    </QueryClientProvider>,
    { locale },
  );
}

describe("cloud runtime dialog node timestamps", () => {
  it("renders the node timestamp in Chinese for a zh-Hans app locale", () => {
    renderDialog("zh-Hans");
    // "11月2日 09:30" — a string the device-locale fallback cannot produce
    // under the en-US test runner, so this fails on the pre-fix formatter.
    expect(screen.getByText(/11月2日/)).toBeInTheDocument();
  });

  it("renders the node timestamp in English for an en app locale", () => {
    renderDialog("en");
    expect(screen.getByText(/Nov 2/)).toBeInTheDocument();
  });
});
