import { ensureRole, signOutUser } from "./auth.js";
import {
  arrayRemove,
  arrayUnion,
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "./firebase-config.js";
import { renderQrCode } from "./qr.js";
import {
  buildTrackingUrl,
  createCallToken,
  debounce,
  escapeHtml,
  formatArabicDate,
  formatMoney,
  formatTime,
  generateBookingCode,
  getAlgiersDateKey,
  normalizePhone,
  PAYMENT_LABELS,
  phoneLookupKey,
  setMessage,
  showToast,
  STATUS_LABELS,
} from "./utils.js";

const state = {
  dateKey: getAlgiersDateKey(),
  patients: [],
  counter: { lastNumber: 0, currentCalledNumber: 0, currentPatientId: null },
  latestTicket: null,
  editingPatient: null,
  unsubscribePatients: null,
  unsubscribeCounter: null,
};

const elements = {};

function collectElements() {
  [
    "adminEmail",
    "signOutButton",
    "workDate",
    "dateNotice",
    "statTotal",
    "statWaiting",
    "statCalled",
    "statCompleted",
    "statPaid",
    "statCurrent",
    "queueDateLabel",
    "currentNumber",
    "queueMessage",
    "callNextButton",
    "recallButton",
    "skipCurrentButton",
    "finishCurrentButton",
    "patientForm",
    "fullName",
    "phone",
    "disease",
    "amountPaid",
    "paymentStatus",
    "registerButton",
    "registerMessage",
    "ticketPreview",
    "printLatestButton",
    "searchName",
    "searchPhone",
    "statusFilter",
    "paymentFilter",
    "sortOrder",
    "patientsTbody",
    "editDialog",
    "editForm",
    "editPatientId",
    "editFullName",
    "editPhone",
    "editDisease",
    "editAmountPaid",
    "editPaymentStatus",
    "editMessage",
    "printArea",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

const refs = {
  counter: (dateKey) => doc(db, "dailyCounters", dateKey),
  queueCounter: (dateKey) => doc(db, "queueCounters", dateKey),
  publicQueue: (dateKey) => doc(db, "publicQueue", dateKey),
  patients: (dateKey) => collection(db, "appointments", dateKey, "patients"),
  patient: (dateKey, patientId) => doc(db, "appointments", dateKey, "patients", patientId),
  publicTicket: (dateKey, bookingCode) => doc(db, "publicTickets", dateKey, "tickets", bookingCode),
  phoneLookup: (dateKey, key) => doc(db, "publicLookups", dateKey, "phones", key),
};

function isTodaySelected() {
  return state.dateKey === getAlgiersDateKey();
}

function updateSelectedDateUi() {
  elements.queueDateLabel.textContent = formatArabicDate(state.dateKey);
  const todaySelected = isTodaySelected();
  elements.dateNotice.textContent = todaySelected
    ? "أنت تعمل على قائمة اليوم حسب توقيت الجزائر."
    : "أنت تعرض تاريخًا سابقًا. التسجيل والتحكم في الدور متاحان لتاريخ اليوم فقط.";

  const formControls = elements.patientForm.querySelectorAll("input, select, button");
  formControls.forEach((control) => {
    control.disabled = !todaySelected;
  });

  [elements.callNextButton, elements.recallButton, elements.skipCurrentButton, elements.finishCurrentButton].forEach(
    (button) => {
      button.disabled = !todaySelected;
    },
  );
}

function unsubscribeDateListeners() {
  state.unsubscribePatients?.();
  state.unsubscribeCounter?.();
  state.unsubscribePatients = null;
  state.unsubscribeCounter = null;
}

function subscribeToDate(dateKey) {
  unsubscribeDateListeners();
  state.dateKey = dateKey;
  state.patients = [];
  state.counter = { lastNumber: 0, currentCalledNumber: 0, currentPatientId: null };
  updateSelectedDateUi();
  renderStats();
  renderTable();

  state.unsubscribeCounter = onSnapshot(
    refs.counter(dateKey),
    (snapshot) => {
      state.counter = snapshot.exists()
        ? { lastNumber: 0, currentCalledNumber: 0, currentPatientId: null, ...snapshot.data() }
        : { lastNumber: 0, currentCalledNumber: 0, currentPatientId: null };
      renderStats();
      renderQueuePanel();
    },
    (error) => {
      console.error(error);
      setMessage(elements.queueMessage, "تعذر تحميل عداد اليوم.", "error");
    },
  );

  state.unsubscribePatients = onSnapshot(
    query(refs.patients(dateKey), orderBy("queueNumber", "asc")),
    (snapshot) => {
      state.patients = snapshot.docs.map((patientDoc) => ({ patientId: patientDoc.id, ...patientDoc.data() }));
      renderStats();
      renderTable();
    },
    (error) => {
      console.error(error);
      setMessage(elements.queueMessage, "تعذر تحميل قائمة الزبائن.", "error");
    },
  );
}

function renderStats() {
  const total = state.patients.length;
  const waiting = state.patients.filter((patient) => patient.status === "waiting").length;
  const called = state.patients.filter((patient) => ["called", "inside"].includes(patient.status)).length;
  const completed = state.patients.filter((patient) => patient.status === "completed").length;
  const paidTotal = state.patients
    .filter((patient) => patient.paymentStatus !== "unpaid")
    .reduce((sum, patient) => sum + Number(patient.amountPaid || 0), 0);

  elements.statTotal.textContent = total;
  elements.statWaiting.textContent = waiting;
  elements.statCalled.textContent = called;
  elements.statCompleted.textContent = completed;
  elements.statPaid.textContent = formatMoney(paidTotal);
  elements.statCurrent.textContent = state.counter.currentCalledNumber || 0;
  renderQueuePanel();
}

function renderQueuePanel() {
  elements.currentNumber.textContent = state.counter.currentCalledNumber || 0;
}

function patientMatchesFilters(patient) {
  const nameSearch = elements.searchName.value.trim().toLowerCase();
  const phoneSearch = phoneLookupKey(elements.searchPhone.value);
  const statusFilter = elements.statusFilter.value;
  const paymentFilter = elements.paymentFilter.value;

  const matchesName = !nameSearch || String(patient.fullName || "").toLowerCase().includes(nameSearch);
  const matchesPhone = !phoneSearch || phoneLookupKey(patient.phone).includes(phoneSearch);
  const matchesStatus = !statusFilter || patient.status === statusFilter;
  const matchesPayment = !paymentFilter || patient.paymentStatus === paymentFilter;
  return matchesName && matchesPhone && matchesStatus && matchesPayment;
}

function makeCell(content) {
  const cell = document.createElement("td");
  if (content instanceof Node) {
    cell.append(content);
  } else {
    cell.textContent = content;
  }
  return cell;
}

function makePill(label, className) {
  const pill = document.createElement("span");
  pill.className = className;
  pill.textContent = label;
  return pill;
}

function makeActionButton(label, className, handler, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

function renderTable() {
  elements.patientsTbody.replaceChildren();
  const order = elements.sortOrder.value;
  const filteredPatients = state.patients
    .filter(patientMatchesFilters)
    .sort((a, b) => (order === "asc" ? a.queueNumber - b.queueNumber : b.queueNumber - a.queueNumber));

  if (!filteredPatients.length) {
    const row = document.createElement("tr");
    const cell = makeCell("لا توجد بيانات مطابقة");
    cell.colSpan = 10;
    cell.className = "empty-row";
    row.append(cell);
    elements.patientsTbody.append(row);
    return;
  }

  filteredPatients.forEach((patient) => {
    const row = document.createElement("tr");

    const number = document.createElement("strong");
    number.textContent = patient.queueNumber || "-";
    row.append(makeCell(number));
    row.append(makeCell(patient.fullName || "-"));
    row.append(makeCell(patient.phone || "-"));
    row.append(makeCell(patient.disease || "-"));
    row.append(makeCell(formatMoney(patient.amountPaid)));
    row.append(
      makeCell(makePill(PAYMENT_LABELS[patient.paymentStatus] || "-", `payment-pill payment-${patient.paymentStatus}`)),
    );
    row.append(makeCell(makePill(STATUS_LABELS[patient.status] || "-", `status-pill status-${patient.status}`)));

    const qrCellContent = document.createElement("div");
    qrCellContent.className = "qr-mini";
    row.append(makeCell(qrCellContent));

    row.append(makeCell(formatTime(patient.createdAt)));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const inactive = ["completed", "cancelled"].includes(patient.status);
    actions.append(
      makeActionButton("استدعاء", "btn-secondary", () => callPatient(patient), !isTodaySelected() || inactive),
      makeActionButton("دخل المكتب", "btn-secondary", () => updatePatientStatus(patient, "inside"), inactive),
      makeActionButton("إنهاء", "btn-success", () => updatePatientStatus(patient, "completed", true), false),
      makeActionButton("تخطي", "btn-warning", () => updatePatientStatus(patient, "skipped", true), inactive),
      makeActionButton("إلغاء", "btn-danger", () => updatePatientStatus(patient, "cancelled", true), false),
      makeActionButton("طباعة", "btn-secondary", () => printTicket(patient), false),
      makeActionButton("تعديل", "btn-secondary", () => openEditDialog(patient), false),
      makeActionButton("حذف", "btn-danger", () => deletePatient(patient), false),
    );
    row.append(makeCell(actions));

    elements.patientsTbody.append(row);
    renderQrCode(qrCellContent, patient.qrValue || patient.bookingCode || "-", 54);
  });
}

async function refreshPublicQueueSummary(dateKey = state.dateKey) {
  const counterSnapshot = await getDoc(refs.counter(dateKey));
  const counter = counterSnapshot.exists()
    ? { lastNumber: 0, currentCalledNumber: 0, ...counterSnapshot.data() }
    : { lastNumber: 0, currentCalledNumber: 0 };
  const patientsSnapshot = await getDocs(query(refs.patients(dateKey), orderBy("queueNumber", "asc")));
  const patients = patientsSnapshot.docs.map((patientDoc) => patientDoc.data());
  const waitingPatients = patients.filter((patient) => patient.status === "waiting");
  const nextPatient = waitingPatients.find(
    (patient) => Number(patient.queueNumber || 0) > Number(counter.currentCalledNumber || 0),
  );
  const maxQueue = patients.reduce((max, patient) => Math.max(max, Number(patient.queueNumber || 0)), 0);

  await setDoc(
    refs.publicQueue(dateKey),
    {
      date: dateKey,
      currentCalledNumber: Number(counter.currentCalledNumber || 0),
      lastNumber: Number(counter.lastNumber || maxQueue || 0),
      waitingCount: waitingPatients.length,
      nextNumber: nextPatient?.queueNumber || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function registerPatient(event) {
  event.preventDefault();

  if (!isTodaySelected()) {
    setMessage(elements.registerMessage, "التسجيل متاح لتاريخ اليوم فقط.", "error");
    return;
  }

  const dateKey = state.dateKey;
  const fullName = elements.fullName.value.trim();
  const phone = normalizePhone(elements.phone.value);
  const lookupKey = phoneLookupKey(phone);
  const disease = elements.disease.value.trim();
  const amountPaid = Number(elements.amountPaid.value || 0);
  const paymentStatus = elements.paymentStatus.value;

  if (!fullName || !lookupKey) {
    setMessage(elements.registerMessage, "يرجى إدخال الاسم ورقم هاتف صحيح.", "error");
    return;
  }

  elements.registerButton.disabled = true;
  setMessage(elements.registerMessage, "جاري تسجيل الزبون...");

  try {
    const patientDoc = doc(refs.patients(dateKey));
    const patientId = patientDoc.id;
    const bookingCode = generateBookingCode(dateKey);
    const qrValue = buildTrackingUrl(dateKey, bookingCode);

    const ticket = await runTransaction(db, async (transaction) => {
      const queueCounterSnapshot = await transaction.get(refs.queueCounter(dateKey));
      const counterSnapshot = await transaction.get(refs.counter(dateKey));
      const counterData = counterSnapshot.exists()
        ? counterSnapshot.data()
        : { currentCalledNumber: 0, currentPatientId: null, lastNumber: 0 };
      const queueCounterData = queueCounterSnapshot.exists() ? queueCounterSnapshot.data() : { lastNumber: 0 };
      const queueNumber = Math.max(Number(counterData.lastNumber || 0), Number(queueCounterData.lastNumber || 0)) + 1;

      const patientData = {
        patientId,
        bookingCode,
        fullName,
        phone,
        phoneKey: lookupKey,
        queueNumber,
        disease,
        amountPaid,
        paymentStatus,
        status: "waiting",
        qrValue,
        date: dateKey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const publicTicket = {
        patientId,
        bookingCode,
        fullName,
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
        refs.phoneLookup(dateKey, lookupKey),
        {
          phoneKey: lookupKey,
          bookingCodes: arrayUnion(bookingCode),
          lastBookingCode: bookingCode,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        refs.queueCounter(dateKey),
        {
          date: dateKey,
          lastNumber: queueNumber,
          lastPatientId: patientId,
          ...(queueCounterSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        refs.counter(dateKey),
        {
          date: dateKey,
          lastNumber: queueNumber,
          currentCalledNumber: Number(counterData.currentCalledNumber || 0),
          currentPatientId: counterData.currentPatientId || null,
          ...(counterSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        refs.publicQueue(dateKey),
        {
          date: dateKey,
          lastNumber: queueNumber,
          currentCalledNumber: Number(counterData.currentCalledNumber || 0),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return { ...patientData, createdAt: new Date(), updatedAt: new Date() };
    });

    await refreshPublicQueueSummary(dateKey);
    state.latestTicket = ticket;
    renderTicket(ticket);
    elements.patientForm.reset();
    elements.amountPaid.value = 0;
    elements.paymentStatus.value = "paid";
    setMessage(elements.registerMessage, `تم التسجيل بنجاح. رقم الدور ${ticket.queueNumber}.`, "success");
    showToast("تم تسجيل الزبون وإنشاء بطاقة QR.");
  } catch (error) {
    console.error(error);
    setMessage(elements.registerMessage, "فشل تسجيل الزبون. حاول مرة أخرى.", "error");
  } finally {
    elements.registerButton.disabled = false;
    updateSelectedDateUi();
  }
}

function renderTicket(ticket) {
  if (!ticket) return;
  state.latestTicket = ticket;
  elements.ticketPreview.className = "ticket-card";
  elements.ticketPreview.innerHTML = `
    <div>
      <h3>عيادة الطبيب</h3>
      <div class="ticket-number">${escapeHtml(ticket.queueNumber || "-")}</div>
      <div class="ticket-meta">
        <span>الاسم: ${escapeHtml(ticket.fullName || "-")}</span>
        <span>الهاتف: ${escapeHtml(ticket.phone || "-")}</span>
        <span>التاريخ: ${escapeHtml(formatArabicDate(ticket.date || state.dateKey))}</span>
        <span>رقم الحجز: ${escapeHtml(ticket.bookingCode || "-")}</span>
      </div>
    </div>
    <div class="ticket-qr" data-ticket-qr></div>
  `;
  renderQrCode(elements.ticketPreview.querySelector("[data-ticket-qr]"), ticket.qrValue || ticket.bookingCode, 128);
  elements.printLatestButton.disabled = false;
}

function printTicket(ticket = state.latestTicket) {
  if (!ticket) {
    showToast("لا توجد بطاقة جاهزة للطباعة.");
    return;
  }

  renderTicket(ticket);
  elements.printArea.innerHTML = `
    <article class="print-ticket">
      <h2>عيادة الطبيب</h2>
      <div class="print-number">${escapeHtml(ticket.queueNumber || "-")}</div>
      <div class="print-meta">
        <strong>${escapeHtml(ticket.fullName || "-")}</strong>
        <span>الهاتف: ${escapeHtml(ticket.phone || "-")}</span>
        <span>التاريخ: ${escapeHtml(formatArabicDate(ticket.date || state.dateKey))}</span>
        <span>رقم الحجز: ${escapeHtml(ticket.bookingCode || "-")}</span>
      </div>
      <div id="printQrCode"></div>
    </article>
  `;
  renderQrCode(document.getElementById("printQrCode"), ticket.qrValue || ticket.bookingCode, 170);
  window.setTimeout(() => {
    try {
      window.print();
    } catch (error) {
      console.error(error);
      showToast("تعذر طباعة البطاقة.");
    }
  }, 120);
}

async function callPatient(patient) {
  if (!isTodaySelected()) {
    setMessage(elements.queueMessage, "استدعاء الأرقام متاح لتاريخ اليوم فقط.", "error");
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.update(refs.patient(state.dateKey, patient.patientId), {
      status: "called",
      updatedAt: serverTimestamp(),
    });
    batch.set(
      refs.publicTicket(state.dateKey, patient.bookingCode),
      {
        status: "called",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      refs.counter(state.dateKey),
      {
        date: state.dateKey,
        currentCalledNumber: Number(patient.queueNumber || 0),
        currentPatientId: patient.patientId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      refs.publicQueue(state.dateKey),
      {
        date: state.dateKey,
        currentCalledNumber: Number(patient.queueNumber || 0),
        callToken: createCallToken(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    await refreshPublicQueueSummary(state.dateKey);
    setMessage(elements.queueMessage, `تم استدعاء الرقم ${patient.queueNumber}.`, "success");
    showToast(`تم استدعاء الرقم ${patient.queueNumber}.`);
  } catch (error) {
    console.error(error);
    setMessage(elements.queueMessage, "فشل تحديث الدور.", "error");
  }
}

function findCurrentPatient() {
  const currentId = state.counter.currentPatientId;
  const currentNumber = Number(state.counter.currentCalledNumber || 0);
  return (
    state.patients.find((patient) => patient.patientId === currentId) ||
    state.patients.find((patient) => Number(patient.queueNumber || 0) === currentNumber)
  );
}

async function updatePatientStatus(patient, status, clearCurrent = false) {
  try {
    const shouldClearCurrent =
      clearCurrent &&
      (state.counter.currentPatientId === patient.patientId ||
        Number(state.counter.currentCalledNumber || 0) === Number(patient.queueNumber || 0));
    const batch = writeBatch(db);
    batch.update(refs.patient(state.dateKey, patient.patientId), {
      status,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      refs.publicTicket(state.dateKey, patient.bookingCode),
      {
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    if (shouldClearCurrent) {
      batch.set(
        refs.counter(state.dateKey),
        {
          currentPatientId: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    await refreshPublicQueueSummary(state.dateKey);
    showToast("تم تحديث الحالة بنجاح.");
  } catch (error) {
    console.error(error);
    showToast("فشل تحديث الحالة.");
  }
}

async function callNextPatient() {
  const current = Number(state.counter.currentCalledNumber || 0);
  const nextPatient = state.patients
    .filter((patient) => patient.status === "waiting" && Number(patient.queueNumber || 0) > current)
    .sort((a, b) => a.queueNumber - b.queueNumber)[0];

  if (!nextPatient) {
    setMessage(elements.queueMessage, "لا يوجد زبائن في الانتظار.", "error");
    return;
  }

  await callPatient(nextPatient);
}

async function recallCurrent() {
  const currentNumber = Number(state.counter.currentCalledNumber || 0);
  if (!currentNumber) {
    setMessage(elements.queueMessage, "لا يوجد رقم حالي لإعادة النداء.", "error");
    return;
  }

  try {
    await setDoc(
      refs.publicQueue(state.dateKey),
      {
        date: state.dateKey,
        currentCalledNumber: currentNumber,
        callToken: createCallToken(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setMessage(elements.queueMessage, `تمت إعادة النداء على الرقم ${currentNumber}.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(elements.queueMessage, "تعذرت إعادة النداء.", "error");
  }
}

async function skipCurrent() {
  const currentPatient = findCurrentPatient();
  if (!currentPatient) {
    setMessage(elements.queueMessage, "لا يوجد زبون حالي لتخطيه.", "error");
    return;
  }
  await updatePatientStatus(currentPatient, "skipped", true);
  setMessage(elements.queueMessage, `تم تخطي الرقم ${currentPatient.queueNumber}.`, "success");
}

async function finishCurrent() {
  const currentPatient = findCurrentPatient();
  if (!currentPatient) {
    setMessage(elements.queueMessage, "لا يوجد زبون حالي لإنهائه.", "error");
    return;
  }
  await updatePatientStatus(currentPatient, "completed", true);
  setMessage(elements.queueMessage, `تم إنهاء الرقم ${currentPatient.queueNumber}.`, "success");
}

function openEditDialog(patient) {
  state.editingPatient = patient;
  elements.editPatientId.value = patient.patientId;
  elements.editFullName.value = patient.fullName || "";
  elements.editPhone.value = patient.phone || "";
  elements.editDisease.value = patient.disease || "";
  elements.editAmountPaid.value = patient.amountPaid || 0;
  elements.editPaymentStatus.value = patient.paymentStatus || "paid";
  setMessage(elements.editMessage, "");
  elements.editDialog.showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  const patient = state.editingPatient;
  if (!patient) return;

  const fullName = elements.editFullName.value.trim();
  const phone = normalizePhone(elements.editPhone.value);
  const newPhoneKey = phoneLookupKey(phone);
  if (!fullName || !newPhoneKey) {
    setMessage(elements.editMessage, "يرجى إدخال الاسم ورقم هاتف صحيح.", "error");
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.update(refs.patient(state.dateKey, patient.patientId), {
      fullName,
      phone,
      phoneKey: newPhoneKey,
      disease: elements.editDisease.value.trim(),
      amountPaid: Number(elements.editAmountPaid.value || 0),
      paymentStatus: elements.editPaymentStatus.value,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      refs.publicTicket(state.dateKey, patient.bookingCode),
      {
        fullName,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (newPhoneKey !== patient.phoneKey) {
      if (patient.phoneKey) {
        batch.set(
          refs.phoneLookup(state.dateKey, patient.phoneKey),
          {
            bookingCodes: arrayRemove(patient.bookingCode),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
      batch.set(
        refs.phoneLookup(state.dateKey, newPhoneKey),
        {
          phoneKey: newPhoneKey,
          bookingCodes: arrayUnion(patient.bookingCode),
          lastBookingCode: patient.bookingCode,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    await batch.commit();
    elements.editDialog.close();
    showToast("تم حفظ التعديلات.");
  } catch (error) {
    console.error(error);
    setMessage(elements.editMessage, "تعذر حفظ التعديلات.", "error");
  }
}

async function deletePatient(patient) {
  const confirmed = window.confirm(`هل تريد حذف الزبون "${patient.fullName}"؟ لا يمكن التراجع عن هذه العملية.`);
  if (!confirmed) return;

  try {
    const batch = writeBatch(db);
    batch.delete(refs.patient(state.dateKey, patient.patientId));
    batch.delete(refs.publicTicket(state.dateKey, patient.bookingCode));
    if (patient.phoneKey) {
      batch.set(
        refs.phoneLookup(state.dateKey, patient.phoneKey),
        {
          bookingCodes: arrayRemove(patient.bookingCode),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    if (state.counter.currentPatientId === patient.patientId) {
      batch.set(
        refs.counter(state.dateKey),
        {
          currentPatientId: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    await refreshPublicQueueSummary(state.dateKey);
    showToast("تم حذف الزبون.");
  } catch (error) {
    console.error(error);
    showToast("تعذر حذف الزبون.");
  }
}

function bindEvents() {
  elements.signOutButton.addEventListener("click", () => signOutUser("admin"));
  elements.workDate.addEventListener("change", () => subscribeToDate(elements.workDate.value || getAlgiersDateKey()));
  elements.patientForm.addEventListener("submit", registerPatient);
  elements.callNextButton.addEventListener("click", callNextPatient);
  elements.recallButton.addEventListener("click", recallCurrent);
  elements.skipCurrentButton.addEventListener("click", skipCurrent);
  elements.finishCurrentButton.addEventListener("click", finishCurrent);
  elements.printLatestButton.addEventListener("click", () => printTicket());
  elements.editForm.addEventListener("submit", saveEdit);
  elements.editDialog.querySelector(".icon-close").addEventListener("click", () => elements.editDialog.close());

  const rerender = debounce(renderTable, 180);
  [elements.searchName, elements.searchPhone, elements.statusFilter, elements.paymentFilter, elements.sortOrder].forEach(
    (control) => {
      control.addEventListener("input", rerender);
      control.addEventListener("change", rerender);
    },
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  collectElements();
  const session = await ensureRole(["admin"], "admin");
  elements.adminEmail.textContent = session.user.email || "مدير العيادة";
  elements.workDate.value = state.dateKey;
  bindEvents();
  subscribeToDate(state.dateKey);
});
