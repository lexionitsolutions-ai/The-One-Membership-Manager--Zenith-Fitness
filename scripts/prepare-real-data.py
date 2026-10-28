"""Prepare a private normalized snapshot and a transactional Supabase import.
Does not write any remote database or change the source export.
"""
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'migration-data/preview-2026-10-27'
OUTPUT=ROOT/'migration-data/real-data'
GYM='b80cd818-2abe-4a90-9027-e2ba1916aec4'
spec=importlib.util.spec_from_file_location('preview',ROOT/'scripts/preview-sheets-import.py')
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)
NS=uuid.UUID('60fcdb66-20fe-4a44-a4dd-10001e806c0a')
def uid(key):return str(uuid.uuid5(NS,key))
def numeric_phone(value):
    value=str(value or '').strip()
    if not value:return None
    try:
        n=Decimal(value)
        if n==n.to_integral_value():return str(int(n))
    except InvalidOperation:pass
    return value
def utc(value):
    if not value:return None
    date=dt.datetime.fromisoformat(value)
    if date.tzinfo is None:date=date.replace(tzinfo=dt.timezone(dt.timedelta(hours=5,minutes=30)))
    return date.astimezone(dt.timezone.utc).isoformat()
def sql(value):
    if value is None:return 'null'
    if isinstance(value,bool):return 'true' if value else 'false'
    if isinstance(value,(int,float,Decimal)):return str(value)
    if isinstance(value,dict):return "'"+json.dumps(value,ensure_ascii=False).replace("'","''")+"'::jsonb"
    return "'"+str(value).replace("'","''")+"'"

def prepare():
    archive=json.loads((SOURCE/'workbook-archive.json').read_text(encoding='utf-8'))
    records=json.loads((SOURCE/'membership-preview.json').read_text(encoding='utf-8'))
    summary=json.loads((SOURCE/'summary.json').read_text(encoding='utf-8'))
    grouped={}
    for r in records:
        if r['admission_id']:grouped.setdefault(r['admission_id'],[]).append(r)
    members=[];memberships=[];receipts=[];staging=[];private=[];seen_periods=set()
    plans=[{'id':uid('plan:'+code),'code':code,'name':name,'duration_days':int(code)} for name,code in preview.MAIN.items()]
    plan_by_code={x['code']:x['id'] for x in plans}
    # Use existing plan IDs via SQL remapping during import; snapshot IDs are deterministic.
    for code,group in grouped.items():
        admissions=[r for r in group if r['kind']=='admission']
        base=(admissions or group)[0]
        latest=max(group,key=lambda r:(r['dates'].get('Timestamp') or r['dates'].get('Start Date') or '',r['row']))
        raw=base['data'];phone=numeric_phone(latest['data'].get('Mobile') or raw.get('Mobile'))
        dates=[r['dates'].get('Timestamp') or r['dates'].get('Start Date') for r in group]
        created=min((v for v in dates if v),default=None)
        member={'id':uid('member:'+code),'admission_id':code,'device_user_id':base['device_user_id'],
            'full_name':latest['data'].get('Name') or raw.get('Name') or code,'phone':phone,
            'gender':raw.get('Gender') or None,'category':raw.get('Category') or None,
            'is_archived':False,'needs_review':not admissions or len(admissions)>1 or not phone,
            'created_at':utc(created) or '2026-10-27T00:00:00+05:30'}
        members.append(member)
        private.append({'member_id':member['id'],'address':raw.get('Address') or None,'medical_history':raw.get('Medical History') or None,'remarks':raw.get('Remarks') or None})
        for r in group:
            a=r['amounts'];start=r['dates'].get('Start Date');end=r['dates'].get('End Date')
            gross=a.get('Total Amount' if r['kind']=='admission' else 'Amount');final=a.get('Final Amount')
            try: gross=Decimal(gross) if gross is not None else None;final=Decimal(final) if final is not None else None
            except InvalidOperation:continue
            if not start or not end or start[:10]>end[:10] or final is None or not final.is_finite() or final<0:continue
            if gross is not None and (not gross.is_finite() or gross<final):gross=None
            semantic_key=(code,r['kind'],start[:10],end[:10],str(final))
            if semantic_key in seen_periods:continue
            seen_periods.add(semantic_key)
            paid=a.get('Amount Paid');pending=a.get('Pending Amount')
            known=False
            if paid is not None and pending is not None:
                try:known=Decimal(paid)>=0 and Decimal(pending)>=0 and Decimal(paid)+Decimal(pending)==final
                except InvalidOperation:pass
            source_key=f"{summary['sha256']}:{r['sheet']}:{r['row']}"
            code_plan=preview.MAIN.get(r['sheet']) or preview.RENEW.get(r['sheet'])
            memberships.append({'id':uid('period:'+source_key),'member_id':member['id'],'plan_id':plan_by_code[code_plan],
                'plan_code':code_plan,'kind':r['kind'],'start_date':start[:10],'end_date':end[:10],
                'status':'confirmed','total_amount':float(gross) if gross is not None else None,'discount_amount':float(gross-final) if gross is not None else None,'final_amount':float(final),'historical_charge':float(final),
                'opening_paid_amount':float(Decimal(paid)) if known else None,'accounting_verified':bool(known),
                'purchased_at':utc(r['dates'].get('Timestamp')),'source_key':source_key})
    # Cashbook receipts are historical collections, separate from opening membership balances.
    # No synthetic payment dates or inferred full-payment records are created.
    for name,rows in archive['sheets'].items():
        headers={re.sub(r'\d+','',ref):c['value'] for ref,c in rows[0]['cells'].items()} if rows else {}
        for row in rows[1:]:
            raw={headers.get(re.sub(r'\d+','',ref),ref):c['value'] for ref,c in row['cells'].items()}
            key=f"{summary['sha256']}:{name}:{row['row']}"
            staging.append({'source_key':key,'sheet_name':name,'row_number':row['row'],'raw_data':row,'import_status':'preserved'})
            if name=='Daily_Cashbook':
                try:
                    amount=preview.money(raw.get('Amount Paid',''));received=preview.parse_date(raw.get('Date',''),archive['date1904'])
                    if amount is not None and received:
                        receipts.append({'id':uid('receipt:'+key),'received_at':utc(received.isoformat()),'description':raw.get('Remark'),
                            'transaction_type':raw.get('Transaction Type'),'amount':float(amount),'payment_mode':raw.get('Mode of Payment'),'source_key':key})
                except (InvalidOperation,ValueError):pass
    imported_keys={m['source_key'] for m in memberships}
    review_records=[{'source_key':f"{summary['sha256']}:{r['sheet']}:{r['row']}",'sheet_name':r['sheet'],'row_number':r['row'],'raw_data':r,'import_status':'needs_review'} for r in records if f"{summary['sha256']}:{r['sheet']}:{r['row']}" not in imported_keys]
    payload={'gym_id':GYM,'members':members,'memberships':memberships,'privateDetails':private,'historicalReceipts':receipts,'reviewRecords':review_records,'plans':plans,'payments':[],
        'expenses':[],'attendance':[],'enquiries':[],'source':{'type':'spreadsheet_snapshot','exportDate':'2026-10-27','sha256':summary['sha256'],
        'unimportedPeriods':len(records)-len(memberships),'totalSourcePeriods':len(records),'reviewFindings':summary['issue_counts']}}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/'snapshot.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    migration=(ROOT/'supabase/migrations/202610270003_management.sql').read_text(encoding='utf-8')
    # One transaction applies schema + import together, rolling back on error.
    lines=[migration.rsplit('commit;',1)[0], '-- Import the reviewed source snapshot without altering source Sheets.']
    def insert(table,items,columns):
        if not items:return
        for start in range(0,len(items),100):
            batch=items[start:start+100]
            lines.append('insert into public.'+table+' (gym_id,'+','.join(columns)+') values\n'+',\n'.join('('+','.join([sql(GYM)]+[sql(item.get(c)) for c in columns])+')' for item in batch)+'\non conflict do nothing;')
    insert('members',members,['id','admission_id','device_user_id','full_name','phone','gender','category','is_archived','needs_review','created_at'])
    insert('member_private_details',private,['member_id','address','medical_history','remarks'])
    # Bind memberships to the plans already installed by the original migration.
    for m in memberships:
        values={k:v for k,v in m.items() if k not in ('plan_id','plan_code','final_amount')}
        columns=list(values)
        lines.append('insert into public.memberships(gym_id,plan_id,'+','.join(columns)+') select '+sql(GYM)+',id,'+','.join(sql(values[k]) for k in columns)+' from public.membership_plans where gym_id='+sql(GYM)+' and code='+sql(m['plan_code'])+' on conflict do nothing;')
    insert('historical_receipts',receipts,['id','received_at','description','transaction_type','amount','payment_mode','source_key'])
    insert('migration_records',staging,['source_key','sheet_name','row_number','raw_data','import_status'])
    lines+=['commit;',"select 'Real data setup complete' as result, (select count(*) from public.members where gym_id="+sql(GYM)+") as members, (select count(*) from public.memberships where gym_id="+sql(GYM)+") as membership_periods, (select count(*) from public.historical_receipts where gym_id="+sql(GYM)+") as cashbook_receipts;"]
    (OUTPUT/'RUN-IN-SUPABASE.sql').write_text('\n'.join(lines),encoding='utf-8')
    result={'members':len(members),'membership_periods':len(memberships),'cashbook_receipts':len(receipts),'preserved_source_rows':len(staging),'quarantined_membership_periods':len(records)-len(memberships),'accounting_verified':sum(m['accounting_verified'] for m in memberships)}
    (OUTPUT/'import-summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':prepare()
