const {HEADERS,projectFallback}=require('./fallbackProjection');
function cell(value){return {userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}};}
async function writeFallback({sheets,spreadsheetId,snapshot}){
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(spreadsheetId||''))throw new Error('Set FALLBACK_SPREADSHEET_ID to the NEW six-sheet workbook.');
  const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties'});
  const tabs=metadata.data.sheets.map(s=>s.properties);const names=Object.keys(HEADERS);
  if(tabs.length!==6||names.some(name=>!tabs.some(t=>t.title===name)))throw new Error('Fallback workbook must contain exactly the six expected tabs. Existing tabs were not changed.');
  const check=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges:[...names.map(n=>`'${n}'!A1:L1`),"'System Control'!A2:B6"]});
  for(let i=0;i<names.length;i++){const actual=check.data.valueRanges[i]?.values?.[0]||[];if(JSON.stringify(actual)!==JSON.stringify(HEADERS[names[i]]))throw new Error('Header mismatch in '+names[i]+'. No data was changed.');}
  const control=Object.fromEntries(check.data.valueRanges[6]?.values||[]);
  if(control.GymID!==snapshot.gym_id||control.SchemaVersion!=='zenith-fallback-v1')throw new Error('Workbook ownership/schema marker does not match this gym.');
  const projection=projectFallback(snapshot);const requests=[];
  for(const [name,rows] of Object.entries(projection)){
    const tab=tabs.find(t=>t.title===name),rowCount=Math.max(tab.gridProperties.rowCount,rows.length+10),columnCount=Math.max(tab.gridProperties.columnCount,HEADERS[name].length);
    if(rowCount!==tab.gridProperties.rowCount||columnCount!==tab.gridProperties.columnCount)requests.push({updateSheetProperties:{properties:{sheetId:tab.sheetId,gridProperties:{rowCount,columnCount}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
    requests.push({updateCells:{range:{sheetId:tab.sheetId,startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:HEADERS[name].length},rows:rows.map(row=>({values:row.map(cell)})),fields:'userEnteredValue'}});
    if(name!=='System Control')requests.push({setBasicFilter:{filter:{range:{sheetId:tab.sheetId,startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:HEADERS[name].length}}}});
  }
  if(Buffer.byteLength(JSON.stringify(requests))>10*1024*1024)throw new Error('Fallback snapshot exceeds the single-batch size limit. No data was changed.');
  // A single atomic batch replaces projections. Retrying never appends duplicates.
  // Explicit stringValue prevents names/phones from being executed as formulas.
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}},{timeout:60000});
  return {sheets:6,rows:Object.fromEntries(Object.entries(projection).map(([name,rows])=>[name,rows.length-1])),lastAdmissionID:projection['System Control'][1][1]};
}
function googleSheetsClient(){const {google}=require('googleapis');const path=require('node:path');const auth=new google.auth.GoogleAuth({keyFile:process.env.GOOGLE_CREDENTIALS_FILE||path.join(__dirname,'credentials.json'),scopes:['https://www.googleapis.com/auth/spreadsheets']});return google.sheets({version:'v4',auth});}
module.exports={writeFallback,googleSheetsClient,cell};
