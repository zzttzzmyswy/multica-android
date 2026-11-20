/** Display names can repeat; the slug identifies the actual switch target. */
export function workspaceChoiceIdentity({ name, slug }: { name: string; slug: string }): string {
  return `${name} (/${slug})`;
}
