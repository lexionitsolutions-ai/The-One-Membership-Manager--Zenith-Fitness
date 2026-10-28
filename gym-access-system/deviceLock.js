let busy=false;
function acquireDevice(){if(busy)return null;busy=true;let released=false;return ()=>{if(!released){released=true;busy=false;}};}
module.exports={acquireDevice};
