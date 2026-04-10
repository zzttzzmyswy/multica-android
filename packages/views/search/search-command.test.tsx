import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCommand } from "./search-command";
import { useSearchStore } from "./search-store";

const { mockPush, mockSearchIssues } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchIssues: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    searchIssues: mockSearchIssues,
  },
}));

vi.mock("@multica/core/issues/stores", () => ({
  useRecentIssuesStore: (selector?: (state: { items: [] }) => unknown) => {
    const state = { items: [] as [] };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({
    push: mockPush,
  }),
}));

describe("SearchCommand", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchIssues.mockReset().mockResolvedValue({ issues: [] });

    act(() => {
      useSearchStore.setState({ open: true });
    });
  });

  it("closes on a single Escape press from the search input", async () => {
    const user = userEvent.setup();

    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("Type a command or search...");
    await user.click(input);

    expect(useSearchStore.getState().open).toBe(true);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(useSearchStore.getState().open).toBe(false);
    });
    expect(screen.queryByPlaceholderText("Type a command or search...")).not.toBeInTheDocument();
  });
});
