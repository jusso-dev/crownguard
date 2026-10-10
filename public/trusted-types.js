/* eslint-env browser */
/**
 * Installed before the module bundle so React's innerHTML hoistables see a default policy.
 * Pass-through only: crownguard does not build HTML from untrusted strings in src/.
 */
(() => {
  if (!window.trustedTypes || window.trustedTypes.defaultPolicy) return;
  window.trustedTypes.createPolicy("default", {
    createHTML: (s) => s,
    createScript: (s) => s,
    createScriptURL: (s) => s,
  });
})();
