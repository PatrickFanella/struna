export class MicDenied extends Error {}

/** Raw microphone: no echo cancellation, noise suppression or auto gain, which distort pitch on iOS. */
export async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicDenied("This browser has no microphone access here.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") throw new MicDenied(String((e as Error).message ?? e));
    throw e;
  }
}

export function stopMic(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

/** Lets the recorder close the tuner: they never hold the microphone at the same time. */
export const micUsers = new EventTarget();
