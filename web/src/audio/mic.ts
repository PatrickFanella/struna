export class MicDenied extends Error {
  readonly reason: "denied" | "missing" | "unavailable";
  constructor(message: string, reason: "denied" | "missing" | "unavailable" = "denied") {
    super(message);
    this.reason = reason;
  }
}

/** Raw microphone: no echo cancellation, noise suppression or auto gain, which distort pitch on iOS. */
export async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicDenied("This browser has no microphone access here.", "unavailable");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotFoundError" || name === "DevicesNotFoundError") throw new MicDenied("No microphone was found. Connect one, then try again.", "missing");
    if (name === "NotReadableError" || name === "TrackStartError") throw new MicDenied("The microphone is unavailable. Check its connection or other apps using it, then try again.", "unavailable");
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicDenied("Allow the microphone for this site in the browser settings, then try again.");
    throw e;
  }
}

export function stopMic(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

/** The recorder asks tuner users to release their own streams before it starts. */
export const micUsers = new EventTarget();
