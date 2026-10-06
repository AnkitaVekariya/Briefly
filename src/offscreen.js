import { pipeline, env, TextStreamer, InterruptableStoppingCriteria } from "./vendor/transformers.min.js";

// The model lives in this offscreen document, not the side panel, so closing and reopening the panel
// doesn't reload it. Chrome keeps the document until the browser or the extension restarts.
// ponytail: holds the model in RAM all session; close the document after some idle time if memory matters.

// Everything is bundled locally: extension CSP forbids loading code from a CDN.
env.allowLocalModels = false;
env.useWasmCache = false; // runtime files are already local; Cache API rejects chrome-extension:// URLs
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL("vendor/ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("vendor/ort-wasm-simd-threaded.asyncify.wasm"),
};

// GPU: LFM2.5 summarized most accurately in testing. CPU: every LFM2 build needs GatherBlockQuantized,
// which the WASM runtime lacks, and 4-bit MatMulNBits runs ~4x slower there than int8 MatMulInteger,
// so the CPU gets Qwen3's int8 build.
const GPU = { model: "LiquidAI/LFM2.5-1.2B-Instruct-ONNX", label: "LFM2.5 1.2B on GPU" };
const CPU = { model: "onnx-community/Qwen3-0.6B-ONNX", label: "Qwen3 0.6B on CPU — slow", device: "wasm", dtype: "q8" };

let generator;
const gpuFailed = location.search === "?cpu"; // the side panel reopens us this way after the GPU dropped out
let queue = Promise.resolve(); // one model can run one generation at a time (several windows may ask)

async function loadModel(send) {
  if (generator) return generator;
  const adapter = !gpuFailed && (await navigator.gpu?.requestAdapter());
  const pick = adapter ? { ...GPU, device: "webgpu", dtype: adapter.features.has("shader-f16") ? "q4f16" : "q4" } : CPU;
  generator = await pipeline("text-generation", pick.model, {
    device: pick.device,
    dtype: pick.dtype,
    progress_callback: (p) => {
      if (p.status === "progress") send({ status: `Downloading ${p.file}… ${Math.round(p.progress)}%` });
      if (p.status === "done") send({ status: `Loading ${pick.label}…` });
    },
  });
  generator.label = pick.label;
  generator.onGpu = !!adapter;
  return generator;
}

async function summarize(port, stop, { text, title }) {
  if (stop.interrupted) return; // panel closed while this request waited in the queue
  const send = (m) => !stop.interrupted && port.postMessage(m);
  const run = async () => {
    const gen = await loadModel(send);
    send({ status: `Summarizing (${gen.label})…` });
    let summary = "";
    await gen(
      [
        {
          role: "user",
          // Small models follow an instruction placed after the text far better than a system prompt.
          content: `${text}\n\n---\nThe text above is the key sentences of a web page titled "${title}". Summarize it in 3-5 short bullet points of key facts. Use only facts from the text. No preamble.`,
        },
      ],
      {
        max_new_tokens: 150,
        do_sample: false,
        // Penalties/no_repeat_ngram also hit tokens copied from the page, which mangles names and dates.
        repetition_penalty: 1.05,
        tokenizer_encode_kwargs: { enable_thinking: false }, // Qwen3; LFM2.5's template ignores it
        stopping_criteria: stop,
        streamer: new TextStreamer(gen.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (t) => send({ summary: (summary += t) }),
        }),
      },
    );
  };
  try {
    await run();
    send({ done: true });
  } catch (e) {
    // Weak iGPUs can't finish the model's biggest matmuls before the driver's watchdog
    // (Linux i915: 640 ms) resets the GPU, which WebGPU reports as a lost device.
    // We can't retry on the CPU in this document: transformers.js chains every run onto one promise,
    // so after one failed run, every later run (CPU ones too) replays that error without running.
    // The side panel reopens this document in CPU mode instead.
    send(generator?.onGpu ? { gpuLost: true } : { error: e.message });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  const stop = new InterruptableStoppingCriteria();
  port.onDisconnect.addListener(() => stop.interrupt());
  port.onMessage.addListener((req) => (queue = queue.then(() => summarize(port, stop, req))));
});
