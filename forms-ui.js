// Persistent field labels and a consistent payment summary across staff forms.
(() => {
  const navigation=document.getElementById('formNavigation');
  if(navigation)navigation.addEventListener('change',()=>location.assign(navigation.value));
  if(navigation&&['http:','https:'].includes(location.protocol))fetch('/api/portal/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(session=>{
    if(session?.staff?.role!=='receptionist')return;
    const pages=[['/forms/index.html','New Admission'],['/dashboard/?page=renewed','Renewed Members'],['/forms/renewal.html','Renewals'],['/forms/pt.html','Personal Training'],['/forms/enquire.html','Enquiries'],['/dashboard/?page=leads','Follow-ups'],['/dashboard/?page=attendance','Attendance'],['/dashboard/?page=review','Review Members'],['/dashboard/?page=members','Members'],['/dashboard/?page=pending','Pending Amounts'],['/dashboard/?page=expenses','Expenses']];
    navigation.replaceChildren();for(const [path,label] of pages){const option=new Option(label,path);option.selected=new URL(path,location.origin).pathname===location.pathname;navigation.add(option);}
  }).catch(()=>{});
  window.zenithAddressValue=select=>select.value==='__other__'?document.getElementById(select.id+'Other').value.trim():select.value.trim();
  for(const id of ['address','enqAddress']){
    const select=document.getElementById(id),other=document.getElementById(id+'Other');if(!select||!other)continue;
    const label=document.querySelector('label[for="'+id+'Other"]');
    const toggle=()=>{const custom=select.value==='__other__';other.hidden=!custom;other.disabled=!custom;other.required=custom;other.setCustomValidity(custom&&!other.value.trim()?'Please specify the address.':'');if(label)label.hidden=!custom;const field=other.closest('.other-address-field');if(field)field.hidden=!custom;};
    other.addEventListener('input',toggle);
    select.addEventListener('change',()=>{toggle();if(!other.hidden)other.focus();});
    select.closest('form').addEventListener('reset',()=>setTimeout(toggle,0));toggle();
  }
  const names={cashCollected:'Cash collected (INR)',onlineCollected:'Online collected (INR)',name:'Full name',mobile:'Mobile number',gender:'Gender',age:'Age',birthDate:'Birth date',address:'Address',injuries:'Injuries / medical history',plan:'Membership package',category:'Membership type',startDate:'Start date',endDate:'End date',amountPaid:'Amount received (₹)',pendingAmount:'Pending amount (₹)',paymentMode:'Payment method',remarks:'Remarks',searchMobile:'Mobile number or admission ID',searchMember:'Mobile number or admission ID',memberName:'Member name',memberId:'Admission ID',currentPlan:'Current package',currentStartDate:'Current start date',currentEndDate:'Current end date',newPlan:'Package',renewStartDate:'Renewal start date',renewEndDate:'Renewal end date',enqName:'Full name',enqContact:'Contact number',enqAddress:'Address',enqEmail:'Email address',enqInterestedIn:'Interested in',enqSource:'How did they hear about us?',enqFollowUpDate:'Follow-up date',enqMessage:'Requirements / message',currentPaymentStatus:'Payment status',currentPendingAmount:'Verified membership dues (₹)',newStartDate:'Start date',newEndDate:'End date',packageNote:'Reason for change',paymentNote:'Payment note',editName:'Full name',editPhone:'Contact number',profileNote:'Reason for correction',membershipSelect:'Membership period',ptPlan:'PT package',trainer:'Trainer',ptStart:'PT start date',ptEnd:'PT end date',ptCharge:'Agreed PT price (₹)',ptPaid:'Amount received (₹)',ptMode:'Payment method',ptNotes:'Goals / notes'};
  document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(el=>{
    if(el.closest('.form-field')||!el.id||el.id==='formNavigation')return;
    const wrapper=document.createElement('div');wrapper.className='form-field';
    const label=document.createElement('label');label.htmlFor=el.id;label.textContent=names[el.id]||el.placeholder||el.id;
    if(el.required)label.append(' *');
    el.before(wrapper);wrapper.append(label,el);
    if(el.type==='number'){if(!el.min)el.min='0';if(/amount|paid|charge/i.test(el.id))el.step='0.01';}

  });
  const paid=document.getElementById('amountPaid'),pending=document.getElementById('pendingAmount');
  if(paid&&pending){const box=document.createElement('div');box.className='payment-summary';box.setAttribute('aria-live','polite');pending.closest('.section').append(box);
    const update=()=>{box.textContent='Agreed membership price: ₹ '+((Number(paid.value)||0)+(Number(pending.value)||0)).toLocaleString('en-IN',{maximumFractionDigits:2});};paid.addEventListener('input',update);pending.addEventListener('input',update);update();}
})();
