// SEARCH INPUT
const searchMobile = document.getElementById("searchMobile");

// MEMBER DETAILS
const memberName = document.getElementById("memberName");
const memberId = document.getElementById("memberId");
const currentPlan = document.getElementById("currentPlan");
const currentEndDate = document.getElementById("currentEndDate");

// HIDDEN
const hiddenAdmissionId = document.getElementById("hiddenAdmissionId");
const hiddenMobile = document.getElementById("hiddenMobile");

// RENEWAL FORM
const renewalForm = document.getElementById("renewalForm");
const newPlan = document.getElementById("newPlan");
const renewStartDate = document.getElementById("renewStartDate");
const renewEndDate = document.getElementById("renewEndDate");

const paymentMode = document.getElementById("paymentMode");
const amountPaid = document.getElementById("amountPaid");
const pendingAmount = document.getElementById("pendingAmount");
const saveBtn = document.getElementById("saveRenewalBtn");

const RENEWAL_BTN_DEFAULT = saveBtn ? saveBtn.textContent : "Save Renewal";

function setRenewalSubmitting(isSubmitting) {
  if (!saveBtn) return;
  saveBtn.disabled = isSubmitting;
  saveBtn.textContent = isSubmitting ? "Submitting..." : RENEWAL_BTN_DEFAULT;
}

function ddmmyyyyToISO(dateStr) {
  if (!dateStr) return "";
  const [dd, mm, yyyy] = dateStr.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizePhoneForWhatsApp(mobile) {
  return String(mobile || "").replace(/\D/g, "").slice(-10);
}

function formatISODateDDMMYYYY(value) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}-${mm}-${yyyy}`;
}

function parseDatabaseResponse(rawText) {
  const raw = (rawText || "").trim();

  try {
    return { data: JSON.parse(raw), raw, error: "" };
  } catch (_) {
    const isGoogleErrorPage =
      /<html|<!doctype|page not found|docs\.google\.com|presentations/i.test(raw);

    return {
      data: null,
      raw,
      error: isGoogleErrorPage
        ? "The server returned an unexpected page. Open the form from your staff dashboard and reload it."
        : raw || "Empty response from the database server."
    };
  }
}

function createRenewalWhatsAppMessage(){return window.ZenithMessages.render('renewed',{member_name:memberName.value,admission_id:hiddenAdmissionId.value,phone:hiddenMobile.value,plan:newPlan.options[newPlan.selectedIndex]?.text,start_date:formatISODateDDMMYYYY(renewStartDate.value),end_date:formatISODateDDMMYYYY(renewEndDate.value),amount_paid:amountPaid.value,pending_amount:pendingAmount.value});}

function askToSendWhatsApp(phone, message) {
  const formattedPhone = normalizePhoneForWhatsApp(phone);
  if (!formattedPhone) return;

  if (confirm("Renewal saved. Send WhatsApp message now?")) {
    window.open(
      `https://wa.me/91${formattedPhone}?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  }
}

/* =========================
   FETCH MEMBER BY MOBILE
========================= */
function fetchMember() {
  const input = searchMobile.value.trim();
  if (!input) return alert("Enter Mobile Number or Admission ID");

  // Detect Admission ID when it matches <PREFIX>-<number>.
  // Numeric inputs should be treated as mobile numbers.
  let queryParam = "";
  const isAdmissionId = /^[A-Z]+-\d+$/i.test(input);

  if (isAdmissionId) {
    queryParam = `admissionId=${encodeURIComponent(input)}`;
  } else {
    queryParam = `mobile=${encodeURIComponent(input)}`;
  }

  fetch(`/api/portal/member-lookup?${queryParam}`)
    .then(async res => {const text=await res.text();if(!res.ok){let error;try{error=JSON.parse(text).error;}catch{}throw new Error(error||'Sign into the staff dashboard to look up members.');}return text;})
    .then(txt => {
      const parsed = parseDatabaseResponse(txt);
      if (!parsed.data) {
        throw new Error(parsed.error);
      }
      return parsed.data;
    })
    .then(data => {
      if (!data.success) {
        alert("❌ " + (data.message || "Member not found in Supabase"));
        return;
      }

      // Populate member data
      memberName.value = data.name;
      memberId.value = data.admissionId;
      currentPlan.value = data.plan;
      currentEndDate.value = data.endDate || "";

      hiddenAdmissionId.value = data.admissionId;
      hiddenMobile.value = data.mobile;

      enableRenewalForm();

      // Default start date = next day after current end date
      if (data.endDate) {
        const isoEndDate = ddmmyyyyToISO(data.endDate);
        const d = new Date(isoEndDate);
        d.setDate(d.getDate() + 1);
        renewStartDate.value = d.toISOString().split("T")[0];
        calculateRenewEndDate();
      }
    })
    .catch(err => {
      console.error(err);
      alert("❌ Error fetching member: " + (err.message || "Unknown error"));
    });
}

/* =========================
   ENABLE FORM
========================= */
function enableRenewalForm() {
  [
    newPlan,
    renewStartDate,
    renewEndDate,
    paymentMode,
    amountPaid,
    pendingAmount,
    saveBtn
  ].forEach(el => {
    el.disabled = false;
  });
}

/* =========================
   CALCULATE END DATE
========================= */
function calculateRenewEndDate() {
  window.ZenithPackageDates.update(newPlan,renewStartDate,renewEndDate,document.getElementById("customDays"),document.getElementById("customDaysField"));
}

function getPaymentSummary() {
  const paid = Number(amountPaid.value) || 0;
  const pending = Number(pendingAmount.value) || 0;
  const finalDue = paid + pending;
  let status = "Pending";

  if (finalDue > 0 && pending <= 0) {
    status = "Paid";
  } else if (paid > 0 && pending > 0) {
    status = "Partial";
  }

  return {
    amountPaid: paid,
    pendingAmount: pending,
    finalAmount: finalDue,
    paymentStatus: status
  };
}

/* =========================
   SAVE RENEWAL
========================= */
renewalForm.addEventListener("submit", function (e) {
  e.preventDefault();
  if (!renewEndDate.value) return alert("Please select an end date");

  const payment = getPaymentSummary();
  if (payment.finalAmount <= 0) return alert("Please enter amount paid or pending amount");
  if (payment.amountPaid > 0 && !paymentMode.value) return alert("Please select payment mode");

  const formData = new FormData();
  formData.append("action", "saveRenewal");
  formData.append("admissionId", hiddenAdmissionId.value);
  formData.append("mobile", hiddenMobile.value);
  formData.append("name", memberName.value);
  formData.append("plan", newPlan.value);
  if (newPlan.value === "custom") formData.append("customDays", document.getElementById("customDays").value);
  formData.append("startDate", renewStartDate.value);
  formData.append("endDate", renewEndDate.value);
  formData.append("amount", payment.finalAmount);
  formData.append("discount", 0);
  formData.append("finalAmount", payment.finalAmount);
  formData.append("paymentStatus", payment.paymentStatus);
  formData.append("amountPaid", payment.amountPaid);
  formData.append("pendingAmount", payment.pendingAmount);
  formData.append("paymentMode", paymentMode.value);

  try { window.zenithSplitPayment.append(formData); } catch(error) { return alert(error.message); }

  setRenewalSubmitting(true);

  window.submitToZenithDatabase(formData)
    .then(res => res.text())
    .then(async txt => {
      const parsed = parseDatabaseResponse(txt);
      const raw = parsed.raw;
      const data = parsed.data;

      if (data && data.success) {
        const whatsappPhone = hiddenMobile.value;
        const whatsappMessage = createRenewalWhatsAppMessage();
        alert("✅ Renewal saved to Supabase. The dashboard renewal month has been updated. Sheets and device updates are queued.");
        askToSendWhatsApp(whatsappPhone, whatsappMessage);
        renewalForm.reset();
        return;
      }

      if (/success/i.test(raw)) {
        const whatsappPhone = hiddenMobile.value;
        const whatsappMessage = createRenewalWhatsAppMessage();
        alert("✅ Renewal Saved Successfully");
        askToSendWhatsApp(whatsappPhone, whatsappMessage);
        renewalForm.reset();
        return;
      }

      alert("❌ Error saving renewal: " + (data?.message || parsed.error));
    })
    .catch(err => {
      console.error(err);
      alert("❌ " + (err.message || "Could not save to Supabase"));
    })
    .finally(() => {
      setRenewalSubmitting(false);
    });
});

/* =========================
   LISTENERS
========================= */
newPlan.addEventListener("change", calculateRenewEndDate);
renewStartDate.addEventListener("change", calculateRenewEndDate);

const requestedMember=new URLSearchParams(location.search).get("member");if(requestedMember){searchMobile.value=requestedMember;fetchMember();}

document.getElementById("customDays").addEventListener("input",calculateRenewEndDate);
newPlan.form.addEventListener("reset",()=>setTimeout(calculateRenewEndDate,0));
calculateRenewEndDate();
