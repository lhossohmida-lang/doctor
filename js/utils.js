export const ALGIERS_TIME_ZONE = "Africa/Algiers";

export const STATUS_LABELS = {
  waiting: "في الانتظار",
  called: "تم النداء",
  inside: "داخل المكتب",
  completed: "انتهى",
  skipped: "تم التخطي",
  cancelled: "ملغى",
};

export const PAYMENT_LABELS = {
  paid: "مدفوع",
  unpaid: "غير مدفوع",
  partial: "دفع جزئي",
};

const arabicDigits = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export function getAlgiersDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALGIERS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function formatArabicDate(dateKey = getAlgiersDateKey()) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("ar-DZ", {
    timeZone: ALGIERS_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatTime(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return "-";
  return new Intl.DateTimeFormat("ar-DZ", {
    timeZone: ALGIERS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatMoney(amount) {
  const numericAmount = Number(amount || 0);
  return new Intl.NumberFormat("ar-DZ", {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 0,
  }).format(numericAmount);
}

export function normalizePhone(phone = "") {
  return String(phone)
    .trim()
    .replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit] || digit)
    .replace(/[^\d+]/g, "")
    .replace(/^00213/, "+213")
    .replace(/^213/, "+213");
}

export function phoneLookupKey(phone = "") {
  return normalizePhone(phone).replace(/[^\d]/g, "");
}

export function generateBookingCode(dateKey = getAlgiersDateKey()) {
  const random = new Uint8Array(5);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 8);
  return `DR-${dateKey.replaceAll("-", "")}-${suffix}`;
}

export function buildTrackingUrl(dateKey, bookingCode) {
  const url = new URL("customer.html", window.location.href);
  url.searchParams.set("date", dateKey);
  url.searchParams.set("code", bookingCode);
  return url.toString();
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function setMessage(element, message = "", type = "") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("error", "success");
  if (type) element.classList.add(type);
}

export function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

export function debounce(callback, delay = 250) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

export function createCallToken() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${Date.now()}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
