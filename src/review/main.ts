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
  void lookUp(code());
});

const analysing = document.getElementById("analysing") as HTMLElement;
const analysingCount = document.getElementById("analysingCount") as HTMLElement;
const analysingBar = document.getElementById("analysingBar") as HTMLElement;

/** The "AI is analysing" card, filled as the engine works through the turns. */
const showProgress = (done: number, total: number): void => {
  analysing.classList.add("show");
  analysingCount.textContent = `${done} / ${total}수`;
  analysingBar.style.width = `${total ? (100 * done) / total : 0}%`;
};

/**
 * Analyse a round and open its review. The engine looks two moves deep from
 * every placement, which takes a few seconds a round, so the progress card
 * stays up while it works. Loaded on demand: the entry screen should not wait
 * on the engine or the 3D renderer.
 */
async function analyse(source: { record: import("../record/record").GameRecord } | "sample"): Promise<void> {
  const [{ reviewFromRecord }, { sampleReview }, { openReport }] = await Promise.all([
    import("./analysis"),
    import("./sample"),
    import("./report"),
  ]);
  showProgress(0, 0);
  try {
    if (source === "sample") {
      openReport(await sampleReview(showProgress));
      return;
    }
    const { review, problem } = await reviewFromRecord(source.record, showProgress);
    if (!review) {
      status.textContent = `이 판의 리뷰를 만들 수 없어요: ${problem}`;
      return;
    }
    openReport(review);
  } finally {
    analysing.classList.remove("show");
  }
}

/** Find the round behind a code. */
async function lookUp(c: string): Promise<void> {
  status.textContent = "불러오는 중…";
  const { recordStore } = await import("../record/store");
  const record = await recordStore.load(c);
  if (!record) {
    status.innerHTML = `코드 ${c}로 저장된 판을 찾을 수 없어요.<br /><button type="button" class="link" id="showSample">샘플 리뷰 보기</button>`;
    document.getElementById("showSample")!.addEventListener("click", () => void analyse("sample"));
    return;
  }
  status.textContent = "";
  await analyse({ record });
}

/**
 * A round carried in the link itself (#r=…), from another device — open its
 * review straight away, no code needed.
 */
async function openFromLink(): Promise<void> {
  const m = /^#r=(.+)$/.exec(location.hash);
  if (!m) return;
  status.textContent = "불러오는 중…";
  const { decodeRecord } = await import("../record/share");
  const record = await decodeRecord(m[1]);
  if (!record) {
    status.textContent = "링크에 담긴 판을 읽을 수 없어요.";
    return;
  }
  status.textContent = "";
  await analyse({ record });
}
void openFromLink();
