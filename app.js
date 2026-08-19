const $ = (id) => document.getElementById(id);
const progressCircle = $("gaugeProgress");
const circumference = 2 * Math.PI * 112;
progressCircle.style.strokeDasharray = circumference;
progressCircle.style.strokeDashoffset = circumference;

const state = { running:false, metric:"download", download:null, upload:null, ping:null, jitter:null };
const TEST_HOST = "https://speed.cloudflare.com";

function setProgress(percent){
  const value=Math.max(0,Math.min(100,percent));
  progressCircle.style.strokeDashoffset=circumference*(1-value/100);
  $("progressBar").style.width=`${value}%`;
}
function setMetric(value,unit="Mbps"){
  $("speedValue").textContent=Number.isFinite(value)?value.toFixed(value>=100?0:1):"0.0";
  $("speedUnit").textContent=unit;
}
function format(value){return Number.isFinite(value)?(value>=100?value.toFixed(0):value.toFixed(1)):"—";}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function getNetworkInfo(){
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  $("onlineState").textContent=navigator.onLine?"Online":"Offline";
  if(!connection)return;
  $("connectionType").textContent=connection.type||"Browser reported";
  $("downlinkEstimate").textContent=Number.isFinite(connection.downlink)?`${connection.downlink} Mbps`:"—";
  $("effectiveType").textContent=connection.effectiveType||"—";
}

function setStage(stage){
  const order=["ping","download","upload"];
  const index=order.indexOf(stage);
  document.querySelectorAll("[data-stage-dot]").forEach(dot=>{
    const dotIndex=order.indexOf(dot.dataset.stageDot);
    dot.classList.toggle("active",dotIndex===index);
    dot.classList.toggle("done",dotIndex<index);
  });
  document.querySelectorAll(".metric-tab").forEach(tab=>{
    const active=tab.dataset.metric===stage;
    tab.classList.toggle("active",active);
    tab.setAttribute("aria-selected",active?"true":"false");
  });
}

async function fetchWithTimeout(url,options={},timeout=15000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal,cache:"no-store"});}
  finally{clearTimeout(timer);}
}

async function measurePing(){
  const samples=[];
  for(let i=0;i<5;i++){
    const start=performance.now();
    try{
      const response=await fetchWithTimeout(`${TEST_HOST}/cdn-cgi/trace?ts=${Date.now()}-${i}`,{mode:"cors"},8000);
      if(response.ok)samples.push(performance.now()-start);
    }catch{}
    await sleep(80);
  }
  if(!samples.length)throw new Error("Latency endpoint unavailable");
  const jitter=samples.slice(1).reduce((sum,n,i)=>sum+Math.abs(n-samples[i]),0)/(samples.length-1);
  return {avg:average(samples),jitter};
}

async function readDownload(url,baseProgress,progressSpan,totalBytes){
  const start=performance.now();
  const response=await fetchWithTimeout(url,{mode:"cors"},30000);
  if(!response.ok||!response.body)throw new Error("Download endpoint unavailable");
  const reader=response.body.getReader();
  let bytes=0;
  while(true){
    const result=await Promise.race([
      reader.read(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("Download stalled")),10000))
    ]);
    if(result.done)break;
    bytes+=result.value.byteLength;
    const elapsed=(performance.now()-start)/1000;
    if(elapsed>0)setMetric(bytes*8/elapsed/1e6,"Mbps");
    setProgress(baseProgress+Math.min(progressSpan,progressSpan*(bytes/totalBytes)));
  }
  const elapsed=(performance.now()-start)/1000;
  if(bytes<100000)throw new Error("Download transfer was too small");
  return bytes*8/elapsed/1e6;
}

async function measureDownload(){
  const sizes=[5000000,10000000,20000000];
  const results=[];
  for(let i=0;i<sizes.length;i++){
    const url=`${TEST_HOST}/__down?bytes=${sizes[i]}&cacheBust=${crypto.randomUUID()}`;
    results.push(await readDownload(url,12+i*15,15,sizes[i]));
    setProgress(27+i*15);
  }
  return average(results.slice(-2));
}

async function measureUpload(){
  const sizes=[750000,1500000,3000000];
  const results=[];
  for(let i=0;i<sizes.length;i++){
    const body=new Uint8Array(sizes[i]);
    const start=performance.now();
    const response=await fetchWithTimeout(`${TEST_HOST}/__up?cacheBust=${crypto.randomUUID()}`,{
      method:"POST",mode:"cors",headers:{"Content-Type":"application/octet-stream"},body
    },30000);
    if(!response.ok)throw new Error("Upload endpoint unavailable");
    await response.arrayBuffer();
    const elapsed=(performance.now()-start)/1000;
    if(elapsed>0)results.push(body.byteLength*8/elapsed/1e6);
    setProgress(65+i*11);
    if(results.length)setMetric(results.at(-1),"Mbps");
  }
  if(!results.length)throw new Error("Upload measurement failed");
  return average(results.slice(-2));
}

async function runTest(){
  if(state.running||!navigator.onLine)return;
  state.running=true;
  $("startButton").disabled=true;
  $("startButton").textContent="Testing…";
  $("connectionStatus").textContent="Testing";
  const started=performance.now();
  setProgress(2);
  try{
    setStage("ping");
    $("testState").textContent="Checking latency…";
    const latency=await measurePing();
    state.ping=latency.avg;state.jitter=latency.jitter;
    $("pingResult").textContent=format(state.ping);$("jitterResult").textContent=format(state.jitter);
    setMetric(state.ping,"ms");setProgress(10);

    setStage("download");
    $("testState").textContent="Checking download speed…";
    await sleep(250);
    state.download=await measureDownload();
    $("downloadResult").textContent=format(state.download);setMetric(state.download,"Mbps");setProgress(50);

    setStage("upload");
    $("testState").textContent="Checking upload speed…";
    await sleep(350);
    state.upload=await measureUpload();
    $("uploadResult").textContent=format(state.upload);setMetric(state.upload,"Mbps");setProgress(100);
    document.querySelector('[data-stage-dot="upload"]').classList.remove("active");
    document.querySelector('[data-stage-dot="upload"]').classList.add("done");
    $("testState").textContent="Test complete";$("connectionStatus").textContent="Complete";
  }catch(error){
    console.error("GLOBE test error:",error);
    $("testState").textContent=error.name==="AbortError"?"Test timed out — please try again.":"Test could not complete — please try again.";
    $("connectionStatus").textContent="Error";
  }finally{
    state.running=false;$("startButton").disabled=false;$("startButton").textContent="Run Again";
    $("elapsed").textContent=`${((performance.now()-started)/1000).toFixed(1)}s`;
  }
}

document.querySelectorAll(".metric-tab").forEach(button=>button.addEventListener("click",()=>{
  if(state.running)return;
  const metric=button.dataset.metric;
  document.querySelectorAll(".metric-tab").forEach(b=>b.classList.remove("active"));button.classList.add("active");
  const values={download:[state.download,"Mbps"],upload:[state.upload,"Mbps"],ping:[state.ping,"ms"]};
  setMetric(values[metric][0],values[metric][1]);
}));
$("startButton").addEventListener("click",runTest);
window.addEventListener("online",getNetworkInfo);window.addEventListener("offline",getNetworkInfo);getNetworkInfo();
