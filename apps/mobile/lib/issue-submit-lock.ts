/** One non-queuing submit gate shared by both modes of a create form. */
export function createIssueSubmitLock() {
  let active = false;
  return {
    get busy() {
      return active;
    },
    async run(action: () => Promise<unknown>): Promise<boolean> {
      if (active) return false;
      active = true;
      try {
        await action();
        return true;
      } finally {
        active = false;
      }
    },
  };
}
