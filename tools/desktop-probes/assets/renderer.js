// This asset deliberately executes in the ordinary renderer world.
document.documentElement.dataset.privilegedGlobals = String(
  typeof window.require !== "undefined" || typeof window.process !== "undefined",
);
document.documentElement.dataset.ready = "true";
