let settings, stats, deviceState;
let scannedDevices = [], selectedElementId = null, dragState = null, canvasScale = 1, saveTimer, toastTimer;
const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

const VI = window.JUNGLE_I18N.vi;
const DYNAMIC = {
  en:{select:"Select",selected:"Selected",connect:"Connect",disconnect:"Disconnect",online:"ONLINE",offline:"OFFLINE",disconnected:"Disconnected",connecting:"Connecting",streaming:"Streaming",error:"Connection error",remaining:"{count} remaining",done:"All tasks completed",source:"Choose a source",saved:"Saved",saving:"Saving.",scanned:"Display scan complete",reset:"Restored defaults"},
  vi: window.JUNGLE_I18N.dynamicVi
};
function tr(key, values = {}) {
  let value = (DYNAMIC[settings?.language === "vi" ? "vi" : "en"][key] || key);
  Object.entries(values).forEach(([name, replacement]) => value = value.replaceAll("{" + name + "}", replacement));
  return value;
}
function applyLanguage() {
  document.documentElement.lang = settings.language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    if (!node.dataset.english) node.dataset.english = node.textContent;
    node.textContent = settings.language === "vi" ? (VI[node.dataset.i18n] || node.dataset.english) : node.dataset.english;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    if (!node.dataset.englishPlaceholder) node.dataset.englishPlaceholder = node.placeholder;
    node.placeholder = settings.language === "vi" ? (VI[node.dataset.i18nPlaceholder] || node.dataset.englishPlaceholder) : node.dataset.englishPlaceholder;
  });
}
function activeDisplay() { return settings.displays.find((item) => item.id === settings.activeDisplayId) || settings.displays[0]; }
function mediaUrl(source) {
  const value = String(source || "");
  return /^[a-zA-Z]:\\/.test(value) ? encodeURI("file:///" + value.replace(/\\/g, "/")).replace(/#/g, "%23") : value;
}
function youtubeId(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0];
    if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2];
    return parsed.searchParams.get("v");
  } catch { return String(url || "").match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1]; }
}
function nowInfo() {
  const locale = settings.language === "vi" ? "vi-VN" : "en-GB", now = new Date();
  return {
    time: new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit"}).format(now),
    date: new Intl.DateTimeFormat(locale,{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"}).format(now)
  };
}
function uptime(seconds) {
  const hours = Math.floor((seconds || 0) / 3600), minutes = Math.floor(((seconds || 0) % 3600) / 60);
  return String(hours).padStart(2,"0") + ":" + String(minutes).padStart(2,"0");
}
function metric(type) {
  if (!stats) return "--";
  if (type === "cpu") return stats.cpuPercent + "%";
  if (type === "ram") return stats.memoryPercent + "%";
  if (type === "gpu") return stats.gpu?.percent == null ? "N/A" : stats.gpu.percent + "%";
  return uptime(stats.uptime);
}
function taskHtml(element) {
  const tasks = settings.todos.filter((task) => !task.done).slice(0, element.maxItems || 4);
  return tasks.length ? tasks.map((task) => "<li>" + esc(task.title) + "</li>").join("") : "<li>" + esc(tr("done")) + "</li>";
}
function elementHtml(element) {
  const label = element.title ? '<span class="element-label">' + esc(element.title) + "</span>" : "";
  if (element.type === "video") return element.source ? '<video src="' + esc(mediaUrl(element.source)) + '" autoplay loop muted playsinline style="object-fit:' + element.fit + '"></video>' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  if (element.type === "youtube") {
    const id = youtubeId(element.source);
    return id ? '<iframe src="https://www.youtube-nocookie.com/embed/' + id + "?autoplay=1&mute=1&loop=1&playlist=" + id + '&controls=0&rel=0&playsinline=1"></iframe>' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  }
  if (element.type === "image") return element.source ? '<img src="' + esc(mediaUrl(element.source)) + '" style="object-fit:' + element.fit + '">' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  if (element.type === "shape") return '<div class="element-content"></div>';
  if (element.type === "tasks") return '<div class="element-content element-tasks">' + label + "<ol>" + taskHtml(element) + "</ol></div>";
  if (element.type === "text") return '<div class="element-content">' + label + '<b class="element-value element-date">' + esc(element.text) + "</b></div>";
  if (element.type === "clock") return '<div class="element-content">' + label + '<b class="element-value" data-dynamic="clock">' + nowInfo().time + "</b></div>";
  if (element.type === "date") return '<div class="element-content">' + label + '<b class="element-value element-date" data-dynamic="date">' + esc(nowInfo().date) + "</b></div>";
  return '<div class="element-content">' + label + '<b class="element-value" data-dynamic="' + element.type + '">' + metric(element.type) + "</b></div>";
}
function toast(message) {
  $("toast").textContent = message; $("toast").classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1700);
}
function matchDevice(display) {
  return scannedDevices.find((device) => device.id === display.id || device.path === display.portPath || (device.serialNumber && device.serialNumber === display.usb?.serialNumber));
}
function renderOptions() {
  const html = settings.displays.map((display) => '<option value="' + esc(display.id) + '">' + esc(display.name) + " (" + display.profile.width + "x" + display.profile.height + ")</option>").join("");
  ["canvas-display-select","config-display-select"].forEach((id) => { $(id).innerHTML = html; $(id).value = settings.activeDisplayId; });
}
function renderDevices() {
  $("device-grid").innerHTML = settings.displays.map((display) => {
    const device = matchDevice(display), online = Boolean(device), active = display.id === settings.activeDisplayId;
    const streaming = deviceState?.status === "streaming" && deviceState.displayId === display.id;
    const usb = (device?.vendorId || display.usb?.vendorId || "----") + ":" + (device?.productId || display.usb?.productId || "----");
    return '<article class="device-card' + (active ? " active" : "") + '"><header><h3>' + esc(display.name) + '</h3><span class="' + (online ? "online" : "offline") + '">' + tr(online ? "online" : "offline") + "</span></header><dl><dt>Port</dt><dd>" + esc(device?.path || display.portPath) + "</dd><dt>Profile</dt><dd>" + display.profile.width + " x " + display.profile.height + " / " + display.profile.rotation + "°</dd><dt>USB</dt><dd>" + esc(usb) + '</dd></dl><div class="device-actions"><button class="ghost" data-select-display="' + esc(display.id) + '">' + tr(active ? "selected" : "select") + '</button><button class="' + (streaming ? "danger-soft" : "primary") + '" data-connect-display="' + esc(display.id) + '"' + (!online && !streaming ? " disabled" : "") + ">" + tr(streaming ? "disconnect" : "connect") + "</button></div></article>";
  }).join("");
}
function scaleCanvas() {
  const display = activeDisplay(), viewport = $("canvas-viewport"), stage = $("layout-canvas"), wrap = $("canvas-stage-wrap");
  const fit = Math.min((viewport.clientWidth - 40) / display.profile.width, (viewport.clientHeight - 40) / display.profile.height, 1);
  canvasScale = $("canvas-zoom").value === "fit" ? Math.max(.08, fit) : Number($("canvas-zoom").value);
  stage.style.width = display.profile.width + "px"; stage.style.height = display.profile.height + "px"; stage.style.transform = "scale(" + canvasScale + ")";
  wrap.style.width = Math.round(display.profile.width * canvasScale) + "px"; wrap.style.height = Math.round(display.profile.height * canvasScale) + "px";
}
function styleElement(node, element) {
  Object.assign(node.style,{left:element.x+"px",top:element.y+"px",width:element.width+"px",height:element.height+"px",zIndex:element.z,color:element.color,backgroundColor:element.background,fontSize:element.fontSize+"px",opacity:element.opacity,borderRadius:element.radius+"px"});
  node.innerHTML = elementHtml(element) + '<i class="resize-handle"></i>';
}
function renderCanvas() {
  const display = activeDisplay(), canvas = display.canvas, stage = $("layout-canvas");
  $("canvas-name").textContent = display.name; $("canvas-size").textContent = display.profile.width + " x " + display.profile.height;
  $("canvas-background").value = canvas.background; $("canvas-background-image").value = canvas.backgroundImage || "";
  stage.style.backgroundColor = canvas.background;
  const bg = canvas.backgroundImage ? mediaUrl(canvas.backgroundImage).replaceAll('"',"%22") : "";
  stage.style.backgroundImage = bg ? 'url("' + bg + '")' : "none"; stage.style.backgroundSize = "cover"; stage.style.backgroundPosition = "center"; stage.innerHTML = "";
  canvas.elements.slice().sort((a,b) => a.z-b.z).forEach((element) => {
    const node = document.createElement("div"); node.className = "canvas-element " + element.type + (element.id === selectedElementId ? " selected" : "");
    node.dataset.elementId = element.id; node.dataset.type = element.type; styleElement(node,element); stage.appendChild(node); node.querySelector("video")?.play().catch(()=>{});
  });
  if (!canvas.elements.some((element) => element.id === selectedElementId)) selectedElementId = null;
  requestAnimationFrame(scaleCanvas); renderInspector();
}
function selected() { return activeDisplay().canvas.elements.find((item) => item.id === selectedElementId); }
function renderInspector() {
  const element = selected(); $("inspector-empty").hidden = Boolean(element); $("inspector-fields").hidden = !element; if (!element) return;
  const values = {"prop-title":element.title,"prop-text":element.text,"prop-source":element.source,"prop-x":element.x,"prop-y":element.y,"prop-width":element.width,"prop-height":element.height,"prop-color":element.color,"prop-background":element.background,"prop-font-size":element.fontSize,"prop-radius":element.radius,"prop-opacity":Math.round(element.opacity*100),"prop-fit":element.fit,"prop-max-items":element.maxItems};
  Object.entries(values).forEach(([id,value]) => $(id).value = value);
  $("prop-type").textContent = element.type.toUpperCase(); $("prop-id").textContent = element.id; $("prop-opacity-value").textContent = Math.round(element.opacity*100) + "%";
  $("prop-text-row").hidden = element.type !== "text"; $("prop-source-row").hidden = !["video","youtube","image"].includes(element.type);
  $("pick-source").hidden = element.type === "youtube"; $("prop-fit-row").hidden = !["video","image"].includes(element.type); $("prop-items-row").hidden = element.type !== "tasks";
}
function renderDisplayForm() {
  const display = activeDisplay(), profile = display.profile, port = $("port-select");
  port.innerHTML = '<option value="auto">Auto detect</option>' + scannedDevices.map((device) => '<option value="' + esc(device.path) + '">' + esc(device.label) + "</option>").join("");
  if (![...port.options].some((option)=>option.value===display.portPath) && display.portPath !== "auto") port.insertAdjacentHTML("beforeend",'<option value="'+esc(display.portPath)+'">'+esc(display.portPath)+"</option>");
  port.value=display.portPath; $("display-name").value=display.name; $("display-preset").value=["960x480","800x480","480x480","480x800","1920x480"].includes(profile.preset)?profile.preset:"custom";
  $("display-width").value=profile.width; $("display-height").value=profile.height; $("rotation").value=profile.rotation; $("frame-limit").value=Math.round(display.maxFrameBytes/1000);
  $("brightness").value=display.brightness; $("brightness-value").textContent=display.brightness+"%";
}
function renderTasks() {
  $("task-count").textContent = tr("remaining",{count:settings.todos.filter((task)=>!task.done).length});
  $("task-list").innerHTML = settings.todos.length ? settings.todos.map((task)=>'<div class="task'+(task.done?" done":"")+'"><input type="checkbox" data-task-toggle="'+esc(task.id)+'"'+(task.done?" checked":"")+"><span>"+esc(task.title)+'</span><button data-task-delete="'+esc(task.id)+'">x</button></div>').join("") : '<div class="empty-state">'+tr("done")+"</div>";
}
function renderSettings() {
  $("launch-at-login").checked=settings.startup.launchAtLogin; $("auto-connect").checked=settings.startup.autoConnect; $("auto-reconnect").checked=settings.startup.autoReconnect;
  $("reconnect-delay").value=settings.startup.reconnectDelay; $("open-preview").checked=settings.startup.openPreview;
}
function updateDynamic() {
  const now=nowInfo(); $("clock").textContent=new Date().toLocaleTimeString(settings.language==="vi"?"vi-VN":"en-GB");
  if(stats){$("cpu-stat").textContent=stats.cpuPercent+"%";$("cpu-name").textContent=stats.cpu;$("ram-stat").textContent=stats.memoryPercent+"%";$("ram-detail").textContent=stats.memoryUsedGb+" / "+stats.memoryTotalGb+" GB";$("gpu-stat").textContent=stats.gpu?.percent==null?"N/A":stats.gpu.percent+"%";$("gpu-name").textContent=stats.gpu?.name||"GPU unavailable";}
  document.querySelectorAll("[data-dynamic]").forEach((node)=>node.textContent=node.dataset.dynamic==="clock"?now.time:node.dataset.dynamic==="date"?now.date:metric(node.dataset.dynamic));
  const status=["connecting","streaming","error"].includes(deviceState?.status)?deviceState.status:"disconnected", side=document.querySelector(".sidebar-foot");
  side.className="sidebar-foot "+status;$("sidebar-status").textContent=tr(status)+(deviceState?.portPath?" · "+deviceState.portPath:"");$("stream-stat").textContent=(deviceState?.fps||0)+" FPS";$("frame-detail").textContent=deviceState?.frameBytes?Math.round(deviceState.frameBytes/1000)+" KB/frame":"--";
}
function renderAll(){ $("language").value=settings.language;applyLanguage();renderOptions();renderDevices();renderCanvas();renderDisplayForm();renderTasks();renderSettings();updateDynamic(); }
async function saveRefresh(message){settings=await window.jungle.saveSettings(settings);renderAll();if(message)toast(message);}
function queueSave(){ $("save-indicator").textContent=tr("saving");clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{settings=await window.jungle.saveSettings(settings);$("save-indicator").textContent=tr("saved");},450); }
async function scan(){
  scannedDevices=await window.jungle.scanDevices();
  scannedDevices.forEach((device,index)=>{
    let display=settings.displays.find((item)=>item.id===device.id||item.portPath===device.path||(device.serialNumber&&item.usb?.serialNumber===device.serialNumber));
    const placeholder=settings.displays.length===1&&settings.displays[0].id==="default"&&!settings.displays[0].usb?.vendorId;
    if(!display&&placeholder&&index===0){display=settings.displays[0];const old=display.id;display.id=device.id;if(settings.activeDisplayId===old)settings.activeDisplayId=device.id;}
    if(!display){const profile=device.defaultProfile||{preset:"960x480",name:"Jungle Display",width:960,height:480,rotation:180};display={id:device.id,name:"Jungle Display",portPath:device.path,usb:{},detectedProfile:{...profile},profile:{...profile},brightness:100,maxFrameBytes:50000};settings.displays.push(display);}
    display.portPath=device.path;display.usb={vendorId:device.vendorId,productId:device.productId,serialNumber:device.serialNumber,manufacturer:device.manufacturer};
  });
  if(scannedDevices.length)settings=await window.jungle.saveSettings(settings);renderAll();toast(tr("scanned"));
}
function newElement(type){
  const display=activeDisplay(),p=display.profile,large=["video","youtube","image","tasks"].includes(type),w=Math.min(p.width,large?Math.max(240,Math.round(p.width*.46)):Math.max(150,Math.round(p.width*.23)));
  const h=Math.min(p.height,["video","youtube","image"].includes(type)?Math.max(140,Math.round(p.height*.42)):type==="tasks"?Math.max(160,Math.round(p.height*.55)):Math.max(80,Math.round(p.height*.23)));
  const labels={cpu:"CPU",ram:"RAM",gpu:"GPU",uptime:"UPTIME",tasks:"TASKS",clock:"TIME",date:"DATE"};
  return{id:type+"-"+Date.now().toString(36),type,x:Math.max(0,Math.round((p.width-w)/2)),y:Math.max(0,Math.round((p.height-h)/2)),width:w,height:h,color:"#effaf5",background:type==="shape"?"#62edab":"#102832",fontSize:type==="clock"?52:28,opacity:1,radius:12,fit:"cover",z:Math.max(0,...display.canvas.elements.map((item)=>item.z))+1,title:labels[type]||"",text:type==="text"?"Your text":"",source:"",maxItems:4};
}
function inspectorChange(event){
  const e=selected();if(!e)return;const p=activeDisplay().profile;
  const oldWidth=e.width,oldHeight=e.height,oldFont=e.fontSize,oldRadius=e.radius;
  e.title=$("prop-title").value;e.text=$("prop-text").value;e.source=$("prop-source").value;
  e.width=Math.round(clamp($("prop-width").value,40,p.width,e.width));e.height=Math.round(clamp($("prop-height").value,32,p.height,e.height));
  if(event && ["prop-width","prop-height"].includes(event.target.id)){
    const ratio=Math.sqrt((e.width*e.height)/(oldWidth*oldHeight));
    $("prop-font-size").value=Math.round(clamp(oldFont*ratio,6,300,oldFont));
    $("prop-radius").value=Math.round(clamp(oldRadius*ratio,0,200,oldRadius));
  }
  e.x=Math.round(clamp($("prop-x").value,0,p.width-e.width,e.x));e.y=Math.round(clamp($("prop-y").value,0,p.height-e.height,e.y));e.color=$("prop-color").value;e.background=$("prop-background").value;
  e.fontSize=Math.round(clamp($("prop-font-size").value,6,300,e.fontSize));e.radius=Math.round(clamp($("prop-radius").value,0,200,e.radius));e.opacity=clamp($("prop-opacity").value/100,.05,1,1);e.fit=$("prop-fit").value;e.maxItems=Math.round(clamp($("prop-max-items").value,1,20,4));
  const node=$("layout-canvas").querySelector('[data-element-id="'+CSS.escape(e.id)+'"]');if(node)styleElement(node,e);$("prop-opacity-value").textContent=Math.round(e.opacity*100)+"%";queueSave();
}
async function chooseDisplay(id){if(!settings.displays.some((item)=>item.id===id))return;settings.activeDisplayId=id;selectedElementId=null;await saveRefresh(tr("saved"));}
function bind(){
  document.querySelectorAll(".nav").forEach((button)=>button.onclick=()=>{document.querySelectorAll(".nav").forEach((item)=>item.classList.toggle("active",item===button));document.querySelectorAll(".panel").forEach((panel)=>panel.classList.toggle("active",panel.id===button.dataset.panel));if(button.dataset.panel==="canvas")requestAnimationFrame(scaleCanvas);});
  $("language").onchange=async(e)=>{settings.language=e.target.value;await saveRefresh(tr("saved"));};$("scan-devices").onclick=scan;$("scan-display").onclick=scan;$("preview-main").onclick=$("preview-canvas").onclick=()=>window.jungle.openPreview();
  $("canvas-display-select").onchange=$("config-display-select").onchange=(e)=>chooseDisplay(e.target.value);$("canvas-zoom").onchange=scaleCanvas;window.addEventListener("resize",()=>requestAnimationFrame(scaleCanvas));
  $("device-grid").onclick=async(e)=>{const select=e.target.closest("[data-select-display]");if(select)return chooseDisplay(select.dataset.selectDisplay);const connect=e.target.closest("[data-connect-display]");if(!connect)return;const id=connect.dataset.connectDisplay;if(deviceState?.status==="streaming"&&deviceState.displayId===id)deviceState=await window.jungle.disconnectDevice();else{settings.activeDisplayId=id;settings=await window.jungle.saveSettings(settings);const display=activeDisplay(),device=matchDevice(display);deviceState=await window.jungle.connectDevice({displayId:id,path:device?.path||display.portPath});}renderAll();};
  document.querySelectorAll("[data-add]").forEach((button)=>button.onclick=()=>{const e=newElement(button.dataset.add);activeDisplay().canvas.elements.push(e);selectedElementId=e.id;renderCanvas();queueSave();});
  $("layout-canvas").onpointerdown=(event)=>{const node=event.target.closest(".canvas-element");if(!node){selectedElementId=null;renderCanvas();return;}selectedElementId=node.dataset.elementId;const e=selected();document.querySelectorAll(".canvas-element").forEach((item)=>item.classList.toggle("selected",item===node));renderInspector();dragState={id:e.id,mode:event.target.classList.contains("resize-handle")?"resize":"move",startX:event.clientX,startY:event.clientY,original:{x:e.x,y:e.y,width:e.width,height:e.height,fontSize:e.fontSize,radius:e.radius}};event.preventDefault();};
  document.addEventListener("pointermove",(event)=>{if(!dragState)return;const e=selected();if(!e||e.id!==dragState.id)return;const p=activeDisplay().profile,dx=(event.clientX-dragState.startX)/canvasScale,dy=(event.clientY-dragState.startY)/canvasScale;if(dragState.mode==="move"){e.x=Math.round(clamp(dragState.original.x+dx,0,p.width-e.width,0));e.y=Math.round(clamp(dragState.original.y+dy,0,p.height-e.height,0));}else{e.width=Math.round(clamp(dragState.original.width+dx,40,p.width-e.x,40));e.height=Math.round(clamp(dragState.original.height+dy,32,p.height-e.y,32));const ratio=Math.sqrt((e.width*e.height)/(dragState.original.width*dragState.original.height));e.fontSize=Math.round(clamp(dragState.original.fontSize*ratio,6,300,dragState.original.fontSize));e.radius=Math.round(clamp(dragState.original.radius*ratio,0,200,dragState.original.radius));$("prop-font-size").value=e.fontSize;$("prop-radius").value=e.radius;}const node=$("layout-canvas").querySelector('[data-element-id="'+CSS.escape(e.id)+'"]');if(node)styleElement(node,e);["x","y","width","height"].forEach((key)=>$("prop-"+key).value=e[key]);});
  document.addEventListener("pointerup",()=>{if(dragState){dragState=null;queueSave();}});
  ["prop-title","prop-text","prop-source","prop-x","prop-y","prop-width","prop-height","prop-color","prop-background","prop-font-size","prop-radius","prop-opacity","prop-fit","prop-max-items"].forEach((id)=>$(id).oninput=inspectorChange);
  $("pick-source").onclick=async()=>{const e=selected();if(!e)return;const source=await window.jungle.pickMedia(e.type==="image"?"image":"video");if(source){e.source=source;renderCanvas();queueSave();}};
  $("canvas-background").oninput=(e)=>{activeDisplay().canvas.background=e.target.value;$("layout-canvas").style.backgroundColor=e.target.value;queueSave();};
  $("canvas-background-image").onchange=(e)=>{activeDisplay().canvas.backgroundImage=e.target.value;renderCanvas();queueSave();};
  $("pick-background").onclick=async()=>{const source=await window.jungle.pickMedia("image");if(source){activeDisplay().canvas.backgroundImage=source;renderCanvas();queueSave();}};
  $("clear-background").onclick=()=>{activeDisplay().canvas.backgroundImage="";renderCanvas();queueSave();};
  $("reset-layout").onclick=async()=>{delete activeDisplay().canvas;settings=await window.jungle.saveSettings(settings);selectedElementId=null;renderAll();toast(tr("reset"));};
  $("delete-element").onclick=()=>{activeDisplay().canvas.elements=activeDisplay().canvas.elements.filter((e)=>e.id!==selectedElementId);selectedElementId=null;renderCanvas();queueSave();};
  $("duplicate-element").onclick=()=>{const e=selected();if(!e)return;const copy={...e,id:e.type+"-"+Date.now().toString(36),x:e.x+12,y:e.y+12,z:Math.max(...activeDisplay().canvas.elements.map((i)=>i.z))+1};activeDisplay().canvas.elements.push(copy);selectedElementId=copy.id;renderCanvas();queueSave();};
  $("bring-front").onclick=()=>{const e=selected();if(e){e.z=Math.max(...activeDisplay().canvas.elements.map((i)=>i.z))+1;renderCanvas();queueSave();}};
  $("send-back").onclick=()=>{const e=selected();if(e){e.z=Math.min(...activeDisplay().canvas.elements.map((i)=>i.z))-1;renderCanvas();queueSave();}};
  $("display-preset").onchange=(e)=>{if(e.target.value!=="custom"){const size=e.target.value.split("x");$("display-width").value=size[0];$("display-height").value=size[1];}};
  $("brightness").oninput=(e)=>$("brightness-value").textContent=e.target.value+"%";
  $("save-display").onclick=async()=>{const d=activeDisplay();d.name=$("display-name").value||"Jungle Display";d.portPath=$("port-select").value;d.profile={preset:$("display-preset").value,name:d.name,width:Number($("display-width").value),height:Number($("display-height").value),rotation:Number($("rotation").value)};d.brightness=Number($("brightness").value);d.maxFrameBytes=Number($("frame-limit").value)*1000;await saveRefresh(tr("saved"));};
  $("reset-profile").onclick=async()=>{const d=activeDisplay();d.profile={...d.detectedProfile};d.name=d.detectedProfile.name||d.name;await saveRefresh(tr("reset"));};
  $("task-form").onsubmit=async(e)=>{e.preventDefault();const input=$("task-input"),title=input.value.trim();if(!title)return;settings.todos.push({id:"task-"+Date.now().toString(36),title,done:false});input.value="";await saveRefresh(tr("saved"));};
  $("task-list").onchange=async(e)=>{const task=settings.todos.find((item)=>item.id===e.target.dataset.taskToggle);if(task){task.done=e.target.checked;await saveRefresh(tr("saved"));}};
  $("task-list").onclick=async(e)=>{if(e.target.dataset.taskDelete){settings.todos=settings.todos.filter((task)=>task.id!==e.target.dataset.taskDelete);await saveRefresh(tr("saved"));}};
  $("save-settings").onclick=async()=>{settings.startup={launchAtLogin:$("launch-at-login").checked,autoConnect:$("auto-connect").checked,autoReconnect:$("auto-reconnect").checked,reconnectDelay:Number($("reconnect-delay").value),openPreview:$("open-preview").checked};await saveRefresh(tr("saved"));};
}
async function start(){
  [settings,stats,deviceState]=await Promise.all([window.jungle.getSettings(),window.jungle.getSystem(),window.jungle.getDeviceState()]);bind();renderAll();await scan().catch(()=>renderAll());
  setInterval(async()=>{stats=await window.jungle.getSystem();updateDynamic();},1000);
  window.jungle.onDevice((next)=>{deviceState=next;renderDevices();updateDynamic();});
  window.jungle.onSettings((next)=>{settings=next;if(!dragState)renderAll();});
}
start();
