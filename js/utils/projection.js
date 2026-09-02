// Shared constant between the operator panel (projectionControl.js)
// and the standalone projector display (projectorPage.js). There's no
// DB row for "what's on screen right now" — it's a pure Supabase
// Realtime Broadcast channel, so the two sides only need to agree on
// this name and the payload shape:
//   { kind: 'bible', reference: 'John 3:16', lines: ['...'] }
//   { kind: 'song', reference: 'Amazing Grace', lines: ['...', '...'] }
//   { kind: 'blank' }
export const PROJECTION_CHANNEL = 'church-projection';
