/**
 * Timing for the two components that keep an element mounted for its exit
 * animation. The values match the exit keyframes in styles.css; change both
 * together.
 */
export const dialogExitMs = 120;
export const toastExitMs = 140;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the OS asks for reduced motion. Callers that would hold an element
 * on screen for an exit beat skip the beat instead of freezing it.
 */
export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION_QUERY).matches;
