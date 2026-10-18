import { keepOffHeadset } from "../device";
import "../menu/page.css";

keepOffHeadset();

const form = document.getElementById("form") as HTMLFormElement;
const submit = document.getElementById("submit") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const boxes = [...form.querySelectorAll<HTMLInputElement>(".digits input")];

const code = (): string => boxes.map((b) => b.value).join("");

// One box per digit, with focus walking along as you type and back on
// Backspace, so a visitor can punch the code in without looking down.
boxes.forEach((box, i) => {
  box.addEventListener("input", () => {
    // More than one digit at once is a paste: spread it over the boxes from
    // here on rather than keeping one digit and dropping the rest.
    const digits = box.value.replace(/\D/g, "").split("");
    box.value = "";
    let at = i;
    for (const d of digits) {
      if (at >= boxes.length) break;
      boxes[at++].value = d;
    }
    if (digits.length) boxes[Math.min(at, boxes.length - 1)].focus();
    submit.disabled = code().length !== boxes.length;
    status.textContent = "";
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
  });
});
boxes[0].focus();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (code().length !== boxes.length) return;
  // Nothing to look the code up in yet — game records are not saved anywhere
  // until the booth's record server exists — so every code opens the sample.
  // Loaded on demand: the entry screen should not wait on the 3D engine.
  status.textContent = "불러오는 중…";
  void import("./report").then(({ openReport }) => openReport());
});
