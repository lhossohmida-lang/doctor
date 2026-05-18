# نظام إدارة الدور لعيادة طبيب

تطبيق ويب عربي RTL لإدارة تسجيل زبائن العيادة، توليد أرقام دور يومية، إنشاء بطاقات QR قابلة للطباعة، عرض شاشة انتظار ناطقة، وتتبع الزبون من الهاتف دون كشف البيانات الطبية أو المالية.

## المزايا

- لوحة إدارة محمية عبر Firebase Authentication.
- ترقيم يومي حسب توقيت الجزائر `Africa/Algiers` بصيغة `YYYY-MM-DD`.
- تسجيل الزبون داخل Firestore Transaction لمنع تكرار أرقام الدور.
- بطاقة QR تحتوي رابط تتبع آمن لا يحتوي المرض أو المبلغ.
- واجهة زبون عامة عبر رقم الهاتف أو QR.
- شاشة انتظار محمية بحساب خاص وتدعم النطق عبر Web Speech Synthesis API.
- تحديث مباشر عبر `onSnapshot`.
- قواعد Firestore تمنع الوصول العام إلى `appointments` و `dailyCounters`.

## بنية الملفات

```text
/
  index.html
  login.html
  admin.html
  customer.html
  waiting.html
  css/
    style.css
    admin.css
    customer.css
    waiting.css
  js/
    firebase-config.js
    auth.js
    admin.js
    customer.js
    waiting.js
    qr.js
    utils.js
  firebase.json
  firestore.rules
  README.md
```

## إعداد Firebase

ملف `js/firebase-config.js` يحتوي إعداد المشروع المطلوب وجاهز للاستخدام. يجب في Firebase Console تفعيل:

1. Authentication.
2. Sign-in method.
3. Email/Password.
4. Cloud Firestore.

## إنشاء المستخدمين والصلاحيات

أنشئ مستخدمين من Firebase Authentication:

- مستخدم الإدارة.
- مستخدم شاشة الانتظار.

بعد إنشاء المستخدمين، افتح Firestore وأنشئ مستندًا لكل مستخدم داخل:

```text
users/{uid}
```

مثال admin:

```json
{
  "email": "admin@example.com",
  "role": "admin"
}
```

مثال شاشة الانتظار:

```json
{
  "email": "waiting@example.com",
  "role": "waiting_screen"
}
```

يمكن إنشاء هذه المستندات يدويًا من Firebase Console. لوحة Console تعمل بصلاحيات إدارية ولا تتأثر بقواعد العميل.

## قاعدة البيانات

البيانات الحساسة تبقى هنا ولا يقرأها إلا admin:

```text
appointments/{date}/patients/{patientId}
dailyCounters/{date}
```

بيانات العرض الآمنة:

```text
publicQueue/{date}
publicTickets/{date}/tickets/{bookingCode}
publicLookups/{date}/phones/{phoneKey}
```

`publicTickets` لا يحتوي المرض أو المبلغ أو حالة الدفع. `publicLookups` يسمح بالبحث برقم الهاتف دون السماح باستعراض قائمة الزبائن.

## رفع قواعد Firestore

انسخ محتوى `firestore.rules` إلى Firebase Console:

```text
Firestore Database > Rules
```

ثم اضغط Publish.

أو استخدم Firebase CLI إذا كان المشروع مربوطًا:

```bash
firebase deploy --only firestore:rules
```

إذا لم تكن قد ربطت المجلد بالمشروع، استخدم:

```bash
firebase deploy --only firestore:rules --project doctor-14c38
```

## التشغيل محليًا

لأن التطبيق يستخدم ES Modules من CDN، شغله عبر خادم محلي بدل فتح الملفات مباشرة.

باستخدام npm:

```bash
npm start
```

ثم افتح:

```text
http://127.0.0.1:8000
```

إذا كان المنفذ 8000 مستخدمًا على Windows PowerShell:

```powershell
$env:PORT=8001; npm start
```

أو يمكن تشغيله بأي خادم ثابت آخر:

```bash
python -m http.server 8000
```

ثم افتح:

- `http://localhost:8000/customer.html`
- `http://localhost:8000/login.html?target=admin`
- `http://localhost:8000/login.html?target=waiting`

## شرح الواجهات

- `customer.html`: واجهة عامة للزبون. يبحث برقم الهاتف في مواعيد اليوم فقط، أو يفتح رابط QR، ويعرض الاسم، رقم الدور، الحالة، الرقم الحالي، وعدد المنتظرين قبله تقريبًا.
- `admin.html`: لوحة الإدارة. تسجيل زبون، توليد QR، طباعة البطاقة، إحصائيات اليوم، جدول كامل، بحث وفلترة، وتغيير الحالات.
- `waiting.html`: شاشة صالة الانتظار. تعرض الرقم الحالي، التالي، عدد المنتظرين، وتنطق الرقم عند النداء.
- `login.html`: دخول الإدارة أو شاشة الانتظار حسب دور المستخدم في `users/{uid}`.

## ملاحظات تشغيل مهمة

- يبدأ العداد من رقم 1 تلقائيًا كل يوم لأن المفتاح اليومي هو تاريخ الجزائر مثل `2026-05-18`.
- زر "استدعاء التالي" يبحث عن أول زبون حالته `waiting` ورقمه أكبر من الرقم الحالي.
- زر "إعادة النداء" يرسل إشارة صوتية جديدة لشاشة الانتظار دون تغيير رقم الدور.
- لا تعرض واجهة الزبون المرض أو المبالغ أو قائمة الزبائن العامة.
