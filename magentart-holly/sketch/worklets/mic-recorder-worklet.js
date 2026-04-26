class MicRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled = false;
    this.port.onmessage = (ev) => {
      const d = ev && ev.data ? ev.data : {};
      if (d.type === 'start') this._enabled = true;
      if (d.type === 'stop') this._enabled = false;
    };
  }

  process(inputs) {
    if (!this._enabled) return true;
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    // Copy out of the render thread buffer.
    const out = new Float32Array(input.length);
    out.set(input);
    this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
    return true;
  }
}

registerProcessor('mic-recorder', MicRecorderProcessor);

