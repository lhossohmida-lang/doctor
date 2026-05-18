import {
  auth,
  db,
  doc,
  getDoc,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "./firebase-config.js";
import { setMessage } from "./utils.js";

const ADMIN_EMAILS = ["ma@ma.com"];

const TARGETS = {
  admin: {
    label: "الإدارة",
    roles: ["admin"],
    redirect: "admin.html",
  },
};

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function getEmailRole(email) {
  const normalizedEmail = normalizeEmail(email);
  if (ADMIN_EMAILS.includes(normalizedEmail)) return "admin";
  return null;
}

function getTarget() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("target") || "admin";
  return TARGETS[target] ? target : "admin";
}

async function getUserRole(user) {
  const emailRole = getEmailRole(user.email);
  if (emailRole) return emailRole;

  const userSnapshot = await getDoc(doc(db, "users", user.uid));
  return userSnapshot.exists() ? userSnapshot.data().role : null;
}

function redirectToLogin(target = "admin", reason = "") {
  const url = new URL("login.html", window.location.href);
  url.searchParams.set("target", target);
  if (reason) url.searchParams.set("error", reason);
  window.location.replace(url.toString());
}

export function ensureRole(allowedRoles, target = "admin") {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        redirectToLogin(target, "login_required");
        return;
      }

      try {
        const role = await getUserRole(user);
        if (!role || !allowedRoles.includes(role)) {
          await signOut(auth);
          redirectToLogin(target, "permission_denied");
          return;
        }

        document.getElementById("authLoading")?.classList.add("hidden");
        resolve({ user, role });
      } catch (error) {
        console.error(error);
        await signOut(auth);
        redirectToLogin(target, "permission_denied");
      }
    });
  });
}

export async function signOutUser(target = "admin") {
  await signOut(auth);
  redirectToLogin(target);
}

function configureLoginPage() {
  const loginForm = document.getElementById("loginForm");
  if (!loginForm) return;

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const targetRoleInput = document.getElementById("targetRole");
  const message = document.getElementById("authMessage");
  const loginButton = document.getElementById("loginButton");
  const roleTabs = Array.from(document.querySelectorAll("[data-role-choice]"));

  function setTarget(target) {
    targetRoleInput.value = target;
    roleTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.roleChoice === target));
    document.title = `تسجيل دخول ${TARGETS[target].label} | عيادة الطبيب`;
  }

  roleTabs.forEach((tab) => {
    tab.addEventListener("click", () => setTarget(tab.dataset.roleChoice));
  });

  const targetFromUrl = getTarget();
  setTarget(targetFromUrl);

  const error = new URLSearchParams(window.location.search).get("error");
  if (error === "permission_denied") {
    setMessage(message, "هذا الحساب لا يملك صلاحية الدخول لهذه الواجهة.", "error");
  } else if (error === "login_required") {
    setMessage(message, "يرجى تسجيل الدخول أولًا.", "error");
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = targetRoleInput.value;
    const targetConfig = TARGETS[target];
    setMessage(message, "جاري تسجيل الدخول...");
    loginButton.disabled = true;

    try {
      const credentials = await signInWithEmailAndPassword(
        auth,
        emailInput.value.trim(),
        passwordInput.value,
      );
      const role = await getUserRole(credentials.user);

      if (!role || !targetConfig.roles.includes(role)) {
        await signOut(auth);
        setMessage(message, "الحساب صحيح لكن لا يملك هذه الصلاحية.", "error");
        return;
      }

      setMessage(message, "تم تسجيل الدخول بنجاح.", "success");
      window.location.href = targetConfig.redirect;
    } catch (error) {
      console.error(error);
      setMessage(message, "فشل تسجيل الدخول. تحقق من البريد وكلمة السر.", "error");
    } finally {
      loginButton.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", configureLoginPage);
