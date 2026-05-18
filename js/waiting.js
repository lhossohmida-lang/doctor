import { ensureRole, signOutUser } from "./auth.js";
import { db, doc, onSnapshot } from "./firebase-config.js";
import { formatArabicDate, getAlgiersDateKey } from "./utils.js";

const state = {
  dateKey: getAlgiersDateKey(),
  soundEnabled: localStorage.getItem("doctorQueueSound") === "on",
  hasFirstSnapshot: false,
  lastToken: sessionStorage.getItem("doctorQueueLastCallToken") || "",
  voices: [],
};

const elements = {};

function collectElements() {
  elements.calledNumber = document.getElementById("calledNumber");
  elements.callText = document.getElementById("callText");
  elements.nextNumber = document.getElementById("nextNumber");
  elements.waitingCount = document.getElementById("waitingCount");
  elements.lastNumber = document.getElementById("lastNumber");
  elements.waitingDate = document.getElementById("waitingDate");
  elements.soundToggle = document.getElementById("soundToggle");
  elements.signOutButton = document.getElementById("signOutButton");
  elements.message = document.getElementById("waitingMessage");
}

function updateSoundButton() {
  elements.soundToggle.textContent = state.soundEnabled ? "كتم الصوت" : "تشغيل الصوت";
}

function loadVoices() {
  state.voices = window.speechSynthesis?.getVoices?.() || [];
}

function chooseArabicVoice() {
  return (
    state.voices.find((voice) => voice.lang?.toLowerCase().startsWith("ar")) ||
    state.voices.find((voice) => /arabic|arab/i.test(voice.name)) ||
    state.voices[0] ||
    null
  );
}

function speakNumber(number) {
  if (!state.soundEnabled || !window.speechSynthesis || !number) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`الرقم ${number}، يرجى التفضل إلى المكتب`);
  utterance.lang = "ar-DZ";
  utterance.rate = 0.86;
  utterance.pitch = 1;
  const voice = chooseArabicVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function animateNumber() {
  elements.calledNumber.classList.add("pulse");
  window.setTimeout(() => elements.calledNumber.classList.remove("pulse"), 550);
}

function renderQueue(data = {}) {
  const current = Number(data.currentCalledNumber || 0);
  const next = data.nextNumber || "-";
  const waiting = Number(data.waitingCount || 0);
  const last = Number(data.lastNumber || 0);
  const token = data.callToken || "";

  const previousNumber = elements.calledNumber.textContent;
  elements.calledNumber.textContent = current || 0;
  elements.nextNumber.textContent = next;
  elements.waitingCount.textContent = waiting;
  elements.lastNumber.textContent = last;
  elements.callText.textContent = current ? `الرقم ${current}، يرجى التفضل إلى المكتب` : "في انتظار أول نداء";

  if (String(previousNumber) !== String(current)) animateNumber();

  if (state.hasFirstSnapshot && token && token !== state.lastToken && current) {
    state.lastToken = token;
    sessionStorage.setItem("doctorQueueLastCallToken", token);
    speakNumber(current);
  } else if (!state.hasFirstSnapshot && token) {
    state.lastToken = token;
    sessionStorage.setItem("doctorQueueLastCallToken", token);
  }

  state.hasFirstSnapshot = true;
}

function subscribeQueue() {
  elements.waitingDate.textContent = formatArabicDate(state.dateKey);
  onSnapshot(
    doc(db, "publicQueue", state.dateKey),
    (snapshot) => {
      if (!snapshot.exists()) {
        renderQueue({ currentCalledNumber: 0, waitingCount: 0, lastNumber: 0 });
        elements.message.textContent = "لم تبدأ قائمة اليوم بعد.";
        return;
      }
      elements.message.textContent = "";
      renderQueue(snapshot.data());
    },
    (error) => {
      console.error(error);
      elements.message.textContent = "تعذر تحميل شاشة الانتظار.";
    },
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  collectElements();
  updateSoundButton();
  loadVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  await ensureRole(["admin", "waiting_screen"], "waiting");
  subscribeQueue();

  elements.soundToggle.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem("doctorQueueSound", state.soundEnabled ? "on" : "off");
    updateSoundButton();
    if (!state.soundEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
  });

  elements.signOutButton.addEventListener("click", () => signOutUser("waiting"));
});
