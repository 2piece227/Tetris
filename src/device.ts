/**
 * Is this page running in a standalone headset's browser?
 *
 * The booth runs the same site on two kinds of device: the Quest, which only
 * ever plays VR, and the PC at the monitor, which runs review and versus. Those
 * two are flat-screen keyboard modes and are kept off the headset entirely.
 *
 * Read from the user agent rather than from WebXR support: a desktop browser
 * with a PC-tethered headset plugged in also reports immersive-vr, and that
 * machine should still get the full menu. `?device=quest` forces the answer
 * so the headset menu can be checked from a desktop.
 */
export function isHeadset(): boolean {
  const forced = new URLSearchParams(window.location.search).get("device");
  if (forced) return forced === "quest";
  return /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
}

/** Send a headset back to the menu if it lands on a flat-screen-only page. */
export function keepOffHeadset(): void {
  if (isHeadset()) window.location.replace("./");
}
