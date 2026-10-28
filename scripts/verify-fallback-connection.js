// Checks the live Google client and writes each existing header back unchanged.
// Does not create test members, alter data rows, or acknowledge Supabase jobs.
const assert=require('node:assert/strict');
const {googleSheetsClient}=require('../gym-access-system/fallbackMirror');
const {HEADERS}=require('../gym-access-system/fallbackProjection');
(async()=>{
 const spreadsheetId=process.env.FALLBACK_SPREADSHEET_ID;
 if(!spreadsheetId)throw new Error('FALLBACK_SPREADSHEET_ID is not configured.');
 const sheets=googleSheetsClient();const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties'});
 const tabs=metadata.data.sheets.map(t=>t.properties),names=Object.keys(HEADERS);assert.equal(tabs.length,6);
 const ranges=names.map(n=>`'${n}'!A1:L1`);
 const before=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges});
 names.forEach((name,i)=>assert.deepEqual(before.data.valueRanges[i].values[0],HEADERS[name]));
 const requests=names.map(name=>({updateCells:{range:{sheetId:tabs.find(t=>t.title===name).sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:HEADERS[name].length},rows:[{values:HEADERS[name].map(v=>({userEnteredValue:{stringValue:v}}))}],fields:'userEnteredValue'}}));
 await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
 const after=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges});
 names.forEach((name,i)=>assert.deepEqual(after.data.valueRanges[i].values[0],HEADERS[name]));
 console.log('PASS: Google read/write access; all six headers preserved; data rows unchanged.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
