const enquiryForm = document.getElementById("enquiryForm");
const submitEnquiryBtn = document.getElementById("submitEnquiryBtn");

const enqName = document.getElementById("enqName");
const enqContact = document.getElementById("enqContact");
const enqEmail = document.getElementById("enqEmail");
const enqAddress = document.getElementById("enqAddress");
const enqInterestedIn = document.getElementById("enqInterestedIn");
const enqSource = document.getElementById("enqSource");
const enqFollowUpDate = document.getElementById("enqFollowUpDate");
const enqMessage = document.getElementById("enqMessage");

const ENQUIRY_BTN_DEFAULT = submitEnquiryBtn ? submitEnquiryBtn.textContent : "Submit Enquiry";

function setEnquirySubmitting(isSubmitting) {
  if (!submitEnquiryBtn) return;
  submitEnquiryBtn.disabled = isSubmitting;
  submitEnquiryBtn.textContent = isSubmitting ? "Submitting..." : ENQUIRY_BTN_DEFAULT;
}

function normalizePhoneForWhatsApp(mobile) {
  return String(mobile || "").replace(/\D/g, "").slice(-10);
}

function createEnquiryWhatsAppMessage(){return window.ZenithMessages.render('enquiry',{member_name:enqName.value,phone:enqContact.value,address:window.zenithAddressValue(enqAddress),plan:enqInterestedIn.value,follow_up_date:enqFollowUpDate.value});}

function askToSendWhatsApp(phone, message) {
  const formattedPhone = normalizePhoneForWhatsApp(phone);
  if (!formattedPhone) return;

  if (confirm("Enquiry saved. Send WhatsApp message now?")) {
    window.open(
      `https://wa.me/91${formattedPhone}?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  }
}

enquiryForm.addEventListener("submit", function (e) {
  e.preventDefault();

  const name = String(enqName.value || "").trim();
  const contact = String(enqContact.value || "").trim();

  if (!name) return alert("Please enter Name");
  if (!contact) return alert("Please enter Contact No");

  const formData = new FormData();
  formData.append("action", "enquire");
  formData.append("name", name);
  formData.append("contact", contact);
  formData.append("email", String(enqEmail.value || "").trim());
  formData.append("address", window.zenithAddressValue(enqAddress));
  formData.append("interestedIn", String(enqInterestedIn.value || "").trim());
  formData.append("source", String(enqSource.value || "").trim());
  formData.append("followUpDate", String(enqFollowUpDate.value || "").trim());
  formData.append("message", String(enqMessage.value || "").trim());

  setEnquirySubmitting(true);

  window.submitToZenithDatabase(formData)
    .then((res) => res.text())
    .then((txt) => {
      const raw = (txt || "").trim();

      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = null;
      }

      if (data && data.success) {
        const whatsappPhone = contact;
        const whatsappMessage = createEnquiryWhatsAppMessage();
        alert("✅ Enquiry saved to Supabase. It is now available in the dashboard and follow-ups.");
        askToSendWhatsApp(whatsappPhone, whatsappMessage);
        enquiryForm.reset();
        return;
      }

      alert("❌ Error submitting enquiry: " + raw);
    })
    .catch((err) => {
      console.error(err);
      alert("❌ " + (err.message || "Could not save enquiry to Supabase"));
    })
    .finally(() => {
      setEnquirySubmitting(false);
    });
});
