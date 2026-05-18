import { db, doc, onSnapshot } from "./firebase-config.js";
import { formatArabicDate, getAlgiersDateKey } from "./utils.js";

const state = {
  dateKey: getAlgiersDateKey(),
  soundEnabled: false,
  hasFirstSnapshot: false,
  lastToken: sessionStorage.getItem("doctorQueueLastCallToken") || "",
  currentNumber: 0,
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
  elements.message = document.getElementById("waitingMessage");
}

function updateSoundButton() {
  elements.soundToggle.textContent = state.soundEnabled ? "كتم الصوت" : "تفعيل الصوت";
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

function numberToArabicWords(number) {
  const value = Number(number);
  if (!Number.isFinite(value) || value <= 0) return String(number);

  const ones = [
    "",
    "واحد",
    "اثنين",
    "ثلاثة",
    "أربعة",
    "خمسة",
    "ستة",
    "سبعة",
    "ثمانية",
    "تسعة",
  ];
  const teens = [
    "عشرة",
    "أحد عشر",
    "اثنا عشر",
    "ثلاثة عشر",
    "أربعة عشر",
    "خمسة عشر",
    "ستة عشر",
    "سبعة عشر",
    "ثمانية عشر",
    "تسعة عشر",
  ];
  const tens = [
    "",
    "",
    "عشرون",
    "ثلاثون",
    "أربعون",
    "خمسون",
    "ستون",
    "سبعون",
    "ثمانون",
    "تسعون",
  ];
  const hundreds = [
    "",
    "مئة",
    "مئتان",
    "ثلاث مئة",
    "أربع مئة",
    "خمس مئة",
    "ست مئة",
    "سبع مئة",
    "ثمان مئة",
    "تسع مئة",
  ];

  function belowHundred(current) {
    if (current < 10) return ones[current];
    if (current < 20) return teens[current - 10];
    const one = current % 10;
    const ten = Math.floor(current / 10);
    return one ? `${ones[one]} و${tens[ten]}` : tens[ten];
  }

  function belowThousand(current) {
    if (current < 100) return belowHundred(current);
    const hundred = Math.floor(current / 100);
    const rest = current % 100;
    return rest ? `${hundreds[hundred]} و${belowHundred(rest)}` : hundreds[hundred];
  }

  if (value < 1000) return belowThousand(value);
  if (value < 10000) {
    const thousand = Math.floor(value / 1000);
    const rest = value % 1000;
    const thousandText = thousand === 1 ? "ألف" : `${ones[thousand]} آلاف`;
    return rest ? `${thousandText} و${belowThousand(rest)}` : thousandText;
  }

  return String(value);
}

function buildCallMessage(number) {
  return `الرقم ${numberToArabicWords(number)} يتفضل`;
}

function speakText(text, force = false) {
  if ((!state.soundEnabled && !force) || !text) return false;
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    elements.message.textContent = "الصوت غير مدعوم في هذا المتصفح.";
    return false;
  }

  loadVoices();
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume?.();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ar-DZ";
  utterance.rate = 0.82;
  utterance.pitch = 1;
  const voice = chooseArabicVoice();
  if (voice) utterance.voice = voice;
  utterance.onerror = () => {
    elements.message.textContent = "تعذر تشغيل الصوت. اضغط تشغيل الصوت مرة أخرى.";
  };
  window.speechSynthesis.speak(utterance);
  return true;
}

function speakNumber(number, force = false) {
  if (!number) return false;
  return speakText(buildCallMessage(number), force);
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
  state.currentNumber = current;
  elements.calledNumber.textContent = current || 0;
  elements.nextNumber.textContent = next;
  elements.waitingCount.textContent = waiting;
  elements.lastNumber.textContent = last;
  elements.callText.textContent = current ? buildCallMessage(current) : "في انتظار أول نداء";

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

document.addEventListener("DOMContentLoaded", () => {
  collectElements();
  updateSoundButton();
  loadVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  subscribeQueue();

  elements.soundToggle.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    updateSoundButton();

    if (!state.soundEnabled) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      elements.message.textContent = "تم كتم الصوت.";
      return;
    }

    elements.message.textContent = "تم تشغيل الصوت. سيُنطق كل رقم جديد.";
    if (state.currentNumber) {
      speakNumber(state.currentNumber, true);
    } else {
      speakText("تم تشغيل الصوت", true);
    }
  });

});
