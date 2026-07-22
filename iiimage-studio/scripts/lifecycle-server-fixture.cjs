"use strict";

let closing = false;
let heartbeat = null;

function close() {
  if (closing) return;
  closing = true;
  if (heartbeat) clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("message", (message) => {
  if (message === "shutdown") close();
});

heartbeat = setInterval(() => undefined, 1_000);
