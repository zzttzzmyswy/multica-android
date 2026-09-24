/**
 * Workspace-level channel-row state for the integrations page (iteration 169).
 *
 * The four IM rows used to render a hardcoded "not connected" regardless of
 * what the server said, which is a false statement rather than a missing
 * feature: on a deployment with no Lark / Slack / DingTalk / WeCom credentials
 * the channels cannot be bound at all, and "not connected" invites the reader
 * to go and connect one.
 *
 * Branch order mirrors web's workspace tabs (slack-tab.tsx:94-116 and its
 * siblings), which is also the order the server's fields imply:
 *
 *   1. `configured` false  → the deployment has no credentials for this
 *      channel; nothing anyone does in the UI can bind it.
 *   2. `install_supported` false with nothing bound → the channel is not
 *      accepting NEW installs yet ("coming soon"). An existing binding still
 *      renders as connected — the flag gates installs, not the listing.
 *   3. bindings present → connected, with the revoked ones called out.
 *   4. otherwise → not connected (the only case where the old copy was true).
 *
 * Pure and React-free so the Node-only vitest lane can pin it.
 */

/** The fields the row reads off an installation. Structural so all four
 *  channel schemas fit, and so a channel that carries no bot identifier
 *  (DingTalk) simply contributes none. */
export interface ChannelInstall {
  status: string;
  bot_open_id?: string;
  bot_user_id?: string;
  bot_id?: string;
}

export interface ChannelListingLike<T extends ChannelInstall> {
  installations: T[];
  configured?: boolean;
  install_supported?: boolean;
}

export type ChannelRowKind =
  | "loading"
  | "unconfigured"
  | "comingSoon"
  | "connected"
  | "notConnected";

export interface ChannelRowState {
  kind: ChannelRowKind;
  /** Bindings in the listing, revoked included. */
  total: number;
  /** Bindings whose status is "active". */
  active: number;
  /** Bindings kept for audit but no longer live. */
  revoked: number;
  /** Bot identifiers to show under the status line, in listing order. */
  botLabels: string[];
}

const EMPTY: ChannelRowState = {
  kind: "loading",
  total: 0,
  active: 0,
  revoked: 0,
  botLabels: [],
};

/** The identifier a channel's installation carries, or "" when the wire
 *  format has none (DingTalk). Blank identifiers are dropped rather than
 *  rendered as an empty chip. */
function botLabel(install: ChannelInstall): string {
  return (install.bot_open_id || install.bot_user_id || install.bot_id || "").trim();
}

/**
 * Derive the row's state from its channel listing.
 *
 * `pending` is react-query's `isPending` — true only while there is no data
 * at all. A refetch over cached data keeps rendering the previous answer
 * instead of flashing back to a spinner.
 */
export function channelRowState<T extends ChannelInstall>(
  listing: ChannelListingLike<T> | undefined,
  pending: boolean,
): ChannelRowState {
  if (pending || !listing) return EMPTY;

  const installations = listing.installations ?? [];
  const total = installations.length;
  const active = installations.filter((i) => i.status === "active").length;
  const revoked = total - active;
  const botLabels = installations
    .map(botLabel)
    .filter((label) => label.length > 0);

  // `configured` gates everything: without deployment credentials the channel
  // cannot be bound by anyone, so a listing that happens to be empty is not
  // evidence that nobody has connected it.
  if (listing.configured !== true) {
    return { kind: "unconfigured", total, active, revoked, botLabels };
  }
  if (listing.install_supported === false && total === 0) {
    return { kind: "comingSoon", total, active, revoked, botLabels };
  }
  if (total > 0) {
    return { kind: "connected", total, active, revoked, botLabels };
  }
  return { kind: "notConnected", total, active, revoked, botLabels };
}
