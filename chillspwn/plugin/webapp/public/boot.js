(() => {
  let failed = false;

  function showRetry(reason) {
    if (failed) return;
    failed = true;
    const message = document.getElementById("boot-msg");
    const actions = document.getElementById("boot-actions");
    if (!message || !actions) return;
    message.textContent = `Couldn't load the app${reason ? ` (${reason})` : ""}`;
    message.classList.add("boot-failed");
    const retry = document.createElement("button");
    retry.id = "boot-retry";
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      try {
        if (window.caches?.keys) {
          void window.caches.keys().then((keys) => {
            for (const key of keys) void window.caches.delete(key);
          });
        }
      } catch {
        // A cache cleanup failure must not prevent the recovery navigation.
      }
      window.location.replace(`${window.location.pathname}?_=${Date.now()}`);
    });
    actions.replaceChildren(retry);
  }

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) showRetry("asset");
  }, true);

  window.setTimeout(() => {
    const root = document.getElementById("root");
    if (root && document.getElementById("boot") && root.children.length <= 1) showRetry("timeout");
  }, 9_000);
})();
