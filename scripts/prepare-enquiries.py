"""Prepare the inspected enquiry Sheet for an admin-triggered Supabase import."""
from pathlib import Path
import datetime as dt
import json
import re

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'migration-data/enquiries'
def date_value(value):
    if value in ('',None):return None
    if isinstance(value,(int,float)):
        return (dt.datetime(1899,12,30,tzinfo=dt.timezone(dt.timedelta(hours=5,minutes=30)))+dt.timedelta(days=value)).isoformat()
    raw=str(value).strip()
    for fmt in ('%d-%m-%Y','%d/%m/%Y','%Y-%m-%d'):
        try:return dt.datetime.strptime(raw,fmt).replace(tzinfo=dt.timezone(dt.timedelta(hours=5,minutes=30))).isoformat()
        except ValueError:pass
    raise ValueError('Date needs review')
def prepare():
    snapshot=json.loads((FOLDER/'source-complete.json').read_text(encoding='utf-8'))
    statuses={'not interested':'Not Interested','not intrested':'Not Interested','ni':'Not Interested','admission done':'Admission Done','addmission done':'Admission Done',
      'call done':'Call Done','trial done':'Trial Done','whatsapp sent':'WhatsApp Sent','pending':'Pending','call later':'Call Later','wrong number':'Wrong Number','':'Pending'}
    leads=[];held=[]
    for number,row in enumerate(snapshot['values'][1:],2):
        row=list(row)+[None]*max(0,13-len(row))
        if not str(row[1] or '').strip():continue
        try:
            created=date_value(row[8] or row[0])
            if not created:raise ValueError('Missing enquiry date')
        except ValueError:
            held.append({'row':number,'reason':'Invalid date','raw':row});continue
        warnings=[]
        try:follow=date_value(row[6])
        except ValueError:follow=None;warnings.append('Original follow-up date needs review: '+str(row[6]))
        try:next_follow=date_value(row[11])
        except ValueError:next_follow=None;warnings.append('Original next follow-up date needs review: '+str(row[11]))
        phone=str(int(row[2])) if isinstance(row[2],(int,float)) else re.sub(r'\D','',str(row[2] or '')) or None
        original_status=str(row[10] or '').strip();lead_status=statuses.get(original_status.lower(),'Pending')
        status='converted' if lead_status=='Admission Done' else 'closed' if lead_status in ('Not Interested','Wrong Number') else 'new' if lead_status=='Pending' else 'contacted'
        detail=str(row[3] or '').strip()
        email=detail if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',detail) else None
        leads.append(dict(full_name=str(row[1]).strip(),phone=phone,email=email,address=detail if detail and not email else None,
          interested_plan=row[4] or None,source=row[5] or None,follow_up_date=follow[:10] if follow else None,
          next_follow_up_date=next_follow[:10] if next_follow else None,notes='\n'.join([str(row[7] or '')]+warnings).strip() or None,remark=row[12] or None,
          status=status,lead_status=lead_status,legacy_status=original_status,needs_review=not bool(re.fullmatch(r'\d{10,15}',phone or '')) or bool(warnings) or original_status.lower() not in statuses,
          created_at=created,source_key=f"sheet:{snapshot['spreadsheet_id']}:Enquiries:{number}"))
    balances=[]
    pending=json.loads((FOLDER/'pending-source.json').read_text(encoding='utf-8'))
    for row in pending['values'][1:]:
        if len(row)>=7 and row[0]:balances.append(dict(admission_id=row[0],end_date=date_value(row[4])[:10],amount_paid=row[5],pending_amount=row[6]))
    output={'gym_id':'b80cd818-2abe-4a90-9027-e2ba1916aec4','source_date':'2026-10-27','leads':leads,'balances':balances,'held':held}
    (FOLDER/'prepared.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'leads':len(leads),'held_rows':len(held),'pending_snapshots':len(balances),'missing_contact':sum(not l['phone'] for l in leads)}))
if __name__=='__main__':prepare()
