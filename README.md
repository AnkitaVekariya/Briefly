# Briefly

Chrome extension that summarizes the current page with a small LLM running **on your device**. No API, no backend. The model downloads from Hugging Face once, gets cached by the browser, and runs on WebGPU (or falls back to WASM on the CPU).

## Setup

```sh
npm install        # also copies the runtime into src/vendor/
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `src/` folder.
3. Click the Briefly icon to open the side panel, then click **Summarize this page**.

The first run downloads the model (about 0.6 GB on CPU, 0.8 GB with a GPU). After that it stays loaded in memory until Chrome or the extension restarts, so closing and reopening the panel doesn't reload it. Each page's summary is kept too: switching back to a tab shows its summary, and clicking again on an unchanged page reuses it.

## How it works

1. Grabs the page text (`<article>`, `<main>`, or the whole body).
2. Picks the most informative sentences from across the whole page, up to ~2,500 characters. Each sentence is scored by how common its words are on the page; short fragments like buttons and nav links are dropped.
3. One pass of a small LLM turns those sentences into 3-5 bullet points, streamed into the side panel.

Step 2 exists because the model's reading time grows faster than the input length. On a 2017 i5 laptop CPU, 2,500 characters takes about a minute end to end; 6,000 took almost 5.

## Models (picked automatically)

| Runs on | Model | Download | Why |
|---|---|---|---|
| GPU (WebGPU) | LFM2.5-1.2B-Instruct, 4-bit | ~760 MB | Most accurate in testing. |
| CPU | Qwen3-0.6B, int8 | ~620 MB | The CPU runtime (WebAssembly) can't run any LFM2 build: they need `GatherBlockQuantized`, which it lacks. Int8 (`MatMulInteger`) also runs about 4× faster there than 4-bit (`MatMulNBits`). |

Dropped after testing: Qwen2.5-0.5B (loops, makes up facts), SmolLM2-360M (repeats the input), Gemma 3 (262k-token vocabulary, too memory-hungry on CPU).

## Files

- `src/manifest.json`: MV3 manifest
- `src/background.js`: opens the side panel when you click the icon
- `src/extract.js`: picks the key sentences (`npm test`)
- `src/sidepanel.html` / `src/sidepanel.js`: UI, page text, per-page summary cache
- `src/offscreen.html` / `src/offscreen.js`: loads the model once and summarizes via [transformers.js](https://github.com/huggingface/transformers.js); falls back to the CPU if the GPU crashes
