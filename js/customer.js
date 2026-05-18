import {
  arrayUnion,
  collection,
  db,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "./firebase-config.js";
import { renderQrCode } from "./qr.js";
import {
  buildTrackingUrl,
  escapeHtml,
  formatArabicDate,
  generateBookingCode,
  getAlgiersDateKey,
  normalizePhone,
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
  elements.submitButton = document.getElementById("customerSubmitButton");
  elements.message = document.getElementById("customerMessage");
  elements.results = document.getElementById("trackingResults");
  elements.printArea = document.getElementById("customerPrintArea");
}

const refs = {
  dailyCounter: (dateKey) => doc(db, "dailyCounters", dateKey),
  queueCounter: (dateKey) => doc(db, "queueCounters", dateKey),
  publicQueue: (dateKey) => doc(db, "publicQueue", dateKey),
  patients: (dateKey) => collection(db, "appointments", dateKey, "patients"),
  patient: (dateKey, patientId) => doc(db, "appointments", dateKey, "patients", patientId),
  publicTicket: (dateKey, bookingCode) => doc(db, "publicTickets", dateKey, "tickets", bookingCode),
  phoneLookup: (dateKey, key) => doc(db, "publicLookups", dateKey, "phones", key),
};

function unsubscribeTickets() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
  state.tickets.clear();
}

function subscribeQueue(dateKey) {
  const unsubscribe = onSnapshot(refs.publicQueue(dateKey), (snapshot) => {
    state.queue = snapshot.exists() ? snapshot.data() : { currentCalledNumber: 0, waitingCount: 0 };
    renderTickets();
  });
  state.unsubscribers.push(unsubscribe);
}

function subscribeTicket(dateKey, bookingCode) {
  const unsubscribe = onSnapshot(refs.publicTicket(dateKey, bookingCode), (snapshot) => {
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
      <div class="customer-ticket">
        <div class="customer-qr" data-customer-qr></div>
        <div class="ticket-copy">
          <span>رقم الحجز</span>
          <strong>${escapeHtml(ticket.bookingCode || "-")}</strong>
          <button class="btn btn-secondary" type="button" data-print-ticket>طباعة البطاقة</button>
        </div>
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
    renderQrCode(card.querySelector("[data-customer-qr]"), ticket.qrValue || ticket.bookingCode, 128);
    card.querySelector("[data-print-ticket]").addEventListener("click", () => printCustomerTicket(ticket));
    elements.results.append(card);
  });
}

async function registerPublicPatient(phone) {
  const dateKey = getAlgiersDateKey();
  const cleanPhone = normalizePhone(phone);
  const key = phoneLookupKey(cleanPhone);
  const patientDoc = doc(refs.patients(dateKey));
  const patientId = patientDoc.id;
  const bookingCode = generateBookingCode(dateKey);
  const qrValue = buildTrackingUrl(dateKey, bookingCode);

  return runTransaction(db, async (transaction) => {
    const dailyCounterRef = refs.dailyCounter(dateKey);
    const counterRef = refs.queueCounter(dateKey);
    const publicQueueRef = refs.publicQueue(dateKey);
    const dailyCounterSnapshot = await transaction.get(dailyCounterRef);
    const counterSnapshot = await transaction.get(counterRef);
    const publicQueueSnapshot = await transaction.get(publicQueueRef);
    const dailyCounterData = dailyCounterSnapshot.exists() ? dailyCounterSnapshot.data() : {};
    const queueData = publicQueueSnapshot.exists() ? publicQueueSnapshot.data() : {};
    const dailyLastNumber = Number(dailyCounterData.lastNumber || 0);
    const counterLastNumber = Number(counterSnapshot.exists() ? counterSnapshot.data().lastNumber || 0 : 0);
    const publicLastNumber = Number(queueData.lastNumber || 0);
    const lastNumber = Math.max(dailyLastNumber, counterLastNumber, publicLastNumber);
    const queueNumber = lastNumber + 1;
    const currentCalledNumber = Number(dailyCounterData.currentCalledNumber || queueData.currentCalledNumber || 0);
    const waitingCount = Number(queueData.waitingCount || 0) + 1;

    const patientData = {
      patientId,
      bookingCode,
      fullName: "زبون العيادة",
      phone: cleanPhone,
      phoneKey: key,
      queueNumber,
      disease: "",
      amountPaid: 0,
      paymentStatus: "unpaid",
      status: "waiting",
      qrValue,
      date: dateKey,
      source: "customer",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const publicTicket = {
      patientId,
      bookingCode,
      fullName: "زبون العيادة",
      phoneKey: key,
      queueNumber,
      status: "waiting",
      qrValue,
      date: dateKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(patientDoc, patientData);
    transaction.set(refs.publicTicket(dateKey, bookingCode), publicTicket);
    transaction.set(
      refs.phoneLookup(dateKey, key),
      {
        phoneKey: key,
        bookingCodes: arrayUnion(bookingCode),
        lastBookingCode: bookingCode,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      dailyCounterRef,
      {
        date: dateKey,
        lastNumber: queueNumber,
        currentCalledNumber,
        currentPatientId: dailyCounterData.currentPatientId || null,
        ...(dailyCounterSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      counterRef,
      {
        date: dateKey,
        lastNumber: queueNumber,
        lastPatientId: patientId,
        ...(counterSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      publicQueueRef,
      {
        date: dateKey,
        currentCalledNumber,
        lastNumber: queueNumber,
        waitingCount,
        nextNumber: queueData.nextNumber || queueNumber,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return { ...publicTicket, phone: cleanPhone };
  });
}

async function findOrRegisterByPhone(phone) {
  const key = phoneLookupKey(phone);
  if (!key) {
    setMessage(elements.message, "يرجى إدخال رقم هاتف صحيح.", "error");
    return;
  }

  unsubscribeTickets();
  state.dateKey = getAlgiersDateKey();
  setMessage(elements.message, "جاري التحقق من رقمك...");
  elements.results.replaceChildren();
  elements.submitButton.disabled = true;

  try {
    const lookupSnapshot = await getDoc(refs.phoneLookup(state.dateKey, key));
    let bookingCodes = lookupSnapshot.exists() ? lookupSnapshot.data().bookingCodes || [] : [];

    if (!bookingCodes.length) {
      setMessage(elements.message, "لم نجد رقمًا لهذا الهاتف اليوم. جاري إنشاء دور جديد...");
      const ticket = await registerPublicPatient(phone);
      bookingCodes = [ticket.bookingCode];
      setMessage(elements.message, `تم إنشاء رقمك بنجاح. رقم الدور ${ticket.queueNumber}.`, "success");
    } else {
      setMessage(elements.message, "هذا الهاتف مسجل اليوم. تم عرض بطاقتك.", "success");
    }

    subscribeQueue(state.dateKey);
    bookingCodes.forEach((bookingCode) => subscribeTicket(state.dateKey, bookingCode));
  } catch (error) {
    console.error(error);
    const permissionHint =
      error?.code === "permission-denied" ? " تأكد من نشر قواعد Firestore الجديدة." : "";
    setMessage(elements.message, `تعذر إنشاء أو عرض رقم الدور. حاول مرة أخرى.${permissionHint}`, "error");
  } finally {
    elements.submitButton.disabled = false;
  }
}

function printCustomerTicket(ticket) {
  elements.printArea.innerHTML = `
    <article class="customer-print-ticket">
      <h2>عيادة الطبيب</h2>
      <div class="print-number">${escapeHtml(ticket.queueNumber || "-")}</div>
      <div class="print-meta">
        <strong>${escapeHtml(ticket.fullName || "زبون العيادة")}</strong>
        <span>التاريخ: ${escapeHtml(formatArabicDate(ticket.date || state.dateKey))}</span>
        <span>رقم الحجز: ${escapeHtml(ticket.bookingCode || "-")}</span>
      </div>
      <div id="customerPrintQr"></div>
    </article>
  `;
  renderQrCode(document.getElementById("customerPrintQr"), ticket.qrValue || ticket.bookingCode, 170);
  window.setTimeout(() => window.print(), 120);
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
    findOrRegisterByPhone(elements.phone.value);
  });
});
