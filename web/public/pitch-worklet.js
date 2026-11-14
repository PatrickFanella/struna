// Collects microphone samples and posts overlapping frames of 4096 samples every 1024.
class PitchFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.hop = 1024;
    this.buf = new Float32Array(this.size);
    this.filled = 0;
    this.sinceHop = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;
    if (this.filled + n > this.size) {
      const drop = this.filled + n - this.size;
      this.buf.copyWithin(0, drop, this.filled);
      this.filled -= drop;
    }
    this.buf.set(ch, this.filled);
    this.filled += n;
    this.sinceHop += n;
    if (this.filled === this.size && this.sinceHop >= this.hop) {
      this.sinceHop = 0;
      this.port.postMessage(this.buf.slice(0));
    }
    return true;
  }
}
registerProcessor("pitch-frames", PitchFrames);
