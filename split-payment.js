// Admission and renewal share one cash/online breakdown and validation.
(() => {
  const mode=document.getElementById('paymentMode'),paid=document.getElementById('amountPaid');
  const fields=document.getElementById('splitPaymentFields'),cash=document.getElementById('cashCollected'),online=document.getElementById('onlineCollected');
  const split=()=>mode.value==='Cash + Online';
  function calculate(){if(split()){paid.value=((Number(cash.value)||0)+(Number(online.value)||0)).toFixed(2);paid.dispatchEvent(new Event('input',{bubbles:true}));}}
  function update(){fields.hidden=!split();fields.disabled=!split()||mode.disabled;paid.readOnly=split();if(split())calculate();}
  mode.addEventListener('change',update);cash.addEventListener('input',calculate);online.addEventListener('input',calculate);
  new MutationObserver(update).observe(mode,{attributes:true,attributeFilter:['disabled']});
  mode.closest('form').addEventListener('reset',()=>setTimeout(update,0));
  window.zenithSplitPayment={append(formData){if(!split())return;
    const c=Number(cash.value),o=Number(online.value);
    if(!Number.isFinite(c)||!Number.isFinite(o)||c<=0||o<=0||Math.abs(c*100-Math.round(c*100))>0.000001||Math.abs(o*100-Math.round(o*100))>0.000001)throw new Error('Enter positive cash and online amounts with at most two decimal places.');
    if(Math.abs(c+o-Number(paid.value))>0.005)throw new Error('Cash + online must equal the amount received.');
    formData.append('cashCollected',cash.value);formData.append('onlineCollected',online.value);
  }};
  update();
})();
