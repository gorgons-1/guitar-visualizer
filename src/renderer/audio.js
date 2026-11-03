/* Sound output (plucked-string synth) and live input (mic / USB guitar interface). */
(function () {
  'use strict';
  const T = window.Theory;

  class Synth {
    constructor() {
      this.ctx = null;
      this.cache = new Map();
      this.active = new Set();
    }

    context() {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    // Karplus-Strong plucked string, rendered once per note and cached.
    buffer(midi) {
      if (this.cache.has(midi)) return this.cache.get(midi);
      const ctx = this.context();
      const sr = ctx.sampleRate;
      const freq = T.midiToFreq(midi);
      const len = Math.floor(sr * 2.5);
      const period = Math.max(2, Math.round(sr / freq));
      const buf = ctx.createBuffer(1, len, sr);
      const y = buf.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < period; i++) {
        const noise = Math.random() * 2 - 1;
        prev = prev * 0.5 + noise * 0.5; // slightly softened pick
        y[i] = prev;
      }
      const decay = freq < 150 ? 0.998 : 0.996;
      for (let i = period; i < len; i++) y[i] = decay * 0.5 * (y[i - period] + y[i - period - 1 >= 0 ? i - period - 1 : 0]);
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
      const fade = Math.floor(sr * 0.2);
      for (let i = 0; i < len; i++) {
        y[i] = (y[i] / (peak || 1)) * 0.6;
        if (i > len - fade) y[i] *= (len - i) / fade;
      }
      this.cache.set(midi, buf);
      return buf;
    }

    play(midi, delay = 0, gain = 0.7) {
      const ctx = this.context();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer(midi);
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.master);
      src.start(ctx.currentTime + delay);
      this.active.add(src);
      src.onended = () => this.active.delete(src);
    }

    stopAll() {
      for (const src of this.active) {
        try { src.stop(); } catch { /* already stopped */ }
      }
      this.active.clear();
    }
  }

  class LiveInput {
    constructor(getContext) {
      this.getContext = getContext;
      this.stream = null;
      this.timer = null;
      this.threshold = 0.01;
    }

    get active() {
      return !!this.stream;
    }

    async devices() {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    }

    async start({ deviceId, channel, monitor, minFreq, maxFreq, onFrame }) {
      this.stop();
      const ctx = this.getContext();
      const audio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });

      this.source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.monitorGain = ctx.createGain();
      this.monitorGain.gain.value = monitor ? 1 : 0;
      this.monitorGain.connect(ctx.destination);

      // USB interfaces often put the guitar on input 1 only, so allow picking a channel.
      let signal = this.source;
      if (channel === '0' || channel === '1') {
        this.splitter = ctx.createChannelSplitter(2);
        this.merger = ctx.createGain();
        this.source.connect(this.splitter);
        this.splitter.connect(this.merger, Number(channel));
        signal = this.merger;
      }
      signal.connect(this.analyser);
      signal.connect(this.monitorGain);

      const buf = new Float32Array(this.analyser.fftSize);
      const sr = ctx.sampleRate;
      this.timer = setInterval(() => {
        this.analyser.getFloatTimeDomainData(buf);
        const level = window.Pitch.rms(buf);
        // Level of only the newest ~20 ms, so a pick attack shows up as a sudden jump.
        const attackLevel = window.Pitch.rms(buf.subarray(buf.length - 1024));
        const { freq, clarity } = level >= this.threshold
          ? window.Pitch.analyze(buf, sr, { minFreq, maxFreq })
          : { freq: -1, clarity: 0 };
        onFrame({ level, attackLevel, freq, clarity });
      }, 50);

      const track = this.stream.getAudioTracks()[0];
      return track ? track.label : '';
    }

    setMonitor(on) {
      if (this.monitorGain) this.monitorGain.gain.value = on ? 1 : 0;
    }

    stop() {
      clearInterval(this.timer);
      this.timer = null;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      for (const node of [this.source, this.splitter, this.merger, this.analyser, this.monitorGain]) {
        try { node && node.disconnect(); } catch { /* ignore */ }
      }
      this.stream = this.source = this.splitter = this.merger = this.analyser = this.monitorGain = null;
    }
  }

  window.GVAudio = { Synth, LiveInput };
})();
