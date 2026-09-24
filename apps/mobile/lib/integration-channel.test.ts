import { describe, expect, it } from "vitest";
import {
  channelRowState,
  type ChannelInstall,
  type ChannelListingLike,
} from "./integration-channel";

const listing = (
  over: Partial<ChannelListingLike<ChannelInstall>> = {},
): ChannelListingLike<ChannelInstall> => ({
  installations: [],
  configured: true,
  install_supported: true,
  ...over,
});

describe("channelRowState", () => {
  it("is loading until the listing arrives", () => {
    expect(channelRowState(undefined, true).kind).toBe("loading");
    // A refetch over cached data keeps the previous answer rather than
    // flashing back to a spinner.
    expect(channelRowState(listing(), true).kind).toBe("loading");
    expect(channelRowState(listing(), false).kind).toBe("notConnected");
  });

  // The deployment-wide switch, and the reason the old hardcoded copy was
  // wrong: with no credentials the channel cannot be bound by anyone, so an
  // empty listing is not evidence that nobody connected it.
  it("reports an unconfigured deployment before anything else", () => {
    expect(channelRowState(listing({ configured: false }), false).kind).toBe(
      "unconfigured",
    );
    // …even when a binding exists, and even when installs are unsupported.
    expect(
      channelRowState(
        listing({
          configured: false,
          install_supported: false,
          installations: [{ status: "active", bot_user_id: "U1" }],
        }),
        false,
      ).kind,
    ).toBe("unconfigured");
  });

  it("reports coming soon when installs are off and nothing is bound", () => {
    expect(
      channelRowState(listing({ install_supported: false }), false).kind,
    ).toBe("comingSoon");
  });

  // `install_supported` gates NEW installs, not the listing: turning it off
  // must not hide bindings that already exist.
  it("still reports an existing binding when installs are off", () => {
    const state = channelRowState(
      listing({
        install_supported: false,
        installations: [{ status: "active", bot_user_id: "U1" }],
      }),
      false,
    );
    expect(state.kind).toBe("connected");
    expect(state.active).toBe(1);
  });

  it("counts active and revoked bindings separately", () => {
    const state = channelRowState(
      listing({
        installations: [
          { status: "active", bot_user_id: "U1" },
          { status: "active", bot_user_id: "U2" },
          { status: "revoked", bot_user_id: "U3" },
        ],
      }),
      false,
    );
    expect(state).toMatchObject({ kind: "connected", total: 3, active: 2, revoked: 1 });
    expect(state.botLabels).toEqual(["U1", "U2", "U3"]);
  });

  // A status the client does not know is not "active" — the safe reading is
  // that it is not live, which is what the revoked badge then says.
  it("treats an unknown status as not active", () => {
    const state = channelRowState(
      listing({ installations: [{ status: "suspended", bot_user_id: "U1" }] }),
      false,
    );
    expect(state).toMatchObject({ active: 0, revoked: 1 });
  });

  it("falls back through the channels' bot identifier fields", () => {
    expect(
      channelRowState(
        listing({ installations: [{ status: "active", bot_open_id: "ou_1" }] }),
        false,
      ).botLabels,
    ).toEqual(["ou_1"]);
    expect(
      channelRowState(
        listing({ installations: [{ status: "active", bot_id: "bot_1" }] }),
        false,
      ).botLabels,
    ).toEqual(["bot_1"]);
  });

  // DingTalk installations carry no identifier on the wire; the row shows the
  // count rather than an empty chip.
  it("drops blank and missing identifiers", () => {
    const state = channelRowState(
      listing({
        installations: [
          { status: "active" },
          { status: "active", bot_user_id: "  " },
          { status: "active", bot_user_id: "U9" },
        ],
      }),
      false,
    );
    expect(state.total).toBe(3);
    expect(state.botLabels).toEqual(["U9"]);
  });

  // An older backend that omits `configured` must not be read as configured —
  // the row would then claim the channel is bindable when it may not be.
  it("treats a missing configured flag as not configured", () => {
    expect(channelRowState({ installations: [] }, false).kind).toBe("unconfigured");
  });

  // …but a missing `install_supported` is not evidence of anything, so a
  // configured channel with no bindings reads as plainly not connected.
  it("treats a missing install_supported flag as installable", () => {
    expect(channelRowState({ installations: [], configured: true }, false).kind).toBe(
      "notConnected",
    );
  });
});
