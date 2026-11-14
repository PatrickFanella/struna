let ctx: AudioContext | undefined;

/** One AudioContext for the app, created and resumed on a user gesture (iOS requires it). */
export function audio(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
