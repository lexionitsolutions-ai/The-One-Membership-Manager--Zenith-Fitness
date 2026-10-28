/** Run createZenithFallbackWorkbook once from a standalone Apps Script project.
 * Creates a NEW workbook. Does not modify the old workbook, assign IDs, or write
 * to Supabase/the fingerprint device. Re-running reopens the created workbook.
 */
function createZenithFallbackWorkbook() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('ZENITH_FALLBACK_SPREADSHEET_ID');
  if (existing && props.getProperty('ZENITH_FALLBACK_SETUP_COMPLETE') === '1') { console.log('Already created: https://docs.google.com/spreadsheets/d/' + existing); return existing; }
  var ss = existing ? SpreadsheetApp.openById(existing) : SpreadsheetApp.create('Zenith Fitness - Fallback');
  props.setProperty('ZENITH_FALLBACK_SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  var definitions = [
    ['Admissions', ['ID','NAME','CNUMBER','PLAN','START DATE','END DATE','AMOUNT PAID','PENDING AMOUNT','PAYMENT MODE','PAYMENT STATUS','WHATSAPP MESSAGE','LINK']],
    ['Renewals', ['ID','NAME','CNUMBER','PLAN','START DATE','END DATE','AMOUNT PAID','PENDING AMOUNT','PAYMENT MODE','PAYMENT STATUS','WHATSAPP MESSAGE','LINK']],
    ['Database', ['ID','NAME','END DATE']],
    ['System Control', ['SETTING','VALUE']],
    ['Daily Cash Book', ['DATE','DESCRIPTION','TRANSACTION TYPE','AMOUNT','PAYMENT MODE']],
    ['Renewal List', ['ID','NAME','END DATE']]
  ];
  definitions.forEach(function(def, i) {
    var sh = ss.getSheetByName(def[0]);
    if (!sh && i === 0 && ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0) sh = ss.getSheets()[0].setName(def[0]);
    if (!sh) sh = ss.insertSheet(def[0]);
    var n = def[1].length;
    sh.getRange(1,1,1,n).setValues([def[1]]).setFontWeight('bold').setBackground('#29344c').setFontColor('#f3d89a').setFontSize(11);
    sh.setFrozenRows(1); sh.setRowHeight(1,36); sh.setTabColor('#c8a458');
    sh.getRange(2,1,sh.getMaxRows()-1,n).setNumberFormat('@').setFontFamily('Arial').setFontSize(11);
    sh.setColumnWidths(1,n,145);
    if (n >= 3) sh.setColumnWidth(2,260);
    if (n === 12) { sh.setColumnWidth(11,350); sh.setColumnWidth(12,260); sh.getRange('G2:H1000').setNumberFormat('#,##0.00'); }
    if (def[0] === 'Daily Cash Book') { sh.setColumnWidth(2,430); sh.getRange('D2:D1000').setNumberFormat('#,##0.00'); }
    if (def[0] !== 'System Control' && !sh.getFilter()) sh.getRange(1,1,sh.getMaxRows(),n).createFilter();
    sh.getRange(1,1).setNote('Read-only fallback from Supabase. Local changes will be replaced on the next sync.');
  });
  if (ss.getSheets().length !== 6) throw new Error('Unexpected extra tabs. No tabs were deleted.');
  if (!ss.getSheetByName('System Control').getRange('A2').getValue()) ss.getSheetByName('System Control').getRange('A2:B6').setValues([
    ['LastAdmissionID',660],['IDAuthority','Supabase'],['LastSuccessfulSync','Not synced yet'],
    ['GymID','b80cd818-2abe-4a90-9027-e2ba1916aec4'],['SchemaVersion','zenith-fallback-v1']
  ]);
  props.setProperty('ZENITH_FALLBACK_SETUP_COMPLETE', '1');
  console.log('Created: ' + ss.getUrl());
  console.log('Spreadsheet ID: ' + ss.getId());
  console.log('Share this NEW workbook as Editor with the service-account email shown in your local dashboard sync settings.');
  return ss.getId();
  } finally { lock.releaseLock(); }
}
