import { db, doc, getDoc, onSnapshot } from "./firebase-config.js";
import {
  formatArabicDate,
  getAlgiersDateKey,
  phoneLookupKey,
  setMessage,
  STATUS_LABELS,
} from "./utils.js";

const state = {
  dateKey: getAlgiersDateKey(),
  queue: null,
  tickets: new Map(),
  unsubscribers: [],
};

const elements = {};

function collectElements() {
  elements.form = document.getElementById("phoneLookupForm");
  elements.phone = document.getElementById("lookupPhone");
  elements.message = document.getElementById("customerMessage");
  elements.results = document.getElementById("trackingResults");
}

function unsubscribeTickets() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
  state.tickets.clear();
}

function subscribeQueue(dateKey) {
  const unsubscribe = onSnapshot(doc(db, "publicQueue", dateKey), (snapshot) => {
    state.queue = snapshot.exists() ? snapshot.data() : { currentCalledNumber: 0, waitingCount: 0 };
    renderTickets();
  });
  state.unsubscribers.push(unsubscribe);
}

function subscribeTicket(dateKey, bookingCode) {
  const unsubscribe = onSnapshot(doc(db, "publicTickets", dateKey, "tickets", bookingCode), (snapshot) => {
    if (snapshot.exists()) {
      state.tickets.set(bookingCode, snapshot.data());
      setMessage(elements.message, "");
    } else {
      state.tickets.delete(bookingCode);
      setMessage(elements.message, "لا يوجد موعد مسجل بهذا الكود.", "error");
    }
    renderTickets();
  });
  state.unsubscribers.push(unsubscribe);
}

function renderTickets() {
  elements.results.replaceChildren();
  const tickets = Array.from(state.tickets.values()).sort((a, b) => a.queueNumber - b.queueNumber);

  if (!tickets.length) return;

  tickets.forEach((ticket) => {
    const currentCalledNumber = Number(state.queue?.currentCalledNumber || 0);
    const remaining = Math.max(Number(ticket.queueNumber || 0) - currentCalledNumber, 0);
    const card = document.createElement("article");
    card.className = "tracking-card";
    card.innerHTML = `
      <div class="tracking-head">
        <div>
          <p class="eyebrow">${formatArabicDate(ticket.date || state.dateKey)}</p>
          <h2 class="tracking-name"></h2>
        </div>
        <div class="queue-number">${ticket.queueNumber || "-"}</div>
      </div>
      <div class="tracking-grid">
        <div class="info-tile">
          <span>حالة الموعد</span>
          <strong>${STATUS_LABELS[ticket.status] || "غير معروف"}</strong>
        </div>
        <div class="info-tile">
          <span>الرقم الحالي</span>
          <strong>${currentCalledNumber || 0}</strong>
        </div>
        <div class="info-tile">
          <span>المتبقي قبلك تقريبًا</span>
          <strong>${ticket.status === "waiting" ? remaining : 0}</strong>
        </div>
      </div>
      <p class="customer-note">يتم تحديث هذه البطاقة تلقائيًا عند تغير الدور.</p>
    `;
    card.querySelector(".tracking-name").textContent = ticket.fullName || "زبون العيادة";
    elements.results.append(card);
  });
}

async function findByPhone(phone) {
  const key = phoneLookupKey(phone);
  if (!key) {
    setMessage(elements.message, "يرجى إدخال رقم هاتف صحيح.", "error");
    return;
  }

  unsubscribeTickets();
  state.dateKey = getAlgiersDateKey();
  setMessage(elements.message, "جاري البحث عن موعد اليوم...");
  elements.results.replaceChildren();

  try {
    const lookupSnapshot = await getDoc(doc(db, "publicLookups", state.dateKey, "phones", key));
    if (!lookupSnapshot.exists()) {
      setMessage(elements.message, "لا يوجد موعد مسجل اليوم بهذا الرقم.", "error");
      return;
    }

    const bookingCodes = lookupSnapshot.data().bookingCodes || [];
    if (!bookingCodes.length) {
      setMessage(elements.message, "لا يوجد موعد مسجل اليوم بهذا الرقم.", "error");
      return;
    }

    subscribeQueue(state.dateKey);
    bookingCodes.forEach((bookingCode) => subscribeTicket(state.dateKey, bookingCode));
    setMessage(elements.message, "تم العثور على موعدك.", "success");
  } catch (error) {
    console.error(error);
    setMessage(elements.message, "تعذر البحث الآن. حاول مرة أخرى.", "error");
  }
}

function initFromQr() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const date = params.get("date") || getAlgiersDateKey();

  if (!code) return false;

  unsubscribeTickets();
  state.dateKey = date;
  subscribeQueue(date);
  subscribeTicket(date, code);
  setMessage(elements.message, "تم فتح التتبع من QR.", "success");
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  collectElements();
  initFromQr();

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    findByPhone(elements.phone.value);
  });
});
