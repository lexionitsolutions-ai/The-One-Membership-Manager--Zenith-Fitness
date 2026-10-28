function doPost(e) {
  const data = e && e.parameter ? e.parameter : {};
  const action = String(data.action || "").trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {

    const memberUpdateResponse = handleMemberUpdateAction_(action, data, ss);
    if (memberUpdateResponse) return memberUpdateResponse;

    /* =========================
       ADMISSION
    ========================== */
    if (action === "admission") {
      const lock = LockService.getDocumentLock();
      let result = {};

      try {
        lock.waitLock(30000);

        if (isDuplicateMobileFast_(data.mobile)) {
          return json_({ success: false, message: "Duplicate Mobile" });
        }

        const rawPlan = String(data.plan || "").trim().toLowerCase();

        const planMap = {
          "30": "1 Month",
          "90": "3 Months",
          "180": "6 Months",
          "365": "1 Year",
          "custom": "1 Month"
        };

        const planLabelMap = {
          "30": "1 Month",
          "90": "3 Months",
          "180": "6 Months",
          "365": "1 Year",
          "custom": "Customize Package"
        };

        const sheetName = planMap[rawPlan];
        const planLabel = planLabelMap[rawPlan] || rawPlan;

        if (!sheetName) {
          return json_({ success: false, message: "Invalid Plan" });
        }

        const sheet = getOrCreateSheet_(ss, sheetName, [
          "Admission ID","Name","Mobile","Gender","Age","Plan","Category",
          "Start Date","End Date","Total Amount","Discount","Final Amount",
          "Payment Mode","Payment Status","Remarks","Timestamp",
          "WhatsApp Message","Birth Date","Address","Medical History",
          "Amount Paid","Pending Amount"
        ]);

        const newId = generateGlobalAdmissionId_(data.category);

        const admissionMessage =
`Welcome to Zenith Fitness ${data.name || ""} 💪

Your admission has been successfully completed.

🆔 Admission ID: ${newId}
-> Plan: ${planLabel}
-> Start Date: ${formatDateDDMMYYYY_(data.startDate)}
-> End Date: ${formatDateDDMMYYYY_(data.endDate)}

We’re excited to be a part of your fitness journey 🔥

-> Gym Timings:
Mon–Sat: 6:00 AM – 11:00 PM
Sunday: 6:30 AM – 10:00 AM

📲 Important:
Save this number *9272112745* in your contacts to receive important updates, workout tips, and announcements.

📸 Instagram:
https://www.instagram.com/zenithfitness360

Let’s build your best version together`;

        const admissionWhatsappLink = createWhatsAppLink_(
          data.mobile,
          admissionMessage,
          "Send WhatsApp"
        );

        const admissionPayment = calculatePaymentValues_(
          data.finalAmount,
          data.amountPaid,
          data.pendingAmount,
          data.paymentStatus
        );

        sheet.appendRow([
          newId,
          data.name || "",
          normalizePhoneForStorage_(data.mobile),
          data.gender || "",
          data.age || "",
          planLabel,
          data.category || "",
          parseDateForSheet_(data.startDate),
          parseDateForSheet_(data.endDate),
          Number(data.totalAmount) || 0,
          Number(data.discount) || 0,
          Number(data.finalAmount) || 0,
          data.paymentMode || "",
          admissionPayment.paymentStatus,
          data.remarks || "",
          parseDateForSheet_(new Date()),
          admissionWhatsappLink,
          parseDateForSheet_(data.birthDate),
          data.address || "",
          data.injuries || "",
          admissionPayment.amountPaid,
          admissionPayment.pendingAmount
        ]);

        const admissionLastRow = sheet.getLastRow();
        sheet.getRange(admissionLastRow, 8, 1, 2).setNumberFormat("dd-MM-yyyy");
        sheet.getRange(admissionLastRow, 16).setNumberFormat("dd-MM-yyyy");     // Timestamp
        sheet.getRange(admissionLastRow, 18).setNumberFormat("dd-MM-yyyy");     // Birth Date

        result = {
          admissionId: newId,
          sheetName,
          row: admissionLastRow,
          planLabel
        };

      } finally {
        try { lock.releaseLock(); } catch (_) {}
      }

      try {

        const admissionPayment = calculatePaymentValues_(
          data.finalAmount,
          data.amountPaid,
          data.pendingAmount,
          data.paymentStatus
        );

        if (admissionPayment.amountPaid > 0) {
          const membershipType = inferMembershipTypeFrom_(data.category, result.admissionId);

          appendCashbookEntry_(
            ss,
            new Date(),
            `New Admission - ${membershipType} - ${data.name} (${result.admissionId})`,
            "New Admission",
            admissionPayment.amountPaid,
            data.paymentMode
          );
        }
        enqueuePostProcess_();

      } catch (postErr) {
        Logger.log("Admission saved but post-processing failed: " + postErr.message);
      }

      return json_({
        success: true,
        message: "Admission saved successfully",
        admissionId: result.admissionId
      });
    }

    /* =========================
       RENEWAL
    ========================== */
    if (action === "saveRenewal") {
      const lock = LockService.getDocumentLock();
      let result = {};

      try {
        lock.waitLock(30000);

        const rawPlan = String(data.plan || "").trim().toLowerCase();

        const planMap = {
          "30": "Renewals 1M",
          "90": "Renewals 3M",
          "180": "Renewals 6M",
          "365": "Renewals 1Y",
          "custom": "Renewals 1M"
        };

        const planLabelMap = {
          "30": "1 Month",
          "90": "3 Months",
          "180": "6 Months",
          "365": "1 Year",
          "custom": "Customize Package"
        };

        const sheetName = planMap[rawPlan];
        const planLabel = planLabelMap[rawPlan] || rawPlan;

        if (!sheetName) {
          return json_({ success: false, message: "Invalid Plan" });
        }

        const sheet = getOrCreateSheet_(ss, sheetName, [
          "Admission ID","Name","Mobile","Plan",
          "Start Date","End Date",
          "Amount","Discount","Final Amount",
          "Payment Mode","Timestamp","WhatsApp Message",
          "Payment Status","Remarks","Amount Paid","Pending Amount"
        ]);

        const renewalMessage = `Hello ${data.name || ""},\n\n` + `Your membership at Zenith Fitness has been successfully renewed.\n\n` + `Admission ID: ${data.admissionId || ""}\n\n` + `Plan: ${planLabel}\n\n` + `Start Date: ${formatDateDDMMYYYY_(data.startDate)}\n\n` + `End Date: ${formatDateDDMMYYYY_(data.endDate)}\n\n` + `Thank you for continuing your fitness journey with us. 💪\n\n` + `We truly appreciate your trust and support.\n\n` + `⭐ If you are genuinely happy with our services, we would be grateful if you could leave us a Google Review.\n\n` + `Your review helps us grow, reach more people, and build a stronger and healthier fitness community.\n\n` + `Google Review Link:\n\n` + `https://g.page/r/CTR-7sBIfPWYEBM/review\n\n` + `Thank you for being a valued member of Zenith Fitness.\n\n` + `Stay Fit. Stay Strong. 🔥\n\n` + `Team Zenith Fitness`;

        const renewalWhatsappLink = createWhatsAppLink_(
          data.mobile,
          renewalMessage,
          "Send WhatsApp"
        );

        const renewalPayment = calculatePaymentValues_(
          data.finalAmount,
          data.amountPaid,
          data.pendingAmount,
          data.paymentStatus
        );

        sheet.appendRow([
          data.admissionId || "",
          data.name || "",
          normalizePhoneForStorage_(data.mobile),
          planLabel,
          parseDateForSheet_(data.startDate),
          parseDateForSheet_(data.endDate),
          Number(data.amount) || 0,
          Number(data.discount) || 0,
          Number(data.finalAmount) || 0,
          data.paymentMode || "",
          parseDateForSheet_(new Date()),
          renewalWhatsappLink,
          renewalPayment.paymentStatus,
          data.remarks || "",
          renewalPayment.amountPaid,
          renewalPayment.pendingAmount
        ]);

        const renewalLastRow = sheet.getLastRow();
        sheet.getRange(renewalLastRow, 5, 1, 2).setNumberFormat("dd-MM-yyyy");
        sheet.getRange(renewalLastRow, 11).setNumberFormat("dd-MM-yyyy");      // Timestamp

        result = {
          sheetName,
          row: renewalLastRow,
          planLabel
        };

      } finally {
        try { lock.releaseLock(); } catch (_) {}
      }

      try {

        const renewalPayment = calculatePaymentValues_(
          data.finalAmount,
          data.amountPaid,
          data.pendingAmount,
          data.paymentStatus
        );
        const renewalPaidAmount = renewalPayment.amountPaid;

        if (renewalPaidAmount > 0) {
          appendCashbookEntry_(
            ss,
            new Date(),
            `Renewal - ${result.planLabel} - ${data.name} (${data.admissionId})`,
            "Renewal",
            renewalPaidAmount,
            data.paymentMode
          );
        }
        enqueuePostProcess_();

      } catch (postErr) {
        Logger.log("Renewal saved but post-processing failed: " + postErr.message);
      }

      return json_({
        success: true,
        message: "Renewal saved successfully"
      });
    }

    /* =========================
       ENQUIRY
    ========================== */
    if (action === "enquire") {
      const lock = LockService.getDocumentLock();
      let result = {};

      try {
        lock.waitLock(20000);

        const sheet = getOrCreateSheet_(ss, "Enquiries", [
          "Date",
          "Name",
          "Contact",
          "Email",
          "Interested In",
          "Source",
          "Follow-up Date",
          "Message",
          "Timestamp",
          "WhatsApp Message"
        ]);

        const tz = Session.getScriptTimeZone();
        const now = new Date();
        const dateLabel = Utilities.formatDate(now, tz, "dd-MM-yyyy");

        const enquiryMessage =
`Thank You for enquiring at Zenith Fitness :)

We’re located behind ITI College, Hanuman Nagar, Pachgaon Road, Kolhapur.

Here is what we offer:

-> Strength Training
-> Cardio
-> Functional Training
-> Yoga
-> Personal Training

Gym Timings:
-> Mon–Sat: 6:00 AM – 11:00 PM
-> Sunday: 6:30 AM – 10:00 AM

-> FREE one-day trial available!

For enquiries or to start your fitness journey:
-> 9272112745

Instagram:
-> https://www.instagram.com/zenithfitness360`;

        const enquiryWhatsappLink = createWhatsAppLink_(
          data.mobile || data.contact,
          enquiryMessage,
          "Send WhatsApp"
        );

        appendEnquiryRowWithDateHeader_(sheet, [
          dateLabel,
          data.name || "",
          normalizePhoneForStorage_(data.mobile || data.contact),
          data.email || "",
          data.interestedIn || data.goal || "",
          data.source || "",
          parseDateForSheet_(data.followUpDate),
          "",
          parseDateForSheet_(now),
          enquiryWhatsappLink
        ], dateLabel);

        const enquiryLastRow = sheet.getLastRow();

        result = {
          row: enquiryLastRow
        };

      } finally {
        try { lock.releaseLock(); } catch (_) {}
      }

      try {
        const sheet = ss.getSheetByName("Enquiries");

        if (sheet && result.row) {
          sheet.getRange(result.row, 1).setNumberFormat("dd-MM-yyyy");
          sheet.getRange(result.row, 7).setNumberFormat("dd-MM-yyyy");
          sheet.getRange(result.row, 9).setNumberFormat("dd-MM-yyyy");
        }

        enqueueEndOfDayRebuild_();

      } catch (postErr) {
        Logger.log("Enquiry saved but post-processing failed: " + postErr.message);
      }

      return json_({
        success: true,
        message: "Enquiry saved successfully"
      });
    }

    return json_({
      success: false,
      message: "Invalid Action"
    });

  } catch (err) {
    Logger.log("doPost Error: " + (err && err.message ? err.message : String(err)));

    return json_({
      success: false,
      message: "Submission failed. Please try again.",
      error: err && err.message ? err.message : String(err)
    });
  }
}

function enqueueEndOfDayRebuild_() {
  PropertiesService.getScriptProperties().setProperties({
    END_OF_DAY_REBUILD_PENDING: "1",
    END_OF_DAY_REBUILD_REQUESTED_AT: String(Date.now())
  }, false);
}

function doGet(e) {
  try {
    const action = String(
      (e && e.parameter && e.parameter.action) || ""
    ).trim();

    if (action === "getAllMembers") {
      return getAllMembers_();
    }

    // New action used only by the Zenith application.
    if (action === "getMembershipRows") {
      return getMembershipRowsForZenith_();
    }

    if (action !== "fetchMember") {
      return json_({
        success: false,
        message: "Invalid action"
      });
    }

    const mobileParam = normalizePhoneForStorage_(e.parameter.mobile || "");
    const admissionIdParam = String(e.parameter.admissionId || "").trim();

    if (!mobileParam && !admissionIdParam) {
      return json_({
        success: false,
        message: "Mobile or Admission ID required"
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheets = getMemberSourceConfigs_();

    let latestRecord = null;
    let latestEndDate = null;

    sourceSheets.forEach(cfg => {
      const sheet = ss.getSheetByName(cfg.name);
      if (!sheet || sheet.getLastRow() < 2) return;

      const data = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        const rowAdmissionId = String(data[i][cfg.idCol]).trim();
        const rowMobile = normalizePhoneForStorage_(data[i][cfg.mobileCol]);

        const match =
          (mobileParam && rowMobile === mobileParam) ||
          (admissionIdParam && rowAdmissionId === admissionIdParam);

        if (!match) continue;

        const end = parseDateSafe_(data[i][cfg.endDateCol]);
        if (!end) continue;

        if (!latestEndDate || end > latestEndDate) {
          latestEndDate = end;
          const record = {
            sheet: sheet,
            row: i + 1,
            values: data[i],
            cfg: cfg,
            admissionId: rowAdmissionId,
            mobile: rowMobile,
            name: data[i][cfg.nameCol]
          };
          const paymentSnapshot = getPaymentSnapshotForRecord_(record);

          latestRecord = {
            admissionId: rowAdmissionId,
            name: data[i][cfg.nameCol],
            mobile: rowMobile,
            plan: data[i][cfg.planCol],
            startDate: data[i][cfg.startDateCol],
            endDate: data[i][cfg.endDateCol],
            paymentStatus: paymentSnapshot.paymentStatus,
            pendingAmount: paymentSnapshot.pendingAmount
          };
        }
      }
    });

    if (!latestRecord) {
      return json_({ success: false, message: "Member not found" });
    }

    return json_({
      success: true,
      admissionId: latestRecord.admissionId,
      name: latestRecord.name,
      mobile: latestRecord.mobile,
      plan: latestRecord.plan,
      startDate: formatDateDDMMYYYY_(latestRecord.startDate),
      endDate: formatDateDDMMYYYY_(latestRecord.endDate),
      paymentStatus: latestRecord.paymentStatus || "",
      pendingAmount: Number(latestRecord.pendingAmount) || 0
    });

  } catch (err) {
    return json_({ success: false, error: err.message || String(err) });
  }
}

/* =========================================================
   POST PROCESS QUEUE
========================================================= */

function enqueuePostProcess_() {
  // One PropertiesService write instead of several separate calls.
  PropertiesService.getScriptProperties().setProperties({
    REBUILD_PENDING_AMOUNTS_PENDING: "1",
    REBUILD_RENEWALS_PENDING: "1",
    END_OF_DAY_REBUILD_PENDING: "1",
    POST_PROCESS_REQUESTED_AT: String(Date.now())
  }, false);
}

function processPostProcessQueue() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(3000)) return;

    // 1) Pending Amounts first so payment visibility is updated quickly.
    if (props.getProperty("REBUILD_PENDING_AMOUNTS_PENDING") === "1") {
      try {
        updatePendingAmountsList_();
        props.deleteProperty("REBUILD_PENDING_AMOUNTS_PENDING");
      } catch (err) {
        Logger.log("Pending Amounts rebuild error: " + (err.message || err));
      }
      return;
    }

    // 2) Renewals List.
    if (props.getProperty("REBUILD_RENEWALS_PENDING") === "1") {
      try {
        updateRenewalsList_();
        props.deleteProperty("REBUILD_RENEWALS_PENDING");
      } catch (err) {
        Logger.log("Renewals rebuild error: " + (err.message || err));
      }
      return;
    }

    // 3) End Of Day last.
    if (
      props.getProperty("END_OF_DAY_REBUILD_PENDING") === "1" ||
      props.getProperty("REBUILD_EOD_PENDING") === "1"
    ) {
      try {
        rebuildTodayEndOfDayReport_();
        props.deleteProperty("END_OF_DAY_REBUILD_PENDING");
        props.deleteProperty("END_OF_DAY_REBUILD_REQUESTED_AT");
        props.deleteProperty("REBUILD_EOD_PENDING");
      } catch (err) {
        Logger.log("EOD rebuild error: " + (err.message || err));
      }
      return;
    }
  } catch (err) {
    Logger.log("processPostProcessQueue MAIN ERROR: " + (err.message || err));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
function createPostProcessMinuteTrigger() {
  const exists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "processPostProcessQueue");

  if (!exists) {
    ScriptApp.newTrigger("processPostProcessQueue")
      .timeBased()
      .everyMinutes(1)
      .create();
  }
}

/* =========================================================
   CORE HELPERS
========================================================= */

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);

    sh.getRange(1, 1, 1, headers.length)
      .setBackground("#1F2937")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  }

  return sh;
}

function parseDateSafe_(value) {
  if (value === null || value === undefined || value === "") return null;

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const str = String(value).trim();
  if (!str) return null;

  let m;

  // yyyy-MM-dd
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+.*)?$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  // dd-MM-yyyy / dd/MM/yyyy / MM-dd-yyyy / MM/dd/yyyy
  m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s+.*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);

    if (a > 12) return new Date(y, b - 1, a); // dd-mm-yyyy
    if (b > 12) return new Date(y, a - 1, b); // mm-dd-yyyy

    // default for your system
    return new Date(y, b - 1, a);
  }

  // dd.MM.yyyy
  m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return null;

  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateForSheet_(value) {
  const d = parseDateSafe_(value);
  return d || "";
}

function formatDateDDMMYYYY_(value) {
  const d = parseDateSafe_(value);
  if (!d) return "";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd-MM-yyyy");
}

function calculatePaymentValues_(finalAmountValue, amountPaidValue, pendingAmountValue, paymentStatusValue) {
  const finalAmount = Math.max(Number(finalAmountValue) || 0, 0);
  let amountPaid = Math.max(Number(amountPaidValue) || 0, 0);
  const requestedStatus = String(paymentStatusValue || "").trim().toLowerCase();

  // Compatibility: if the form explicitly says Paid but sends no amount,
  // treat the full final amount as paid.
  if (requestedStatus === "paid" && amountPaid <= 0 && finalAmount > 0) {
    amountPaid = finalAmount;
  }

  // Never store more paid than the package final amount on admission/renewal.
  if (finalAmount > 0) amountPaid = Math.min(amountPaid, finalAmount);

  // Server-side source of truth. Never trust client pending amount.
  const pendingAmount = Math.max(finalAmount - amountPaid, 0);
  const paymentStatus = pendingAmount <= 0
    ? "Paid"
    : amountPaid > 0
      ? "Partial"
      : "Pending";

  return {
    finalAmount,
    amountPaid,
    pendingAmount,
    paymentStatus
  };
}

function normalizePhoneForStorage_(mobile) {
  return String(mobile || "").replace(/\D/g, "").slice(-10);
}

function createWhatsAppLink_(phone, message, label) {
  const formattedPhone = normalizePhoneForStorage_(phone);
  if (!formattedPhone) return "";
  return `=HYPERLINK("https://wa.me/91${formattedPhone}?text=${encodeURIComponent(message)}","${label || "Send WhatsApp"}")`;
}

function appendEnquiryRowWithDateHeader_(sheet, rowValues, dateLabel) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    sheet.appendRow([dateLabel, "", "", "", "", "", "", "", "", ""]);
    const headerRow = sheet.getLastRow();
    sheet.getRange(headerRow, 1, 1, 10)
      .merge()
      .setValue(dateLabel)
      .setBackground("#1F2937")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");

    sheet.appendRow(rowValues);
    return;
  }

  const colAValues = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 1).getDisplayValues();
  let lastMeaningful = "";

  for (let i = colAValues.length - 1; i >= 0; i--) {
    const val = String(colAValues[i][0] || "").trim();
    if (val) {
      lastMeaningful = val;
      break;
    }
  }

  if (lastMeaningful !== dateLabel) {
    sheet.appendRow([dateLabel, "", "", "", "", "", "", "", "", ""]);
    const headerRow = sheet.getLastRow();
    sheet.getRange(headerRow, 1, 1, 10)
      .merge()
      .setValue(dateLabel)
      .setBackground("#1F2937")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  }

  sheet.appendRow(rowValues);
}

/* =========================================================
   ADMISSION ID / DUPLICATE CHECK
========================================================= */

function getAdmissionPrefix_(category) {
  const c = String(category || "").trim().toLowerCase();
  if (c === "happy hours") return "HH";
  if (c === "personal training") return "PT";
  return "ZF";
}

function generateGlobalAdmissionId_(category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("System Control");

  if (!sheet) {
    sheet = ss.insertSheet("System Control");
    sheet.appendRow(["LastAdmissionID", 100]);

    sheet.getRange(1, 1, 1, 2)
      .setBackground("#1F2937")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  }

  const lastId = Number(sheet.getRange(1, 2).getValue()) || 100;
  const newNum = lastId + 1;
  sheet.getRange(1, 2).setValue(newNum);

  return `${getAdmissionPrefix_(category)}-${newNum}`;
}

function isDuplicateMobileFast_(mobile) {
  const m = normalizePhoneForStorage_(mobile);
  if (!m) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ["1 Month", "3 Months", "6 Months", "1 Year"];

  for (const name of sheets) {
    const sh = ss.getSheetByName(name);
    if (!sh) continue;

    const lastRow = sh.getLastRow();
    if (lastRow < 2) continue;

    const range = sh.getRange(2, 3, lastRow - 1, 1);
    const hit = range.createTextFinder(m).matchEntireCell(true).findNext();
    if (hit) return true;
  }

  return false;
}

/* =========================================================
   MEMBER FETCH / ALL MEMBERS
========================================================= */

function getMemberSourceConfigs_() {
  return [
    { name: "1 Month",  idCol: 0, nameCol: 1, mobileCol: 2, planCol: 5, startDateCol: 7, endDateCol: 8, finalAmountCol: 11, paymentStatusCol: 13, remarksCol: 14, amountPaidCol: 20, pendingAmountCol: 21 },
    { name: "3 Months", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 5, startDateCol: 7, endDateCol: 8, finalAmountCol: 11, paymentStatusCol: 13, remarksCol: 14, amountPaidCol: 20, pendingAmountCol: 21 },
    { name: "6 Months", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 5, startDateCol: 7, endDateCol: 8, finalAmountCol: 11, paymentStatusCol: 13, remarksCol: 14, amountPaidCol: 20, pendingAmountCol: 21 },
    { name: "1 Year",   idCol: 0, nameCol: 1, mobileCol: 2, planCol: 5, startDateCol: 7, endDateCol: 8, finalAmountCol: 11, paymentStatusCol: 13, remarksCol: 14, amountPaidCol: 20, pendingAmountCol: 21 },

    { name: "Renewals 1M", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 3, startDateCol: 4, endDateCol: 5, finalAmountCol: 8, paymentStatusCol: 12, remarksCol: 13, amountPaidCol: 14, pendingAmountCol: 15 },
    { name: "Renewals 3M", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 3, startDateCol: 4, endDateCol: 5, finalAmountCol: 8, paymentStatusCol: 12, remarksCol: 13, amountPaidCol: 14, pendingAmountCol: 15 },
    { name: "Renewals 6M", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 3, startDateCol: 4, endDateCol: 5, finalAmountCol: 8, paymentStatusCol: 12, remarksCol: 13, amountPaidCol: 14, pendingAmountCol: 15 },
    { name: "Renewals 1Y", idCol: 0, nameCol: 1, mobileCol: 2, planCol: 3, startDateCol: 4, endDateCol: 5, finalAmountCol: 8, paymentStatusCol: 12, remarksCol: 13, amountPaidCol: 14, pendingAmountCol: 15 }
  ];
}

function getAllMembers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configs = getMemberSourceConfigs_();
  const members = {};

  configs.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.name);
    if (!sheet || sheet.getLastRow() < 2) return;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const admissionId = String(data[i][cfg.idCol]).trim();
      const name = data[i][cfg.nameCol];
      const endDateObj = parseDateSafe_(data[i][cfg.endDateCol]);

      if (!admissionId || !endDateObj) continue;

      if (!members[admissionId] || endDateObj > members[admissionId].endDateRaw) {
        members[admissionId] = {
          admissionId: admissionId,
          name: name,
          endDateRaw: endDateObj
        };
      }
    }
  });

  const result = Object.values(members).map(m => ({
    admissionId: m.admissionId,
    name: m.name,
    endDate: formatDateDDMMYYYY_(m.endDateRaw)
  }));

  return json_({ success: true, members: result });
}


/**
 * Returns every membership cycle for the Zenith database import.
 *
 * This function is read-only. It does not modify the spreadsheet.
 * Each spreadsheet row becomes one membership record.
 */
function getMembershipRowsForZenith_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [
    "1 Month",
    "3 Months",
    "6 Months",
    "1 Year"
  ];

  const membershipRows = [];

  sheetNames.forEach(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() < 2) {
      return;
    }

    const rowCount = sheet.getLastRow() - 1;

    // Read the 22 expected columns, starting after the header.
    const values = sheet
      .getRange(2, 1, rowCount, 22)
      .getValues();

    values.forEach(function (row, index) {
      const sourceRow = index + 2;

      const completelyBlank = row.every(function (value) {
        return (
          value === "" ||
          value === null ||
          typeof value === "undefined"
        );
      });

      if (completelyBlank) {
        return;
      }

      membershipRows.push({
        sourceSheet: sheetName,
        sourceRow: sourceRow,

        admissionId: serializeZenithSheetValue_(row[0]),
        name: serializeZenithSheetValue_(row[1]),
        mobile: serializeZenithSheetValue_(row[2]),
        gender: serializeZenithSheetValue_(row[3]),
        age: serializeZenithSheetValue_(row[4]),
        plan: serializeZenithSheetValue_(row[5]),
        category: serializeZenithSheetValue_(row[6]),
        startDate: serializeZenithSheetValue_(row[7]),
        endDate: serializeZenithSheetValue_(row[8]),
        totalAmount: serializeZenithSheetValue_(row[9]),
        discount: serializeZenithSheetValue_(row[10]),
        finalAmount: serializeZenithSheetValue_(row[11]),
        paymentMode: serializeZenithSheetValue_(row[12]),
        paymentStatus: serializeZenithSheetValue_(row[13]),
        remarks: serializeZenithSheetValue_(row[14]),
        timestamp: serializeZenithSheetValue_(row[15]),
        whatsappMessage: serializeZenithSheetValue_(row[16]),
        birthDate: serializeZenithSheetValue_(row[17]),
        address: serializeZenithSheetValue_(row[18]),
        medicalHistory: serializeZenithSheetValue_(row[19]),
        amountPaid: serializeZenithSheetValue_(row[20]),
        pendingAmount: serializeZenithSheetValue_(row[21])
      });
    });
  });
  appendZenithRenewalRows_(spreadsheet, membershipRows);

  return json_({
    success: true,
    members: membershipRows
  });
}

/**
 * Adds renewal membership cycles to the Zenith import.
 * This is read-only and does not modify any sheet.
 */
function appendZenithRenewalRows_(spreadsheet, membershipRows) {
  const renewalSheetNames = [
  "Renewals 1M",
  "Renewals 3M",
  "Renewals 6M",
  "Renewals 1Y"
];

  renewalSheetNames.forEach(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() < 2) {
      return;
    }

    const rowCount = sheet.getLastRow() - 1;

    // Renewal sheets contain 16 columns.
    const values = sheet
      .getRange(2, 1, rowCount, 16)
      .getValues();

    values.forEach(function (row, index) {
      const completelyBlank = row.every(function (value) {
        return (
          value === "" ||
          value === null ||
          typeof value === "undefined"
        );
      });

      if (completelyBlank) {
        return;
      }

      membershipRows.push({
        sourceSheet: sheetName,
        sourceRow: index + 2,

        // Renewal sheet mapping
        admissionId: serializeZenithSheetValue_(row[0]),
        name: serializeZenithSheetValue_(row[1]),
        mobile: serializeZenithSheetValue_(row[2]),
        plan: serializeZenithSheetValue_(row[3]),
        startDate: serializeZenithSheetValue_(row[4]),
        endDate: serializeZenithSheetValue_(row[5]),
        totalAmount: serializeZenithSheetValue_(row[6]),
        discount: serializeZenithSheetValue_(row[7]),
        finalAmount: serializeZenithSheetValue_(row[8]),
        paymentMode: serializeZenithSheetValue_(row[9]),
        timestamp: serializeZenithSheetValue_(row[10]),
        whatsappMessage: serializeZenithSheetValue_(row[11]),
        paymentStatus: serializeZenithSheetValue_(row[12]),
        remarks: serializeZenithSheetValue_(row[13]),
        amountPaid: serializeZenithSheetValue_(row[14]),
        pendingAmount: serializeZenithSheetValue_(row[15]),

        // These profile fields do not exist in renewal sheets.
        // Null values will not overwrite existing member information.
        gender: null,
        age: null,
        category: "Renewal",
        birthDate: null,
        address: null,
        medicalHistory: null
      });
    });
  });
}

/**
 * Converts Apps Script Date objects into JSON-safe ISO values.
 * Other cell values are returned unchanged.
 */
function serializeZenithSheetValue_(value) {
  const isValidDate =
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime());

  if (isValidDate) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd'T'HH:mm:ssXXX"
    );
  }

  return value;
}
/* =========================================================
   CASHBOOK
========================================================= */

function getOrCreateDailyCashbook_(ss) {
  return getOrCreateSheet_(ss, "Daily_Cashbook", [
    "Date",
    "Remark",
    "Transaction Type",
    "Amount Paid",
    "Mode of Payment"
  ]);
}

function inferMembershipTypeFrom_(category, admissionId) {
  const c = String(category || "").trim().toLowerCase();
  if (c.includes("personal")) return "Personal Training";
  if (c.includes("happy")) return "Happy Hours";
  if (c.includes("regular")) return "Regular";

  const id = String(admissionId || "").trim().toUpperCase();
  if (id.startsWith("PT-")) return "Personal Training";
  if (id.startsWith("HH-")) return "Happy Hours";
  return "Regular";
}

function appendCashbookEntry_(ss, dateObj, remark, txnType, amountPaid, mode) {
  const sh = getOrCreateDailyCashbook_(ss);
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 5).setValues([[
    parseDateForSheet_(dateObj || new Date()),
    String(remark || ""),
    String(txnType || ""),
    Number(amountPaid) || 0,
    String(mode || "")
  ]]);
}

/* =========================================================
   END OF DAY REPORT
========================================================= */


function rebuildTodayEndOfDayReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const today = new Date();
  const todayKey = Utilities.formatDate(today, tz, "yyyy-MM-dd");

  const reportSheet = getOrCreateSheet_(ss, "End Of Day Report", [
    "Date",
    "Enquiries",
    "New Admissions",
    "Renewals",
    "Cash Collected",
    "Online Collected",
    "Total Collected",
    "Last Updated"
  ]);

  const enquiryCount = countTodayEnquiries_(ss, todayKey, tz);
  const admissionCount = countTodayAdmissions_(ss, todayKey, tz);
  const renewalCount = countTodayRenewals_(ss, todayKey, tz);
  const totals = getTodayCollectionTotals_(ss, todayKey, tz);

  const lastRow = reportSheet.getLastRow();
  let existingRow = -1;

  if (lastRow >= 2) {
    const dates = reportSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (formatAnyDateToKey_(dates[i][0], tz) === todayKey) {
        existingRow = i + 2;
        break;
      }
    }
  }

  const rowData = [
    parseDateForSheet_(today),
    enquiryCount,
    admissionCount,
    renewalCount,
    totals.cash,
    totals.online,
    totals.total,
    parseDateForSheet_(new Date())
  ];

  if (existingRow > -1) {
    reportSheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    reportSheet.appendRow(rowData);
    existingRow = reportSheet.getLastRow();
  }

  reportSheet.getRange(existingRow, 1).setNumberFormat("dd-MM-yyyy");
  reportSheet.getRange(existingRow, 8).setNumberFormat("dd-MM-yyyy");
}

function countTodayEnquiries_(ss, todayKey, tz) {
  const sh = ss.getSheetByName("Enquiries");
  if (!sh || sh.getLastRow() < 2) return 0;

  const data = sh.getDataRange().getValues();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const timestamp = data[i][8];
    const rowType = String(data[i][0] || "").trim();

    if (rowType && !String(rowType).includes("-") && data[i][1] === "" && data[i][2] === "") {
      continue;
    }

    if (formatAnyDateToKey_(timestamp, tz) === todayKey) count++;
  }

  return count;
}

function countTodayAdmissions_(ss, todayKey, tz) {
  const sheets = ["1 Month", "3 Months", "6 Months", "1 Year"];
  let count = 0;

  sheets.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;

    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const timestamp = data[i][15];
      if (formatAnyDateToKey_(timestamp, tz) === todayKey) count++;
    }
  });

  return count;
}

function countTodayRenewals_(ss, todayKey, tz) {
  const sheets = ["Renewals 1M", "Renewals 3M", "Renewals 6M", "Renewals 1Y"];
  let count = 0;

  sheets.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;

    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const timestamp = data[i][10];
      if (formatAnyDateToKey_(timestamp, tz) === todayKey) count++;
    }
  });

  return count;
}

function getTodayCollectionTotals_(ss, todayKey, tz) {
  const sh = ss.getSheetByName("Daily_Cashbook");
  if (!sh || sh.getLastRow() < 2) {
    return { cash: 0, online: 0, total: 0 };
  }

  const data = sh.getDataRange().getValues();
  let cash = 0;
  let online = 0;

  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][0];
    const amount = Number(data[i][3]) || 0;
    const mode = String(data[i][4] || "").trim().toLowerCase();

    if (formatAnyDateToKey_(dateVal, tz) !== todayKey) continue;

    if (mode.includes("cash")) cash += amount;
    else online += amount;
  }

  return {
    cash: cash,
    online: online,
    total: cash + online
  };
}

function formatAnyDateToKey_(value, tz) {
  const d = parseDateSafe_(value);
  if (!d) return "";
  return Utilities.formatDate(d, tz, "yyyy-MM-dd");
}

/* =========================================================
   RENEWALS LIST
========================================================= */

function updateRenewalsList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sourceSheets = [
    { name: "1 Month", endDateCol: 8, mobileCol: 2 },
    { name: "3 Months", endDateCol: 8, mobileCol: 2 },
    { name: "6 Months", endDateCol: 8, mobileCol: 2 },
    { name: "1 Year", endDateCol: 8, mobileCol: 2 },

    { name: "Renewals 1M", endDateCol: 5, mobileCol: 2 },
    { name: "Renewals 3M", endDateCol: 5, mobileCol: 2 },
    { name: "Renewals 6M", endDateCol: 5, mobileCol: 2 },
    { name: "Renewals 1Y", endDateCol: 5, mobileCol: 2 }
  ];

  const renewalsSheet = getOrCreateSheet_(ss, "Renewals List", [
  "Admission ID",
  "Name",
  "End Date",
  "Renewal Message",
  "Feedback Message"
]);

  const historySheet = getOrCreateSheet_(ss, "Renewals List History", [
  "Admission ID",
  "Name",
  "End Date",
  "Renewal Message",
  "Feedback Message"
]);

  renewalsSheet.clearContents().clearFormats();
  historySheet.clearContents().clearFormats();

  renewalsSheet.appendRow([
  "Admission ID",
  "Name",
  "End Date",
  "Renewal Message",
  "Feedback Message"
]);

  historySheet.appendRow([
  "Admission ID",
  "Name",
  "End Date",
  "Renewal Message",
  "Feedback Message"
]);

  styleHeaderRow_(renewalsSheet, 5);
  styleHeaderRow_(historySheet, 5);

  const latestExpiryMap = new Map();
  const fullHistory = [];

  sourceSheets.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.name);
    if (!sheet || sheet.getLastRow() < 2) return;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const admissionId = String(data[i][0] || "").trim();
      const name = data[i][1] || "";
      const mobile = normalizePhoneForStorage_(data[i][cfg.mobileCol]);
      const end = parseDateSafe_(data[i][cfg.endDateCol]);

      if (!admissionId || !end) continue;

      fullHistory.push({
        admissionId,
        name,
        mobile,
        endDate: end
      });

      if (
        !latestExpiryMap.has(admissionId) ||
        latestExpiryMap.get(admissionId).endDate < end
      ) {
        latestExpiryMap.set(admissionId, {
          name: name,
          mobile: mobile,
          endDate: end
        });
      }
    }
  });

  const latestSorted = [...latestExpiryMap.entries()]
    .sort((a, b) => a[1].endDate - b[1].endDate);

  const historySorted = fullHistory
    .sort((a, b) => a.endDate - b.endDate)
    .map(v => [v.admissionId, v]);

  writeMonthWise_(renewalsSheet, latestSorted);
  writeMonthWise_(historySheet, historySorted);
}

function writeMonthWise_(sheet, data) {
  if (!data || !data.length) return;

  const tz = Session.getScriptTimeZone();
  let lastMonth = "";
  const rows = [];
  const monthHeaderRows = [];

  data.forEach(([admissionId, info]) => {
    const endDateObj = parseDateSafe_(info.endDate);
    if (!endDateObj) return;

    const monthKey = Utilities.formatDate(endDateObj, tz, "MMMM yyyy").toUpperCase();

    if (monthKey !== lastMonth) {
      rows.push([monthKey, "", "", "", ""]);
      monthHeaderRows.push(rows.length);
      lastMonth = monthKey;
    }

    const formattedEndDate = Utilities.formatDate(endDateObj, tz, "dd-MM-yyyy");

    const message =
      `Hello ${info.name},\n\n` +
      `This is a gentle reminder that your membership at Zenith Fitness will expire on ${formattedEndDate}.\n\n` +
      `We look forward to continuing your fitness journey with us 💪\n\n` +
      `You may renew conveniently via UPI / GPay on 📞 9272112745.\n\n` +
      `Stay consistent. Stay strong. 🔥`;


    const formattedPhone = normalizePhoneForStorage_(info.mobile);

    const feedbackMessage =
  `Hello ${info.name},\n\n` +
  `We noticed that your membership at Zenith Fitness has expired and has not yet been renewed.\n\n` +
  `Your feedback is extremely valuable to us and helps us improve our services and member experience.\n\n` +
  `Could you please let us know the primary reason for not renewing your membership?\n\n` +
  `1️⃣ Shifted Location\n` +
  `2️⃣ Busy Schedule / No Time\n` +
  `3️⃣ Trainer Guidance Issues\n` +
  `4️⃣ Not Satisfied with Facilities & Services\n` +
  `5️⃣ Joined Another Gym\n` +
  `6️⃣ Health / Medical Reasons\n` +
  `7️⃣ Financial / Budget Constraints\n` +
  `8️⃣ Achieved Fitness Goals\n` +
  `9️⃣ Irregular Attendance\n` +
  `🔟 Other (Please Specify)\n\n` +
  `Your response will help us better understand our members' needs and continue improving Zenith Fitness.\n\n` +
  `We sincerely appreciate your time and feedback and hope to welcome you back in the future.\n\n` +
  `Thank you.\n\n` +
  `Team Zenith Fitness 💪`;

    const whatsappLink = formattedPhone
      ? `=HYPERLINK("https://wa.me/91${formattedPhone}?text=${encodeURIComponent(message)}","Send WhatsApp")`
      : "";

    const feedbackWhatsappLink = formattedPhone
  ? `=HYPERLINK("https://wa.me/91${formattedPhone}?text=${encodeURIComponent(feedbackMessage)}","Send Feedback Message")`
  : "";

    rows.push([
  admissionId,
  info.name || "",
  endDateObj,
  whatsappLink,
  feedbackWhatsappLink
]);
  });



  if (!rows.length) return;

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 5).setValues(rows);

  for (let i = 0; i < rows.length; i++) {
    const absoluteRow = startRow + i;
    const rowVal = rows[i][0];

    if (rowVal && String(rowVal).includes("-")) {
      sheet.getRange(absoluteRow, 3).setNumberFormat("dd-MM-yyyy");
    }
  }

  monthHeaderRows.forEach(relativeRow => {
  const absoluteRow = startRow + relativeRow - 1;

  sheet.getRange(absoluteRow, 1, 1, 5).merge()
    .setBackground("#1F2937")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
});
}


/* =========================================================
   PENDING AMOUNTS
========================================================= */

function forceRebuildPendingAmountsNow() {
  updatePendingAmountsList_();
  return "Pending Amounts rebuilt successfully.";
}

function getOrCreatePendingAmountsSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, "Pending Amounts", [
    "Admission ID",
    "Name",
    "Mobile",
    "Plan",
    "End Date",
    "Amount Paid",
    "Pending Amount",
    "Payment Status",
    "Reminder Message"
  ]);

  if (sheet.getLastRow() < 1) {
    sheet.appendRow([
      "Admission ID",
      "Name",
      "Mobile",
      "Plan",
      "End Date",
      "Amount Paid",
      "Pending Amount",
      "Payment Status",
      "Reminder Message"
    ]);
    styleHeaderRow_(sheet, 9);
  }

  return sheet;
}

function upsertPendingAmountEntry_(ss, member) {
  if (!member || !member.admissionId) return;

  const sheet = getOrCreatePendingAmountsSheet_(ss);
  const pendingAmount = Number(member.pendingAmount) || 0;
  const row = findPendingAmountRow_(sheet, member.admissionId);

  if (pendingAmount <= 0) {
    if (row > 1) sheet.deleteRow(row);
    return;
  }

  clearPendingEmptyMessage_(sheet);

  const rowData = buildPendingAmountRow_(member);
  const targetRow = row > 1 ? row : sheet.getLastRow() + 1;

  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  sheet.getRange(targetRow, 5).setNumberFormat("dd-MM-yyyy");
}

function findPendingAmountRow_(sheet, admissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const finder = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(admissionId || "").trim())
    .matchEntireCell(true)
    .findNext();

  return finder ? finder.getRow() : -1;
}

function clearPendingEmptyMessage_(sheet) {
  if (sheet.getLastRow() !== 2) return;

  const firstCell = String(sheet.getRange(2, 1).getValue() || "").trim().toLowerCase();
  if (firstCell !== "no pending amounts") return;

  try { sheet.getRange(2, 1, 1, 9).breakApart(); } catch (_) {}
  sheet.getRange(2, 1, 1, 9).clearContent().clearFormat();
  sheet.deleteRow(2);
}

function buildPendingAmountRow_(member) {
  const reminderMessage = createPendingAmountReminderMessage_(member);
  const whatsappLink = member.mobile
    ? createWhatsAppLink_(member.mobile, reminderMessage, "Send Reminder")
    : "";

  return [
    member.admissionId,
    member.name || "",
    normalizePhoneForStorage_(member.mobile),
    member.plan || "",
    parseDateForSheet_(member.endDate),
    Number(member.amountPaid) || 0,
    Number(member.pendingAmount) || 0,
    member.paymentStatus || inferPaymentStatus_(member.amountPaid, member.pendingAmount),
    whatsappLink
  ];
}

function updatePendingAmountsList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreatePendingAmountsSheet_(ss);

  try { sheet.getDataRange().breakApart(); } catch (_) {}
  sheet.clearContents();
  sheet.appendRow([
    "Admission ID",
    "Name",
    "Mobile",
    "Plan",
    "End Date",
    "Amount Paid",
    "Pending Amount",
    "Payment Status",
    "Reminder Message"
  ]);
  styleHeaderRow_(sheet, 9);

  const latestMap = new Map();
  const configs = getMemberSourceConfigs_();

  configs.forEach(cfg => {
    const source = ss.getSheetByName(cfg.name);
    if (!source || source.getLastRow() < 2) return;

    const data = source.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const admissionId = String(data[i][cfg.idCol] || "").trim();
      if (!admissionId) continue;

      const endDate = parseDateSafe_(data[i][cfg.endDateCol]);
      if (!endDate) continue;

      const existing = latestMap.get(admissionId);
      if (existing && existing.endDate >= endDate) continue;

      const record = {
        sheet: source,
        row: i + 1,
        values: data[i],
        cfg: cfg,
        admissionId: admissionId,
        mobile: normalizePendingMobileFromRow_(data[i], cfg.mobileCol),
        name: data[i][cfg.nameCol] || ""
      };

      const payment = getPaymentSnapshotForRecord_(record);

      latestMap.set(admissionId, {
        admissionId: admissionId,
        name: record.name,
        mobile: record.mobile,
        plan: normalizePlanForPending_(data[i][cfg.planCol], cfg.name),
        endDate: endDate,
        amountPaid: payment.amountPaid,
        pendingAmount: payment.pendingAmount,
        paymentStatus: payment.paymentStatus || inferPaymentStatus_(payment.amountPaid, payment.pendingAmount),
        sourceSheet: cfg.name
      });
    }
  });

  const rows = [...latestMap.values()]
    .filter(member => Number(member.pendingAmount) > 0)
    .sort((a, b) => b.pendingAmount - a.pendingAmount || a.name.localeCompare(b.name))
    .map(member => {
      const reminderMessage = createPendingAmountReminderMessage_(member);
      const whatsappLink = member.mobile
        ? createWhatsAppLink_(member.mobile, reminderMessage, "Send Reminder")
        : "";

      return [
        member.admissionId,
        member.name,
        member.mobile,
        member.plan,
        member.endDate,
        Number(member.amountPaid) || 0,
        Number(member.pendingAmount) || 0,
        member.paymentStatus,
        whatsappLink
      ];
    });

  if (!rows.length) {
    sheet.appendRow(["No pending amounts", "", "", "", "", "", "", "", ""]);
    sheet.getRange(2, 1, 1, 9)
      .merge()
      .setHorizontalAlignment("center")
      .setFontWeight("bold")
      .setFontColor("#067647");
    return;
  }

  sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).setNumberFormat("dd-MM-yyyy");
}

function inferPaymentStatus_(amountPaid, pendingAmount) {
  const paid = Number(amountPaid) || 0;
  const pending = Number(pendingAmount) || 0;

  if (pending <= 0 && paid > 0) return "Paid";
  if (paid > 0 && pending > 0) return "Partial";
  return "Pending";
}

function createPendingAmountReminderMessage_(member) {
  return `Hello ${member.name || ""},\n\n` +
    `This is a gentle reminder from Zenith Fitness.\n\n` +
    `Admission ID: ${member.admissionId || ""}\n` +
    `Plan: ${member.plan || ""}\n` +
    `Pending Amount: Rs. ${Number(member.pendingAmount) || 0}\n\n` +
    `Kindly clear your pending amount at your earliest convenience.\n\n` +
    `You may pay via UPI / GPay on 9272112745.\n\n` +
    `Thank you,\n` +
    `Team Zenith Fitness`;
}

/* =========================================================
   STYLING / MANUAL UTILS
========================================================= */

function styleHeaderRow_(sheet, lastCol) {
  sheet.getRange(1, 1, 1, lastCol)
    .setBackground("#1F2937")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}


function rebuildEverythingNow() {
  const props = PropertiesService.getScriptProperties();

  props.setProperty("REBUILD_EOD_PENDING", "1");
  props.setProperty("REBUILD_RENEWALS_PENDING", "1");
  props.setProperty("REBUILD_PENDING_AMOUNTS_PENDING", "1");

  return "Full rebuild queued successfully.";
}

function handleMemberUpdateAction_(action, data, ss) {
  if (action === "updatePendingPayment") {
    return updatePendingPayment_(data, ss);
  }

  if (action === "changeMembershipPackage") {
    return changeMembershipPackage_(data, ss);
  }

  return null;
}

function updatePendingPayment_(data, ss) {
  const lock = LockService.getDocumentLock();

  try {
    if (!lock.tryLock(10000)) {
      return json_({ success: false, message: "System is busy. Please try again." });
    }

    const record = findLatestMemberRecord_(
      ss,
      normalizePhoneForStorage_(data.mobile),
      String(data.admissionId || "").trim()
    );

    if (!record) return json_({ success: false, message: "Member not found" });

    const amountReceived = Math.max(Number(data.amountPaid) || 0, 0);
    if (amountReceived <= 0) {
      return json_({ success: false, message: "Amount received must be greater than 0" });
    }

    const snapshot = getPaymentSnapshotForRecord_(record);
    if (snapshot.pendingAmount <= 0) {
      return json_({ success: false, message: "This membership has no pending amount." });
    }

    if (amountReceived > snapshot.pendingAmount) {
      return json_({
        success: false,
        message: "Amount received cannot exceed pending amount of Rs. " + snapshot.pendingAmount
      });
    }

    const newPaidAmount = snapshot.amountPaid + amountReceived;
    const newPendingAmount = Math.max(snapshot.finalAmount - newPaidAmount, 0);
    const newStatus = newPendingAmount <= 0 ? "Paid" : "Partial";

    const cfg = record.cfg;
    record.sheet.getRange(record.row, cfg.paymentStatusCol + 1).setValue(newStatus);
    record.sheet.getRange(record.row, cfg.amountPaidCol + 1).setValue(newPaidAmount);
    record.sheet.getRange(record.row, cfg.pendingAmountCol + 1).setValue(newPendingAmount);

    const remarks = String(data.remarks || "").trim();
    if (remarks && typeof cfg.remarksCol === "number") {
      const cell = record.sheet.getRange(record.row, cfg.remarksCol + 1);
      const oldRemarks = String(cell.getValue() || "").trim();
      cell.setValue(oldRemarks ? `${oldRemarks}
Payment update: ${remarks}` : `Payment update: ${remarks}`);
    }

    appendCashbookEntry_(
      ss,
      new Date(),
      `Pending Payment - ${record.name} (${record.admissionId})`,
      "Pending Payment",
      amountReceived,
      data.paymentMode
    );

    // Keep Pending Amounts immediately correct for this explicit payment action.
    upsertPendingAmountEntry_(ss, {
      admissionId: record.admissionId,
      name: record.name,
      mobile: record.mobile,
      plan: record.values[cfg.planCol] || "",
      endDate: record.values[cfg.endDateCol] || "",
      amountPaid: newPaidAmount,
      pendingAmount: newPendingAmount,
      paymentStatus: newStatus
    });

    // Full views/reports are deferred.
    enqueuePostProcess_();

    return json_({
      success: true,
      message: "Payment updated successfully",
      amountPaid: newPaidAmount,
      pendingAmount: newPendingAmount,
      paymentStatus: newStatus
    });

  } catch (err) {
    return json_({ success: false, message: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function changeMembershipPackage_(data, ss) {
  const lock = LockService.getDocumentLock();

  try {
    lock.waitLock(30000);

    const record = findLatestMemberRecord_(
      ss,
      normalizePhoneForStorage_(data.mobile),
      String(data.admissionId || "").trim()
    );

    if (!record) {
      return json_({ success: false, message: "Member not found" });
    }

    const planInfo = getPlanInfo_(data.plan);
    if (!planInfo) {
      return json_({ success: false, message: "Invalid plan" });
    }

    const startDate = parseDateForSheet_(data.startDate);
    const endDate = parseDateForSheet_(data.endDate);

    if (!startDate || !endDate) {
      return json_({ success: false, message: "Start date and end date are required" });
    }

    const oldPlan = record.sheet.getRange(record.row, record.cfg.planCol + 1).getValue();
    const oldStartDate = record.sheet.getRange(record.row, record.cfg.startDateCol + 1).getValue();
    const oldEndDate = record.sheet.getRange(record.row, record.cfg.endDateCol + 1).getValue();

    record.sheet.getRange(record.row, record.cfg.planCol + 1).setValue(planInfo.label);
    record.sheet.getRange(record.row, record.cfg.startDateCol + 1).setValue(startDate);
    record.sheet.getRange(record.row, record.cfg.endDateCol + 1).setValue(endDate);
    record.sheet.getRange(record.row, record.cfg.startDateCol + 1).setNumberFormat("dd-MM-yyyy");
    record.sheet.getRange(record.row, record.cfg.endDateCol + 1).setNumberFormat("dd-MM-yyyy");

    const cols = ensureMemberPaymentColumns_(record.sheet);
    const remarks = String(data.remarks || "").trim();
    if (remarks) {
      const oldRemarks = String(record.sheet.getRange(record.row, cols.remarks).getValue() || "").trim();
      const nextRemarks = oldRemarks ? `${oldRemarks}\nPackage update: ${remarks}` : `Package update: ${remarks}`;
      record.sheet.getRange(record.row, cols.remarks).setValue(nextRemarks);
    }

    appendMemberUpdateLog_(ss, [
      parseDateForSheet_(new Date()),
      record.admissionId,
      record.name,
      "Package Update",
      oldPlan,
      planInfo.label,
      formatDateDDMMYYYY_(oldStartDate),
      formatDateDDMMYYYY_(startDate),
      formatDateDDMMYYYY_(oldEndDate),
      formatDateDDMMYYYY_(endDate),
      remarks
    ]);

    enqueuePostProcess_();
    enqueueEndOfDayRebuild_();

    return json_({ success: true, message: "Package updated successfully" });

  } catch (err) {
    return json_({ success: false, message: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function findLatestMemberRecord_(ss, mobile, admissionId) {
  const configs = getMemberSourceConfigs_();
  let latest = null;
  let latestEndDate = null;

  configs.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.name);
    if (!sheet || sheet.getLastRow() < 2) return;

    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {
      const rowAdmissionId = String(values[i][cfg.idCol] || "").trim();
      const rowMobile = normalizePhoneForStorage_(values[i][cfg.mobileCol]);

      const matched =
        (mobile && rowMobile === mobile) ||
        (admissionId && rowAdmissionId === admissionId);

      if (!matched) continue;

      const endDate = parseDateSafe_(values[i][cfg.endDateCol]);
      if (!endDate) continue;

      if (!latestEndDate || endDate > latestEndDate) {
        latestEndDate = endDate;
        latest = {
          sheet,
          row: i + 1,
          values: values[i],
          cfg,
          admissionId: rowAdmissionId,
          mobile: rowMobile,
          name: values[i][cfg.nameCol] || ""
        };
      }
    }
  });

  return latest;
}

function ensureMemberPaymentColumns_(sheet) {
  return {
    paymentStatus: ensureHeaderColumn_(sheet, "Payment Status"),
    remarks: ensureHeaderColumn_(sheet, "Remarks"),
    amountPaid: ensureHeaderColumn_(sheet, "Amount Paid"),
    pendingAmount: ensureHeaderColumn_(sheet, "Pending Amount")
  };
}

function getPaymentSnapshotForRecord_(record) {
  const v = record.values || [];
  const cfg = record.cfg || {};

  const finalAmount = readNumericByIndex_(v, cfg.finalAmountCol);
  const rawPaid = readRawByIndex_(v, cfg.amountPaidCol);
  const rawPending = readRawByIndex_(v, cfg.pendingAmountCol);
  const rawStatus = String(readRawByIndex_(v, cfg.paymentStatusCol) || "").trim();

  const paidBlank = isBlankCell_(rawPaid);
  const pendingBlank = isBlankCell_(rawPending);
  const status = rawStatus.toLowerCase();

  // IMPORTANT FOR OLD DATA:
  // If old rows have no payment information at all, DO NOT assume
  // that the full package amount is pending.
  if (paidBlank && pendingBlank && !status) {
    return {
      finalAmount: finalAmount,
      amountPaid: 0,
      pendingAmount: 0,
      paymentStatus: ""
    };
  }

  // Explicit Amount Paid is the strongest source when available.
  if (!paidBlank) {
    let amountPaid = Math.max(Number(rawPaid) || 0, 0);
    if (finalAmount > 0) amountPaid = Math.min(amountPaid, finalAmount);

    const pendingAmount = finalAmount > 0
      ? Math.max(finalAmount - amountPaid, 0)
      : (!pendingBlank ? Math.max(Number(rawPending) || 0, 0) : 0);

    return {
      finalAmount: finalAmount,
      amountPaid: amountPaid,
      pendingAmount: pendingAmount,
      paymentStatus: pendingAmount <= 0 ? "Paid" : amountPaid > 0 ? "Partial" : "Pending"
    };
  }

  // If Amount Paid is blank but an old Pending Amount exists,
  // preserve that historical value and derive Amount Paid from it.
  if (!pendingBlank) {
    let pendingAmount = Math.max(Number(rawPending) || 0, 0);
    if (finalAmount > 0) pendingAmount = Math.min(pendingAmount, finalAmount);

    const amountPaid = finalAmount > 0
      ? Math.max(finalAmount - pendingAmount, 0)
      : 0;

    return {
      finalAmount: finalAmount,
      amountPaid: amountPaid,
      pendingAmount: pendingAmount,
      paymentStatus: pendingAmount <= 0 ? "Paid" : amountPaid > 0 ? "Partial" : "Pending"
    };
  }

  // Legacy rows containing only Payment Status.
  if (status === "paid") {
    return {
      finalAmount: finalAmount,
      amountPaid: finalAmount,
      pendingAmount: 0,
      paymentStatus: "Paid"
    };
  }

  if (status === "pending") {
    return {
      finalAmount: finalAmount,
      amountPaid: 0,
      pendingAmount: finalAmount,
      paymentStatus: "Pending"
    };
  }

  // A legacy "Partial" row without either amount cannot be calculated safely.
  // Do not invent a pending value.
  if (status === "partial") {
    return {
      finalAmount: finalAmount,
      amountPaid: 0,
      pendingAmount: 0,
      paymentStatus: "Partial"
    };
  }

  return {
    finalAmount: finalAmount,
    amountPaid: 0,
    pendingAmount: 0,
    paymentStatus: ""
  };
}

function readRawByIndex_(row, index) {
  return (typeof index === "number" && index >= 0 && index < row.length)
    ? row[index]
    : "";
}

function readNumericByIndex_(row, index) {
  const value = readRawByIndex_(row, index);
  return Math.max(Number(value) || 0, 0);
}

function isBlankCell_(value) {
  return value === "" || value === null || value === undefined;
}

function normalizePlanForPending_(value, sourceSheetName) {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase();

  const map = {
    "30": "1 Month",
    "1 month": "1 Month",
    "1m": "1 Month",
    "90": "3 Months",
    "3 months": "3 Months",
    "3 month": "3 Months",
    "3m": "3 Months",
    "180": "6 Months",
    "6 months": "6 Months",
    "6 month": "6 Months",
    "6m": "6 Months",
    "365": "1 Year",
    "1 year": "1 Year",
    "1y": "1 Year",
    "custom": "Customize Package",
    "customize package": "Customize Package"
  };

  if (map[key]) return map[key];

  const sheetName = String(sourceSheetName || "").toLowerCase();
  if (!raw) {
    if (sheetName.includes("1m")) return "1 Month";
    if (sheetName.includes("3m")) return "3 Months";
    if (sheetName.includes("6m")) return "6 Months";
    if (sheetName.includes("1y")) return "1 Year";
  }

  return raw;
}

function normalizePendingMobileFromRow_(row, configuredIndex) {
  const configured = normalizePhoneForStorage_(readRawByIndex_(row, configuredIndex));
  if (/^[6-9]\d{9}$/.test(configured)) return configured;

  // Historical rows may have been written with an older column order.
  // Find the most plausible Indian 10-digit mobile anywhere in the row.
  for (let i = 0; i < row.length; i++) {
    const phone = normalizePhoneForStorage_(row[i]);
    if (/^[6-9]\d{9}$/.test(phone)) return phone;
  }

  return "";
}

function getHeaderColumn_(sheet, headerName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return 0;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h || "").trim().toLowerCase());

  const index = headers.indexOf(String(headerName || "").trim().toLowerCase());
  return index === -1 ? 0 : index + 1;
}

function ensureHeaderColumn_(sheet, headerName) {
  const existing = getHeaderColumn_(sheet, headerName);
  if (existing) return existing;

  const nextCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, nextCol).setValue(headerName);
  sheet.getRange(1, nextCol)
    .setBackground("#1F2937")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  return nextCol;
}

function getPlanInfo_(rawPlan) {
  const planMap = {
    "30": "1 Month",
    "90": "3 Months",
    "180": "6 Months",
    "365": "1 Year",
    "custom": "Customize Package"
  };

  const key = String(rawPlan || "").trim().toLowerCase();
  const label = planMap[key];

  return label ? { key, label } : null;
}

function appendMemberUpdateLog_(ss, row) {
  const sh = getOrCreateSheet_(ss, "Member Updates Log", [
    "Timestamp",
    "Admission ID",
    "Name",
    "Update Type",
    "Old Value 1",
    "New Value 1",
    "Old Value 2",
    "New Value 2",
    "Old Value 3 / Amount",
    "New Value 3 / Mode",
    "Remarks"
  ]);

  sh.appendRow(row);
  const lastRow = sh.getLastRow();
  sh.getRange(lastRow, 1).setNumberFormat("dd-MM-yyyy");
}
