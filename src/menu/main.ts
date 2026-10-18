import { isHeadset } from "../device";
import "./page.css";

if (isHeadset()) document.body.classList.add("headset");

// Number keys pick a mode, for a booth PC with a keyboard and no mouse to hand.
window.addEventListener("keydown", (e) => {
  const card = document.querySelector<HTMLAnchorElement>(`.mode[data-key="${e.key}"]`);
  if (card && card.offsetParent !== null) card.click();
});
