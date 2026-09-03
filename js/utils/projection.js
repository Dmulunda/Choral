// Shared sync mechanism between the operator panel
// (projectionControl.js) and the standalone projector display
// (projectorPage.js) — a native BroadcastChannel, not a network call.
// Operator and projector only ever work as two windows on the SAME
// computer in real use (one laptop, HDMI out to the projector), so
// there's no reason this needs the internet at all: BroadcastChannel
// is same-origin, same-browser messaging built into every browser,
// and it keeps working with no internet connection once the page
// itself has loaded.
//
// Message shapes (both sides agree on these, nothing else coordinates
// it):
//   { event: 'show', payload: {...} } — what's live. payload.kind is
//     'bible' | 'song' | 'image' | 'video' | 'blank'; image/video
//     carry the actual local file as payload.blob (structured-cloned
//     across the channel, same as any other value) rather than a URL.
//   { event: 'backdrop', blob } — the background image, independent
//     of individual show events since it persists across many of them
//     until changed.
//   { event: 'hello' } — sent by the projector on connect/reconnect;
//     the operator answers with its current 'show' and 'backdrop'.
const CHANNEL_NAME = 'church-projection';

export function createProjectionChannel() {
  return new BroadcastChannel(CHANNEL_NAME);
}
