// Get all input elements
const admissionForm = document.getElementById("admissionForm");
const submitAdmissionBtn = document.getElementById("submitAdmissionBtn");
const nameInput = document.getElementById("name");
const mobileInput = document.getElementById("mobile");
const genderInput = document.getElementById("gender");
const ageInput = document.getElementById("age");
const planInput = document.getElementById("plan");
const categoryInput = document.getElementById("category");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const paymentModeInput = document.getElementById("paymentMode");
const amountPaidInput = document.getElementById("amountPaid");
const pendingAmountInput = document.getElementById("pendingAmount");
const remarksInput = document.getElementById("remarks");
const birthDateInput = document.getElementById("birthDate");
const addressInput = document.getElementById("address");
const injuriesInput = document.getElementById("injuries");
function updateBirthDetails(){
  const iso=window.ZenithMemberDates.parse(birthDateInput.value);
  const age=window.ZenithMemberDates.ageOn(iso);
  const invalid=Boolean(birthDateInput.value)&&age===null;
  birthDateInput.setCustomValidity(invalid?'Enter a valid birth date as DD/MM/YYYY, today or earlier.':'');
  ageInput.readOnly=Boolean(birthDateInput.value);
  ageInput.value=age===null?'':String(age);
  return !invalid;
}
birthDateInput.addEventListener('input',()=>{
  const position=birthDateInput.selectionStart??birthDateInput.value.length;
  const digitsBefore=birthDateInput.value.slice(0,position).replace(/\D/g,'').length;
  birthDateInput.value=window.ZenithMemberDates.format(birthDateInput.value);
  let caret=0,count=0;while(caret<birthDateInput.value.length&&count<digitsBefore){if(/\d/.test(birthDateInput.value[caret]))count++;caret++;}
  birthDateInput.setSelectionRange(caret,caret);updateBirthDetails();
});
admissionForm.addEventListener('reset',()=>setTimeout(updateBirthDetails,0));

const ADMISSION_BTN_DEFAULT = submitAdmissionBtn ? submitAdmissionBtn.textContent : "Submit Admission";

/* =========================
   AUTO CALCULATE END DATE
========================= */
function calculateEndDate() {
  window.ZenithPackageDates.update(planInput,startDateInput,endDateInput,document.getElementById("customDays"),document.getElementById("customDaysField"));
}

function getPaymentSummary() {
  const amountPaid = Number(amountPaidInput.value) || 0;
  const pendingAmount = Number(pendingAmountInput.value) || 0;
  const finalAmount = amountPaid + pendingAmount;
  let paymentStatus = "Pending";

  if (finalAmount > 0 && pendingAmount <= 0) {
    paymentStatus = "Paid";
  } else if (amountPaid > 0 && pendingAmount > 0) {
    paymentStatus = "Partial";
  }

  return {
    amountPaid,
    pendingAmount,
    finalAmount,
    paymentStatus
  };
}

function setAdmissionSubmitting(isSubmitting) {
  if (!submitAdmissionBtn) return;
  submitAdmissionBtn.disabled = isSubmitting;
  submitAdmissionBtn.textContent = isSubmitting ? "Submitting..." : ADMISSION_BTN_DEFAULT;
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

function extractNumericId(admissionId) {
  return admissionId ? admissionId.replace(/\D/g, '') : null;
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

function createAdmissionWhatsAppMessage(admissionId){return window.ZenithMessages.render('admission',{member_name:nameInput.value,admission_id:admissionId,phone:mobileInput.value,plan:planInput.options[planInput.selectedIndex]?.text,start_date:formatISODateDDMMYYYY(startDateInput.value),end_date:formatISODateDDMMYYYY(endDateInput.value),amount_paid:amountPaidInput.value,pending_amount:pendingAmountInput.value,address:window.zenithAddressValue(addressInput)});}
function askToSendWhatsApp(phone, message) {
  const formattedPhone = normalizePhoneForWhatsApp(phone);
  if (!formattedPhone) return;

  if (confirm("Admission saved. Send WhatsApp message now?")) {
    window.open(
      `https://wa.me/91${formattedPhone}?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  }
}

/* =========================
   SUBMIT FORM
========================= */
admissionForm.addEventListener("submit", function (e) {
  e.preventDefault();
  if(birthDateInput.value&&!updateBirthDetails())return birthDateInput.reportValidity();

  // Basic validation
  if (!planInput.value) return alert("Please select a plan");
  if (!categoryInput.value) return alert("Please select a membership type");
  if (!startDateInput.value) return alert("Please select a start date");
  if (!endDateInput.value) return alert("Please select an end date");

  const payment = getPaymentSummary();
  if (payment.finalAmount <= 0) return alert("Please enter amount paid or pending amount");
  if (payment.amountPaid > 0 && !paymentModeInput.value) return alert("Please select payment mode");

  const formData = new FormData();
  formData.append("name", nameInput.value);
  formData.append("mobile", mobileInput.value);
  formData.append("gender", genderInput.value);
  formData.append("age", ageInput.value);
  formData.append("plan", planInput.value);
  if (planInput.value === "custom") formData.append("customDays", document.getElementById("customDays").value);
  formData.append("category", categoryInput.value);
  formData.append("startDate", startDateInput.value);
  formData.append("endDate", endDateInput.value);
  formData.append("totalAmount", payment.finalAmount);
  formData.append("discount", 0);
  formData.append("finalAmount", payment.finalAmount);
  formData.append("amountPaid", payment.amountPaid);
  formData.append("pendingAmount", payment.pendingAmount);
  formData.append("paymentMode", paymentModeInput.value);
  formData.append("paymentStatus", payment.paymentStatus);
  formData.append("remarks", remarksInput.value);
  formData.append("action", "admission");
  formData.append("birthDate", window.ZenithMemberDates.parse(birthDateInput.value));
  formData.append("address", window.zenithAddressValue(addressInput));
  formData.append("injuries", injuriesInput.value);

  try { window.zenithSplitPayment.append(formData); } catch(error) { return alert(error.message); }

  setAdmissionSubmitting(true);

  window.submitToZenithDatabase(formData)
    .then(res => res.text())
    .then(async txt => {
      const parsed = parseDatabaseResponse(txt);
      const raw = parsed.raw;
      const data = parsed.data;

      if (raw === "DUPLICATE_MOBILE") {
        alert("❌ This mobile number is already registered");
        return;
      }

      if (data && data.success) {
        const admissionId = data.admissionId || data.id || "";
        const whatsappMessage = createAdmissionWhatsAppMessage(admissionId);
        const whatsappPhone = mobileInput.value;

        alert("✅ Admission saved to Supabase and added to the dashboard. Sheets and device updates are queued.");
        askToSendWhatsApp(whatsappPhone, whatsappMessage);
        admissionForm.reset();
        return;
      }

      if (data && data.success === false) {
        alert("❌ Server Error: " + (data.message || "Admission was not saved"));
        return;
      }

      if (/success/i.test(raw)) {
        const whatsappMessage = createAdmissionWhatsAppMessage("");
        const whatsappPhone = mobileInput.value;
        alert("✅ Admission Saved Successfully");
        askToSendWhatsApp(whatsappPhone, whatsappMessage);
        admissionForm.reset();
        return;
      }

      alert("❌ Server Error: " + parsed.error);
    })
    .catch(err => {
      console.error(err);
      alert("❌ " + (err.message || "Could not save to Supabase"));
    })
    .finally(() => {
      setAdmissionSubmitting(false);
    });
});

/* =========================
   EVENT LISTENERS
========================= */
planInput.addEventListener("change", calculateEndDate);
startDateInput.addEventListener("change", calculateEndDate);

document.getElementById("customDays").addEventListener("input",calculateEndDate);
planInput.form.addEventListener("reset",()=>setTimeout(calculateEndDate,0));
calculateEndDate();
