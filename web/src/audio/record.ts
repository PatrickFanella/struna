import { openMic, stopMic } from "./mic.ts";

export function pickRecorderType(isSupported: (t: string) => boolean): { mime: string; ext: "webm" | "m4a" } {
  if (isSupported("audio/webm;codecs=opus")) return { mime: "audio/webm;codecs=opus", ext: "webm" };
  if (isSupported("audio/mp4")) return { mime: "audio/mp4", ext: "m4a" };
  if (isSupported("audio/webm")) return { mime: "audio/webm", ext: "webm" };
  return { mime: "", ext: "webm" };
}

export type Take = { blob: Blob; ext: "webm" | "m4a"; seconds: number };

/** An audio-only take from the raw microphone. */
export class TakeRecorder {
  private stream: MediaStream | undefined;
  private rec: MediaRecorder | undefined;
  private chunks: Blob[] = [];
  private started = 0;
  private type = pickRecorderType((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));

  async start(): Promise<void> {
    this.stream = await openMic();
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, this.type.mime ? { mimeType: this.type.mime } : {});
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
    this.started = performance.now();
  }

  stop(): Promise<Take> {
    const rec = this.rec;
    if (!rec) return Promise.reject(new Error("not recording"));
    return new Promise((resolve) => {
      rec.onstop = () => {
        stopMic(this.stream);
        const mime = rec.mimeType || this.type.mime || "audio/webm";
        resolve({ blob: new Blob(this.chunks, { type: mime }), ext: /mp4|m4a|aac/.test(mime) ? "m4a" : "webm", seconds: (performance.now() - this.started) / 1000 });
      };
      rec.stop();
    });
  }

  cancel(): void {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
    stopMic(this.stream);
  }
}
