const note = document.getElementById("note");

document.getElementById("open").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  window.close();
});

document.getElementById("speak").addEventListener("click", () => {
  chrome.tts.speak("Text to speech is running from the extension popup.", {
    rate: 1,
    enqueue: false,
  });
  note.textContent = "Sent to chrome.tts.";
});

// Kept deliberately, so you can watch it fail. If the permission has already
// been granted on the extension origin there is no prompt, so this succeeds.
// If it has not, the popup loses focus, unloads, and the promise never settles.
document.getElementById("tryMic").addEventListener("click", async () => {
  note.textContent = "Requesting…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    note.textContent = "Mic granted — permission was already on file.";
  } catch (err) {
    note.textContent = `Failed: ${err.name}`;
  }
});
