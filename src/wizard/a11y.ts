/** Move focus to the current step heading after wizard navigation. */
export function focusStepHeading() {
  document.getElementById("step-heading")?.focus();
}

/** Announce a step change for screen readers (polite live region). */
export function announceStep(step: number, total: number, name: string) {
  const el = document.getElementById("step-announce");
  if (!el) return;
  // Clear first so the same text is re-announced when revisiting a step.
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = `Step ${step} of ${total}, ${name}`;
  });
}

/** After `go`, focus the new heading and announce the step. Shared so Soc/AI internal focus stays separate. */
export function afterStepChange(step: number, total: number, name: string) {
  requestAnimationFrame(() => {
    focusStepHeading();
    announceStep(step + 1, total, name);
  });
}
