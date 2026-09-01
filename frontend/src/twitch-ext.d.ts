/**
 * The Twitch extension helper, injected by the script tag in each HTML entry
 * point rather than imported.
 *
 * Declared once, here, because both the overlay and the config page use it and
 * two `declare global` blocks for the same property are a type error — and worse,
 * would let the two pages disagree about the API they share.
 *
 * Only the parts we actually call are typed. The helper is much larger; adding
 * unused surface would just be untested assertions about someone else's API.
 */
declare global {
  interface Window {
    Twitch?: {
      ext: {
        /** Fires once the viewer or broadcaster context is established. */
        onAuthorized(cb: (auth: { channelId: string }) => void): void;

        /** Subscribe to a PubSub topic. The overlay listens on "broadcast". */
        listen(
          topic: string,
          cb: (target: string, type: string, message: string) => void,
        ): void;

        configuration: {
          /** The stored broadcaster segment, absent until the config page saves. */
          broadcaster?: { content: string };

          /** Write the broadcaster segment. Config page only. */
          set(segment: "broadcaster", version: string, content: string): void;

          /** Fires when a segment changes, including the initial delivery. */
          onChanged(cb: () => void): void;
        };
      };
    };
  }
}

export {};
