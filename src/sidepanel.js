import { extract } from "./extract.js";

// Prompt reading cost grows faster than its length: on a 2017 i5 CPU, 2.5k chars took ~47 s end to end,
// 6k chars ~4.7 min. So we hand the model the page's most informative sentences, not the whole page.
const TEXT_BUDGET = 2500;

const $ = (id) => document.getElementById(id);
let shownUrl; // the panel is shared by all tabs; it shows the active tab's summary

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Summaries live in session storage keyed by URL, so they survive tab switches and closing the panel.
async function show() {
  const tab = await activeTab();
  shownUrl = tab.url;
  const { [tab.url]: cached } = await chrome.storage.session.get(tab.url);
  $("output").textContent = cached?.summary ?? "";
  $("status").textContent = "";
}
chrome.tabs.onActivated.addListener(show);
chrome.tabs.onUpdated.addListener((_, info) => info.url && show());
show();

async function pageText(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (document.querySelector("article, main") || document.body).innerText,
  });
  return extract(result, TEXT_BUDGET);
}

// The model runs in offscreen.html, which outlives this panel, so it's loaded once per browser session.
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  const { gpuFailed } = await chrome.storage.session.get("gpuFailed");
  await chrome.offscreen.createDocument({
    url: gpuFailed ? "offscreen.html?cpu" : "offscreen.html", // CPU until the browser restarts
    reasons: ["WORKERS"],
    justification: "Keep the summarization model loaded between side panel sessions.",
  });
}

$("go").onclick = async () => {
  $("go").disabled = true;
  const tab = await activeTab();
  const { url, title } = tab;
  // The user may switch tabs mid-run: only touch the panel while it still shows this page.
  const say = (s) => shownUrl === url && ($("status").textContent = s);
  let summary = "";
  const paint = () => shownUrl === url && ($("output").textContent = summary);
  try {
    const text = await pageText(tab);
    if (!text) throw new Error("No readable text on this page.");
    const { [url]: cached } = await chrome.storage.session.get(url);
    if (cached?.text === text) return void say("Same page as before, kept the summary.");
    paint();
    say("Starting…");
    // Resolves true if the GPU dropped out mid-run (see offscreen.js).
    const ask = async () => {
      await ensureOffscreen();
      return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: "summarize" });
        port.onDisconnect.addListener(() => reject(new Error(chrome.runtime.lastError?.message ?? "Model page closed.")));
        port.onMessage.addListener((m) => {
          if (m.status) say(m.status);
          if (m.summary) {
            summary = m.summary;
            paint();
          }
          if (m.error) reject(new Error(m.error));
          if (m.done || m.gpuLost) resolve(!!m.gpuLost);
          if (m.error || m.done || m.gpuLost) port.disconnect();
        });
        port.postMessage({ text, title });
      });
    };
    if (await ask()) {
      await chrome.storage.session.set({ gpuFailed: true });
      await chrome.offscreen.closeDocument();
      await ask();
    }
    await chrome.storage.session.set({ [url]: { text, summary } });
    say("Done.");
  } catch (e) {
    say(`Error: ${e.message}`);
  } finally {
    $("go").disabled = false;
  }
};
