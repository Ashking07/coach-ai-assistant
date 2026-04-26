class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputSampleRate = sampleRate;
    this._targetSampleRate = 16000;
    this._ratio = this._inputSampleRate / this._targetSampleRate;
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    let i = 0;
    while (i < ch.length) {
      const idx = Math.floor(i);
      this._buffer.push(ch[idx]);
      i += this._ratio;
    }

    while (this._buffer.length >= 320) {
      const chunk = this._buffer.splice(0, 320);
      const pcm = new Int16Array(chunk.length);
      for (let j = 0; j < chunk.length; j += 1) {
        const s = Math.max(-1, Math.min(1, chunk[j]));
        pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
