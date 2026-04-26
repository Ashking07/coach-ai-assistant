export interface AudioCapture {
  start(onChunk: (buf: ArrayBuffer) => void): Promise<void>;
  stop(): void;
}

export function createAudioCapture(): AudioCapture {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;

  return {
    async start(onChunk) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'pcm-downsampler');
      node.port.onmessage = (ev) => onChunk(ev.data as ArrayBuffer);
      source.connect(node);
    },
    stop() {
      node?.disconnect();
      node = null;
      void ctx?.close();
      ctx = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    },
  };
}
