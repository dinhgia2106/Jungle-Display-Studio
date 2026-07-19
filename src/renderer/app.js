let settings, stats, deviceState, agentSnapshot;
let scannedDevices = [], selectedElementId = null, selectedElementIds = new Set(), dragState = null, typographyClipboard = null, canvasScale = 1, saveTimer, toastTimer, saveRevision = 0, lastCalendarDate, editingEventId = null;
let editorMediaEnabledState = null;
const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

const VI = window.JUNGLE_I18N.vi;
const VI_LOCAL = {
  "property.hardwareContent":"N\u1ed8I DUNG PH\u1ea6N C\u1ee8NG",
  "property.showUsage":"Hi\u1ec3n th\u1ecb % s\u1eed d\u1ee5ng",
  "property.showTemperature":"Hi\u1ec3n th\u1ecb nhi\u1ec7t \u0111\u1ed9",
  "property.temperatureHelp":"Nhi\u1ec7t \u0111\u1ed9 CPU c\u1ea7n c\u1ea3m bi\u1ebfn do Windows ho\u1eb7c LibreHardwareMonitor cung c\u1ea5p.",
  "element.codex":"Codex",
  "element.claude":"Claude Code",
  "agents.title":"Theo d\u00f5i AI agents",
  "agents.help":"Codex t\u1ef1 k\u1ebft n\u1ed1i. B\u1eadt bridge \u0111\u1ec3 Claude Code g\u1eedi quota v\u00e0o m\u00e0n h\u00ecnh.",
  "agents.refresh":"L\u00e0m m\u1edbi",
  "agents.enableClaude":"B\u1eadt bridge quota Claude"
};
const DYNAMIC = {
  en:{select:"Select",selected:"Selected",connect:"Connect",disconnect:"Disconnect",online:"ONLINE",offline:"OFFLINE",disconnected:"Disconnected",connecting:"Connecting",streaming:"Streaming",error:"Connection error",remaining:"{count} remaining",done:"All tasks completed",source:"Choose a source",saved:"Saved",saving:"Saving.",scanned:"Display scan complete",reset:"Restored defaults",multiSelected:"{count} selected",styleCopied:"Style copied",stylePasted:"Style pasted",noEvents:"No events",eventCount:"{count} events",allDay:"All day",todayShort:"Today",tomorrow:"Tomorrow",repeatDaily:"Daily",repeatWeekly:"Weekly",repeatMonthly:"Monthly",repeatYearly:"Yearly",deleteSeries:"Delete event / repeating series",editEvent:"Edit",deleteEvent:"Delete",addReminder:"Add reminder",updateReminder:"Save changes",cancel:"Cancel",annualOn:"Every year on {date}",startsOn:"Starts {date}",repeatsUntil:"until {date}",claudeBridgeEnabled:"Claude quota bridge enabled",existingStatusLine:"Claude already has a custom status line",agentRefreshFailed:"Agent refresh failed"},
  vi: {...window.JUNGLE_I18N.dynamicVi,claudeBridgeEnabled:"\u0110\u00e3 b\u1eadt bridge quota Claude",existingStatusLine:"Claude \u0111ang c\u00f3 status line t\u00f9y ch\u1ec9nh",agentRefreshFailed:"Kh\u00f4ng th\u1ec3 l\u00e0m m\u1edbi agents"}
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
    node.textContent = settings.language === "vi" ? (VI_LOCAL[node.dataset.i18n] || VI[node.dataset.i18n] || node.dataset.english) : node.dataset.english;
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
function temperature(value) {
  return value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) + '\u00b0C' : 'N/A';
}
function metric(type) {
  if (!stats) return "--";
  if (type === "cpu") return stats.cpuPercent + "%";
  if (type === "ram") return stats.memoryPercent + "%";
  if (type === "gpu") return stats.gpu?.percent == null ? "N/A" : stats.gpu.percent + "%";
  return uptime(stats.uptime);
}
function taskHtml(element, page = 0) {
  const tasks = settings.todos.filter((task) => !task.done),visible=window.JUNGLE_CALENDAR.pageItems(tasks,element.maxItems||4,page).items;
  return visible.length ? visible.map((task) => '<li><span class="list-text-viewport"><span class="list-text">' + esc(task.title) + "</span></span></li>").join("") : '<li><span class="list-text-viewport"><span class="list-text">' + esc(tr("done")) + "</span></span></li>";
}
function resetTime(epoch) {
  if (!Number.isFinite(Number(epoch))) return "--";
  return new Intl.DateTimeFormat(settings.language === "vi" ? "vi-VN" : "en-GB", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(Number(epoch) * 1000));
}
function agentProviderKey(element) { return element.type==="claude"?"claude":"codex"; }
function agentQuota(element) {
  const key=agentProviderKey(element),provider=agentSnapshot?.providers?.[key],values=[];
  if(key==="codex"){
    if(provider?.quota?.primary?.usedPercent!=null)values.push({label:"5H",value:Math.round(provider.quota.primary.usedPercent)+"%"});
    if(provider?.quota?.secondary?.usedPercent!=null)values.push({label:"7D",value:Math.round(provider.quota.secondary.usedPercent)+"%"});
  }else{
    if(provider?.quota?.fiveHour?.usedPercent!=null)values.push({label:"5H",value:Math.round(provider.quota.fiveHour.usedPercent)+"%"});
    if(provider?.quota?.sevenDay?.usedPercent!=null)values.push({label:"7D",value:Math.round(provider.quota.sevenDay.usedPercent)+"%"});
  }
  return {status:provider?.connected?"connected":"offline",values,text:provider?.available?"NO QUOTA":"OFFLINE"};
}
function agentRows(element) {
  const key=agentProviderKey(element);
  return (agentSnapshot?.tasks||[]).filter((task)=>task.provider===key).map((task)=>({status:task.status,text:(task.status==="running"?"\u25cf":task.status==="completed"?"\u2713":"\u25cb")+" "+task.title}));
}
function agentQuotaHtml(element) {
  const quota=agentQuota(element),content=quota.values.length?quota.values.map((item)=>'<span><small>'+esc(item.label)+'</small><b>'+esc(item.value)+'</b></span>').join(""):'<strong>'+esc(quota.text)+'</strong>';
  return '<div class="agent-quota '+esc(quota.status)+'">'+content+'</div>';
}
function agentHtml(element,page=0) {
  const items=agentRows(element).slice(0,8);
  return items.length?items.map((item)=>'<li class="agent-row '+esc(item.status)+'"><span class="list-text-viewport"><span class="list-text">'+esc(item.text)+'</span></span></li>').join(""):'<li class="agent-row empty"><span class="list-text-viewport"><span class="list-text">NO TASKS</span></span></li>';
}
function calendarOccurrences(days = 90, limit = 200) {
  return window.JUNGLE_CALENDAR.listOccurrences(settings.events || [], new Date(), days, limit);
}
function eventRepeatLabel(event) {
  return event.repeat && event.repeat !== "none" ? tr("repeat" + event.repeat[0].toUpperCase() + event.repeat.slice(1)) : "";
}
function occurrenceDay(occurrence, compact = false) {
  if (occurrence.daysFromToday === 0) return tr("todayShort");
  if (occurrence.daysFromToday === 1) return tr("tomorrow");
  return new Intl.DateTimeFormat(settings.language === "vi" ? "vi-VN" : "en-GB", compact ? {day:"2-digit",month:"2-digit"} : {weekday:"short",day:"2-digit",month:"short"}).format(occurrence.date);
}
function calendarHtml(element, page = 0) {
  const occurrences=calendarOccurrences(90,200),items=window.JUNGLE_CALENDAR.pageItems(occurrences,element.maxItems||4,page).items;
  return items.length ? items.map((occurrence)=>'<li><span class="calendar-when">'+esc(occurrenceDay(occurrence,true))+(occurrence.event.time?" · "+esc(occurrence.event.time):"")+'</span><span class="list-text-viewport"><span class="list-text">'+esc(occurrence.event.title)+'</span></span></li>').join("") : '<li><span class="list-text-viewport"><span class="list-text">'+esc(tr("noEvents"))+"</span></span></li>";
}
function editorMediaActive() {
  return document.visibilityState !== 'hidden' && document.querySelector('.nav.active')?.dataset.panel === 'canvas';
}
function syncEditorMedia() {
  const enabled = editorMediaActive();
  const changed = enabled !== editorMediaEnabledState;
  editorMediaEnabledState = enabled;
  if (enabled && !changed) return;
  document.querySelectorAll('#layout-canvas .canvas-element').forEach((node) => {
    const element = activeDisplay().canvas.elements.find((item) => item.id === node.dataset.elementId);
    if (!element || !['video','youtube','image'].includes(element.type)) return;
    if (enabled) {
      styleElement(node,element,true);
      return;
    }
    window.JUNGLE_YOUTUBE.unwatch(node);
    const media = node.querySelector('video,img,iframe');
    media?.pause?.();
    media?.removeAttribute('src');
    media?.load?.();
  });
}
function elementHtml(element, page = 0) {
  const label = element.title ? '<span class="element-label">' + esc(element.title) + "</span>" : "";
  if (element.type === "video") return element.source ? '<video src="' + esc(mediaUrl(element.source)) + '" autoplay loop muted playsinline style="object-fit:' + element.fit + '"></video>' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  if (element.type === "youtube") {
    const id = youtubeId(element.source);
    return id ? '<iframe data-youtube-id="' + esc(id) + '" src="' + esc(window.JUNGLE_YOUTUBE.embedUrl(id)) + '" loading="eager" allow="autoplay; encrypted-media"></iframe>' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  }
  if (element.type === "image") return element.source ? '<img src="' + esc(mediaUrl(element.source)) + '" style="object-fit:' + element.fit + '">' : '<div class="element-content">' + label + '<b class="element-value">' + tr("source") + "</b></div>";
  if (element.type === "shape") return '<div class="element-content"></div>';
  if (element.type === "tasks") return '<div class="element-content element-tasks">' + label + "<ol>" + taskHtml(element,page) + "</ol></div>";
  if (element.type === "calendar") return '<div class="element-content element-calendar">' + label + "<ol>" + calendarHtml(element,page) + "</ol></div>";
  if (["codex","claude"].includes(element.type)) return '<div class="element-content element-agent">' + label + agentQuotaHtml(element) + "<ol>" + agentHtml(element,page) + "</ol></div>";
  if (element.type === "text") return '<div class="element-content">' + label + '<b class="element-value element-date">' + esc(element.text) + "</b></div>";
  if (element.type === "clock") return '<div class="element-content">' + label + '<b class="element-value" data-dynamic="clock">' + nowInfo().time + "</b></div>";
  if (element.type === "date") return '<div class="element-content">' + label + '<b class="element-value element-date" data-dynamic="date">' + esc(nowInfo().date) + "</b></div>";
  if (["cpu","gpu"].includes(element.type)) {
    const usage = element.showUsage !== false ? '<b class="element-value" data-dynamic="' + element.type + '">' + metric(element.type) + '</b>' : '';
    const hardwareTemperature = element.showTemperature !== false ? '<b class="element-value" data-temperature="' + element.type + '">' + temperature(element.type === "cpu" ? stats?.cpuTemperature : stats?.gpu?.temperature) + '</b>' : '';
    return '<div class="element-content">' + label + usage + hardwareTemperature + '</div>';
  }
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
function contentSignature(element) {
  const signature=[element.type,element.title,element.text,element.source,element.maxItems,element.showUsage,element.showTemperature];if(element.type==="tasks")signature.push(settings.todos);if(element.type==="calendar")signature.push(settings.events,window.JUNGLE_CALENDAR.dateKey(new Date()),settings.language);if(["codex","claude"].includes(element.type))signature.push(agentSnapshot,settings.language);if(["video","youtube","image"].includes(element.type)&&!element.source)signature.push(settings.language);return JSON.stringify(signature);
}
function resolvedLabelStyle(element) {
  const scale = ["tasks","calendar","codex","claude","uptime"].includes(element.type) ? 1.52 : .38;
  return {
    color: element.labelColor || element.color,
    fontSize: Number.isFinite(Number(element.labelFontSize)) ? Number(element.labelFontSize) : element.fontSize * scale,
    strokeColor: element.labelStrokeColor || element.textStrokeColor || "#000000",
    strokeWidth: Number.isFinite(Number(element.labelStrokeWidth)) ? Number(element.labelStrokeWidth) : (element.textStrokeWidth || 0)
  };
}
function typographyStyle(element, kind) {
  if (kind === "label") {
    const label=resolvedLabelStyle(element);
    return {color:label.color,fontSize:label.fontSize,strokeColor:label.strokeColor,strokeWidth:label.strokeWidth};
  }
  return {color:element.color,fontSize:element.fontSize,strokeColor:element.textStrokeColor||"#000000",strokeWidth:element.textStrokeWidth||0};
}
function refreshTypographyClipboardButtons() {
  ["paste-content-style","paste-label-style"].forEach((id)=>$(id).disabled=!typographyClipboard);
}
function copyTypographyStyle(kind) {
  const element=selected();if(!element)return;
  typographyClipboard={...typographyStyle(element,kind)};
  refreshTypographyClipboardButtons();toast(tr("styleCopied"));
}
function pasteTypographyStyle(kind) {
  const element=selected();if(!element||!typographyClipboard)return;
  const style={...typographyClipboard};
  if(kind==="label"){
    element.labelColor=style.color;element.labelFontSize=Math.round(clamp(style.fontSize,4,400,28)*10)/10;element.labelStrokeColor=style.strokeColor;element.labelStrokeWidth=Math.round(clamp(style.strokeWidth,0,30,0)*10)/10;
  }else{
    element.color=style.color;element.fontSize=Math.round(clamp(style.fontSize,6,300,28)*10)/10;element.textStrokeColor=style.strokeColor;element.textStrokeWidth=Math.round(clamp(style.strokeWidth,0,30,0)*10)/10;
  }
  updateElementNode(element,false);renderInspector();queueSave();toast(tr("stylePasted"));
}
function styleElementLabel(node, element) {
  const label=node.querySelector(".element-label");if(!label)return;
  const style=resolvedLabelStyle(element);
  Object.assign(label.style,{color:style.color,fontSize:style.fontSize+"px",WebkitTextStrokeColor:style.strokeColor,WebkitTextStrokeWidth:style.strokeWidth+"px",paintOrder:"stroke fill"});
}
function styleElement(node, element, refreshContent = true) {
  if (refreshContent) window.JUNGLE_YOUTUBE.unwatch(node);
  Object.assign(node.style,{left:element.x+"px",top:element.y+"px",width:element.width+"px",height:element.height+"px",zIndex:element.z,color:element.color,backgroundColor:element.background,fontSize:element.fontSize+"px",WebkitTextStrokeColor:element.textStrokeColor||"#000000",WebkitTextStrokeWidth:(element.textStrokeWidth||0)+"px",paintOrder:"stroke fill",opacity:element.opacity,borderRadius:element.radius+"px"});
  if (refreshContent) { node.innerHTML = elementHtml(element,Number(node.dataset.listPage)||0) + '<i class="resize-handle"></i>';node.dataset.contentSignature=contentSignature(element); }
  styleElementLabel(node,element);
  const media = node.querySelector("video,img,iframe");if(media){media.style.objectFit=element.fit;media.style.transform="scale("+(element.mediaScale||1)+")";}
  if(element.type==="youtube")window.JUNGLE_YOUTUBE.watch(node);
  if (refreshContent) node.querySelector("video")?.play().catch(()=>{});
  if(["tasks","calendar"].includes(element.type))scheduleWidgetListMotion(node,element);
  if(["codex","claude"].includes(element.type))scheduleAgentTaskLayout(node);
}
function createElementNode(element) {
  const node=document.createElement("div");node.className="canvas-element "+element.type+(selectedElementIds.has(element.id)?" selected":"");node.dataset.elementId=element.id;node.dataset.type=element.type;styleElement(node,element);return node;
}
function updateElementNode(element, refreshContent = false) {
  const node=$("layout-canvas").querySelector('[data-element-id="'+CSS.escape(element.id)+'"]');if(node)styleElement(node,element,refreshContent);return node;
}
function rotatingItemCount(element) {
  if(element.type==="tasks")return settings.todos.filter((task)=>!task.done).length;
  if(element.type==="calendar")return calendarOccurrences(90,200).length;
  return 0;
}
function scheduleAgentTaskLayout(node) {
  const version=String((Number(node.dataset.agentLayoutVersion)||0)+1);node.dataset.agentLayoutVersion=version;requestAnimationFrame(()=>{if(node.isConnected&&node.dataset.agentLayoutVersion===version)layoutAgentTaskRows(node);});
}
function layoutAgentTaskRows(node) {
  const list=node.querySelector(".element-agent ol"),rows=[...(list?.children||[])];if(!list||!rows.length)return;rows.forEach((row)=>{row.hidden=false;row.querySelector(".list-text")?.removeAttribute("style");});list.style.removeProperty("grid-template-rows");const rowStyle=getComputedStyle(rows[0]),font=parseFloat(rowStyle.fontSize)||12,line=parseFloat(rowStyle.lineHeight)||font*1.15,padding=(parseFloat(rowStyle.paddingTop)||0)+(parseFloat(rowStyle.paddingBottom)||0),minimum=Math.ceil(line+padding+2),gap=parseFloat(getComputedStyle(list).rowGap)||0,capacity=Math.max(1,Math.min(rows.length,Math.floor((list.clientHeight+gap)/(minimum+gap))||1));rows.forEach((row,index)=>row.hidden=index>=capacity);list.style.gridTemplateRows="repeat("+capacity+", minmax("+minimum+"px, 1fr))";list.dataset.visibleRows=String(capacity);
}
function scheduleWidgetListMotion(node,element) {
  const version=String((Number(node.dataset.motionVersion)||0)+1);node.dataset.motionVersion=version;requestAnimationFrame(()=>{if(node.isConnected&&node.dataset.motionVersion===version)prepareWidgetListMotion(node,element);});
}
function prepareWidgetListMotion(node,element) {
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,allowMarquee=element.type!=="codex",longest=[...node.querySelectorAll(".list-text")].reduce((maximum,target)=>{target.classList.remove("is-overflowing");target.style.removeProperty("--marquee-distance");target.style.removeProperty("--marquee-duration");if(reduced||!allowMarquee)return maximum;const distance=Math.max(0,target.scrollWidth-target.clientWidth);if(distance<2)return maximum;const duration=window.JUNGLE_CALENDAR.marqueeDuration(distance);target.style.setProperty("--marquee-distance",-distance+"px");target.style.setProperty("--marquee-duration",duration+"ms");void target.offsetWidth;target.classList.add("is-overflowing");return Math.max(maximum,duration);},0),pageCount=Math.max(1,Math.ceil(rotatingItemCount(element)/(element.maxItems||4)));node.dataset.nextListAt=pageCount>1||longest>0?String(Date.now()+longest+3500):"0";
}
function advanceWidgetLists() {
  const now=Date.now();document.querySelectorAll("#layout-canvas .canvas-element.tasks, #layout-canvas .canvas-element.calendar").forEach((node)=>{const due=Number(node.dataset.nextListAt)||0;if(!due||now<due)return;const element=activeDisplay().canvas.elements.find((item)=>item.id===node.dataset.elementId);if(!element)return;const pageCount=Math.max(1,Math.ceil(rotatingItemCount(element)/(element.maxItems||4))),current=(Number(node.dataset.listPage)||0)%pageCount,next=pageCount>1?(current+1)%pageCount:current;node.dataset.listPage=next;styleElement(node,element,true);if(next!==current){node.classList.remove("list-advancing");void node.offsetWidth;node.classList.add("list-advancing");setTimeout(()=>node.classList.remove("list-advancing"),450);}});
}
function refreshCanvasSelection() {
  document.querySelectorAll(".canvas-element").forEach((node)=>node.classList.toggle("selected",selectedElementIds.has(node.dataset.elementId)));renderInspector();
}
function renderCanvas() {
  requestAnimationFrame(syncEditorMedia);
  const display = activeDisplay(), canvas = display.canvas, stage = $("layout-canvas");
  $("canvas-name").textContent = display.name; $("canvas-size").textContent = display.profile.width + " x " + display.profile.height;
  $("canvas-background").value = canvas.background; $("canvas-background-image").value = canvas.backgroundImage || "";
  stage.style.backgroundColor = canvas.background;
  const bg = canvas.backgroundImage ? mediaUrl(canvas.backgroundImage).replaceAll('"',"%22") : "";
  stage.style.backgroundImage = bg ? 'url("' + bg + '")' : "none"; stage.style.backgroundSize = "cover"; stage.style.backgroundPosition = "center";
  const validIds = new Set(canvas.elements.map((element) => element.id));
  canvas.elements.forEach((element)=>{let node=stage.querySelector('[data-element-id="'+CSS.escape(element.id)+'"]');if(!node){node=createElementNode(element);stage.appendChild(node);}else styleElement(node,element,node.dataset.contentSignature!==contentSignature(element));});
  stage.querySelectorAll(".canvas-element").forEach((node)=>{if(!validIds.has(node.dataset.elementId))node.remove();});
  selectedElementIds = new Set([...selectedElementIds].filter((id) => validIds.has(id)));
  if (!validIds.has(selectedElementId)) selectedElementId = selectedElementIds.values().next().value || null;
  requestAnimationFrame(scaleCanvas); renderInspector();
}
function selected() { return activeDisplay().canvas.elements.find((item) => item.id === selectedElementId); }
function selectedElements() { return activeDisplay().canvas.elements.filter((item) => selectedElementIds.has(item.id)); }
function clearSelection() { selectedElementId = null; selectedElementIds.clear(); }
function renderInspector() {
  const element = selected();
  $("inspector-empty").hidden = Boolean(element); $("inspector-fields").hidden = !element;
  refreshTypographyClipboardButtons();
  if (!element) return;
  const transparent = element.background === "transparent";
  const values = {"prop-title":element.title,"prop-text":element.text,"prop-source":element.source,"prop-x":element.x,"prop-y":element.y,"prop-width":element.width,"prop-height":element.height,"prop-color":element.color,"prop-background":transparent?"#102832":element.background,"prop-font-size":element.fontSize,"prop-stroke-color":element.textStrokeColor||"#000000","prop-stroke-width":element.textStrokeWidth||0,"prop-label-color":resolvedLabelStyle(element).color,"prop-label-font-size":resolvedLabelStyle(element).fontSize,"prop-label-stroke-color":resolvedLabelStyle(element).strokeColor,"prop-label-stroke-width":resolvedLabelStyle(element).strokeWidth,"prop-radius":element.radius,"prop-opacity":Math.round(element.opacity*100),"prop-fit":element.fit,"prop-media-scale":Math.round((element.mediaScale||1)*100),"prop-max-items":element.maxItems};
  Object.entries(values).forEach(([id,value]) => $(id).value = value);
  $("prop-background-transparent").checked = transparent;
  $("prop-show-usage").checked = element.showUsage !== false;
  $("prop-show-temperature").checked = element.showTemperature !== false;
  $("prop-background").disabled = transparent;
  $("prop-type").textContent = element.type.toUpperCase();
  $("prop-selection-count").textContent = selectedElementIds.size > 1 ? tr("multiSelected",{count:selectedElementIds.size}) : element.id;
  $("prop-opacity-value").textContent = Math.round(element.opacity*100) + "%";$("prop-media-scale-value").textContent=Math.round((element.mediaScale||1)*100)+"%";

  const textTypes = ["text","clock","date","cpu","ram","gpu","uptime","tasks","calendar","codex","claude"];
  const mediaTypes = ["video","youtube","image"];
  $("prop-title-row").hidden = !textTypes.includes(element.type);
  $("prop-hardware-content").hidden = !["cpu","gpu"].includes(element.type);
  $("prop-text-row").hidden = element.type !== "text";
  $("prop-source-row").hidden = !mediaTypes.includes(element.type);
  $("pick-source").hidden = element.type === "youtube";
  const isText = textTypes.includes(element.type);
  $("prop-content-style").hidden = !isText;
  $("prop-label-style").hidden = !isText;
  $("prop-fit-row").hidden = !["video","image"].includes(element.type);$("prop-media-tools").hidden=!mediaTypes.includes(element.type);
  $("prop-items-row").hidden = !["tasks","calendar"].includes(element.type);
  document.querySelectorAll('[data-arrange^="space-"]').forEach((button)=>button.disabled=selectedElementIds.size<3);
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
function eventCard(occurrence) {
  const event=occurrence.event,repeat=eventRepeatLabel(event),meta=[event.time||tr("allDay"),repeat].filter(Boolean).join(" · ");
  return '<article class="calendar-event"><time datetime="'+esc(occurrence.key)+'"><b>'+esc(occurrenceDay(occurrence))+'</b><span>'+esc(meta)+'</span></time><div><strong>'+esc(event.title)+'</strong><small>'+esc(occurrence.key)+'</small></div><button type="button" data-event-delete="'+esc(event.id)+'" title="'+esc(tr("deleteSeries"))+'">×</button></article>';
}
function storedEventDate(event, annual = false) {
  const source=annual?window.JUNGLE_CALENDAR.parseDateKey("2000-"+event.monthDay):window.JUNGLE_CALENDAR.parseDateKey(event.date);
  if(!source)return "";
  return new Intl.DateTimeFormat(settings.language==="vi"?"vi-VN":"en-GB",annual?{day:"2-digit",month:"long"}:{weekday:"short",day:"2-digit",month:"short",year:"numeric"}).format(source);
}
function masterEventCard(event) {
  const annual=event.repeat==="yearly",dateText=annual?tr("annualOn",{date:storedEventDate(event,true)}):tr("startsOn",{date:storedEventDate(event)}),repeat=eventRepeatLabel(event),until=event.repeatUntil?tr("repeatsUntil",{date:storedEventDate({date:event.repeatUntil})}):"",meta=[event.time||tr("allDay"),annual?dateText:[dateText,repeat].filter(Boolean).join(" · "),until].filter(Boolean).join(" · ");
  return '<article class="calendar-master"><div><strong>'+esc(event.title)+'</strong><small>'+esc(meta)+'</small></div><div class="calendar-master-actions"><button class="ghost" type="button" data-event-edit="'+esc(event.id)+'">'+esc(tr("editEvent"))+'</button><button class="danger-soft" type="button" data-event-delete="'+esc(event.id)+'">'+esc(tr("deleteEvent"))+'</button></div></article>';
}
function syncEventDateFields() {
  const annual=$("event-repeat").value==="yearly",repeating=$("event-repeat").value!=="none";
  $("event-date-row").hidden=annual;$("event-yearly-date-row").hidden=!annual;$("event-date").required=!annual;$("event-repeat-until-row").hidden=!repeating;
  if(!repeating)$("event-repeat-until").value="";
}
function syncAnnualDayLimit() {
  const month=Number($("event-yearly-month").value),max=new Date(2000,month,0).getDate();$("event-yearly-day").max=max;$("event-yearly-day").value=Math.min(max,Math.max(1,Number($("event-yearly-day").value)||1));
}
function renderEventFormState() {
  $("calendar-submit").textContent=tr(editingEventId?"updateReminder":"addReminder");$("cancel-event-edit").textContent=tr("cancel");$("cancel-event-edit").hidden=!editingEventId;
}
function resetEventForm() {
  editingEventId=null;$("event-title").value="";$("event-time").value="";$("event-repeat").value="none";$("event-repeat-until").value="";$("event-date").value=window.JUNGLE_CALENDAR.dateKey(new Date());const today=new Date();$("event-yearly-day").value=today.getDate();$("event-yearly-month").value=String(today.getMonth()+1).padStart(2,"0");syncAnnualDayLimit();syncEventDateFields();renderEventFormState();
}
function startEventEdit(id) {
  const event=settings.events.find((item)=>item.id===id);if(!event)return;editingEventId=id;$("event-title").value=event.title;$("event-date").value=event.date||window.JUNGLE_CALENDAR.dateKey(new Date());$("event-time").value=event.time||"";$("event-repeat").value=event.repeat;$("event-repeat-until").value=event.repeatUntil||"";const annual=event.monthDay||String(event.date||"").slice(5),parts=annual.split("-");if(parts.length===2){$("event-yearly-month").value=parts[0];$("event-yearly-day").value=Number(parts[1]);}syncAnnualDayLimit();syncEventDateFields();renderEventFormState();$("event-title").focus();
}
function renderCalendar() {
  const occurrences=calendarOccurrences(90,200),today=occurrences.filter((item)=>item.daysFromToday===0),upcoming=occurrences.filter((item)=>item.daysFromToday>0).slice(0,30);
  $("calendar-count").textContent=tr("eventCount",{count:(settings.events||[]).length});
  $("calendar-today-date").textContent=new Intl.DateTimeFormat(settings.language==="vi"?"vi-VN":"en-GB",{weekday:"long",day:"2-digit",month:"long"}).format(new Date());
  $("calendar-today-count").textContent=today.length;
  $("calendar-today-list").innerHTML=today.length?today.map(eventCard).join(""):'<div class="empty-state">'+esc(tr("noEvents"))+"</div>";
  $("calendar-upcoming-list").innerHTML=upcoming.length?upcoming.map(eventCard).join(""):'<div class="empty-state">'+esc(tr("noEvents"))+"</div>";
  $("calendar-all-list").innerHTML=(settings.events||[]).length?settings.events.slice().sort((a,b)=>a.title.localeCompare(b.title)).map(masterEventCard).join(""):'<div class="empty-state">'+esc(tr("noEvents"))+"</div>";
  if(!$("event-date").value)$("event-date").value=window.JUNGLE_CALENDAR.dateKey(new Date());
  renderEventFormState();
}
function renderSettings() {
  $("launch-at-login").checked=settings.startup.launchAtLogin; $("start-hidden").checked=settings.startup.startHidden; $("start-hidden").disabled=!settings.startup.launchAtLogin; $("auto-connect").checked=settings.startup.autoConnect; $("auto-reconnect").checked=settings.startup.autoReconnect;
  $("reconnect-delay").value=settings.startup.reconnectDelay; $("open-preview").checked=settings.startup.openPreview;
}
function providerSummary(provider, quotaText) {
  if (provider?.connected) return quotaText || "CONNECTED";
  if (provider?.available) return "AVAILABLE \u00b7 NO LIVE DATA";
  return "NOT INSTALLED";
}
function renderAgentSettings() {
  const codex=agentSnapshot?.providers?.codex,claude=agentSnapshot?.providers?.claude,codexQuota=codex?.quota?.primary,claudeQuota=claude?.quota;
  $("codex-agent-status").textContent=providerSummary(codex,codexQuota?.usedPercent!=null?Math.round(codexQuota.usedPercent)+"% \u00b7 "+resetTime(codexQuota.resetsAt):"");
  const claudeParts=[];if(claudeQuota?.fiveHour?.usedPercent!=null)claudeParts.push("5H "+Math.round(claudeQuota.fiveHour.usedPercent)+"%");if(claudeQuota?.sevenDay?.usedPercent!=null)claudeParts.push("7D "+Math.round(claudeQuota.sevenDay.usedPercent)+"%");
  $("claude-agent-status").textContent=providerSummary(claude,claudeParts.join(" \u00b7 "));
  $("agent-task-count").textContent=String(agentSnapshot?.tasks?.length||0);
}
function updateDynamic() {
  const now=nowInfo(); $("clock").textContent=new Date().toLocaleTimeString(settings.language==="vi"?"vi-VN":"en-GB");
  const calendarDate=window.JUNGLE_CALENDAR.dateKey(new Date());if(lastCalendarDate&&lastCalendarDate!==calendarDate){renderCanvas();renderCalendar();}lastCalendarDate=calendarDate;
  if(stats){$("cpu-stat").textContent=stats.cpuPercent+"%";$("cpu-name").textContent=temperature(stats.cpuTemperature)+" | "+stats.cpu;$("ram-stat").textContent=stats.memoryPercent+"%";$("ram-detail").textContent=stats.memoryUsedGb+" / "+stats.memoryTotalGb+" GB";$("gpu-stat").textContent=stats.gpu?.percent==null?"N/A":stats.gpu.percent+"%";$("gpu-name").textContent=temperature(stats.gpu?.temperature)+" | "+(stats.gpu?.name||"GPU unavailable");}
  document.querySelectorAll("[data-dynamic]").forEach((node)=>node.textContent=node.dataset.dynamic==="clock"?now.time:node.dataset.dynamic==="date"?now.date:metric(node.dataset.dynamic));
  document.querySelectorAll("[data-temperature]").forEach((node)=>node.textContent=temperature(node.dataset.temperature==="cpu"?stats?.cpuTemperature:stats?.gpu?.temperature));
  const status=["connecting","streaming","error"].includes(deviceState?.status)?deviceState.status:"disconnected", side=document.querySelector(".sidebar-foot");
  side.className="sidebar-foot "+status;$("sidebar-status").textContent=tr(status)+(deviceState?.portPath?" · "+deviceState.portPath:"");$("stream-stat").textContent=(deviceState?.fps||0)+" FPS";$("frame-detail").textContent=deviceState?.frameBytes?Math.round(deviceState.frameBytes/1000)+" KB/frame":"--";
}
function renderAll(){ $("language").value=settings.language;applyLanguage();renderOptions();renderDevices();renderCanvas();renderDisplayForm();renderTasks();renderCalendar();renderSettings();renderAgentSettings();updateDynamic(); }
async function saveRefresh(message){clearTimeout(saveTimer);const revision=++saveRevision,saved=await window.jungle.saveSettings(structuredClone(settings));if(revision!==saveRevision)return;settings=saved;renderAll();if(message)toast(message);}
function queueSave(){ $("save-indicator").textContent=tr("saving");clearTimeout(saveTimer);const revision=++saveRevision,snapshot=structuredClone(settings);saveTimer=setTimeout(async()=>{const saved=await window.jungle.saveSettings(snapshot);if(revision!==saveRevision)return;settings=saved;$("save-indicator").textContent=tr("saved");},450); }
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
  const display=activeDisplay(),p=display.profile,large=["video","youtube","image","tasks","calendar","codex","claude"].includes(type),w=Math.min(p.width,large?Math.max(240,Math.round(p.width*.46)):Math.max(150,Math.round(p.width*.23)));
  const h=Math.min(p.height,["video","youtube","image"].includes(type)?Math.max(140,Math.round(p.height*.42)):["tasks","calendar","codex","claude"].includes(type)?Math.max(160,Math.round(p.height*.55)):Math.max(80,Math.round(p.height*.23)));
  const labels={cpu:"CPU",ram:"RAM",gpu:"GPU",uptime:"UPTIME",tasks:"TASKS",calendar:"CALENDAR",codex:"CODEX",claude:"CLAUDE CODE",clock:"TIME",date:"DATE"},fontSize=type==="clock"?52:28,labelScale=["tasks","calendar","codex","claude","uptime"].includes(type)?1.52:.38;
  return{id:type+"-"+Date.now().toString(36),type,x:Math.max(0,Math.round((p.width-w)/2)),y:Math.max(0,Math.round((p.height-h)/2)),width:w,height:h,color:"#effaf5",background:type==="shape"?"#62edab":"#102832",fontSize,textStrokeColor:"#000000",textStrokeWidth:0,labelColor:"#effaf5",labelFontSize:Math.round(fontSize*labelScale*10)/10,labelStrokeColor:"#000000",labelStrokeWidth:0,opacity:1,radius:12,fit:"cover",mediaScale:1,z:Math.max(0,...display.canvas.elements.map((item)=>item.z))+1,title:labels[type]||"",text:type==="text"?"Your text":"",source:"",maxItems:4,showUsage:true,showTemperature:true};
}
function arrangeSelection(mode){
  const items=selectedElements();if(!items.length)return;
  const p=activeDisplay().profile;
  const bounds={left:Math.min(...items.map((e)=>e.x)),top:Math.min(...items.map((e)=>e.y)),right:Math.max(...items.map((e)=>e.x+e.width)),bottom:Math.max(...items.map((e)=>e.y+e.height))};
  if(mode==="space-x"&&items.length>=3){
    const sorted=items.slice().sort((a,b)=>a.x-b.x),gap=(bounds.right-bounds.left-sorted.reduce((sum,e)=>sum+e.width,0))/(sorted.length-1);let x=bounds.left;
    sorted.forEach((e)=>{e.x=Math.round(x);x+=e.width+gap;});
  }else if(mode==="space-y"&&items.length>=3){
    const sorted=items.slice().sort((a,b)=>a.y-b.y),gap=(bounds.bottom-bounds.top-sorted.reduce((sum,e)=>sum+e.height,0))/(sorted.length-1);let y=bounds.top;
    sorted.forEach((e)=>{e.y=Math.round(y);y+=e.height+gap;});
  }else if(!mode.startsWith("space-")){
    const frame=items.length===1?{left:0,top:0,right:p.width,bottom:p.height}:bounds;
    items.forEach((e)=>{
      if(mode==="left")e.x=frame.left;
      if(mode==="center-x")e.x=Math.round((frame.left+frame.right-e.width)/2);
      if(mode==="right")e.x=frame.right-e.width;
      if(mode==="top")e.y=frame.top;
      if(mode==="center-y")e.y=Math.round((frame.top+frame.bottom-e.height)/2);
      if(mode==="bottom")e.y=frame.bottom-e.height;
      e.x=Math.round(clamp(e.x,0,p.width-e.width,0));e.y=Math.round(clamp(e.y,0,p.height-e.height,0));
    });
  }
  items.forEach((element)=>updateElementNode(element));renderInspector();queueSave();
}
function inspectorChange(event){
  const e=selected();if(!e)return;const p=activeDisplay().profile;
  const oldWidth=e.width,oldHeight=e.height,oldFont=e.fontSize,oldRadius=e.radius,oldStroke=e.textStrokeWidth||0,oldLabelFont=resolvedLabelStyle(e).fontSize,oldLabelStroke=resolvedLabelStyle(e).strokeWidth;
  e.title=$("prop-title").value;e.text=$("prop-text").value;e.source=$("prop-source").value;
  e.width=Math.round(clamp($("prop-width").value,40,p.width,e.width));e.height=Math.round(clamp($("prop-height").value,32,p.height,e.height));
  if(event && ["prop-width","prop-height"].includes(event.target.id) && !["codex","claude"].includes(e.type)){
    const ratio=Math.sqrt((e.width*e.height)/(oldWidth*oldHeight));
    $("prop-font-size").value=Math.round(clamp(oldFont*ratio,6,300,oldFont));
    $("prop-radius").value=Math.round(clamp(oldRadius*ratio,0,200,oldRadius));$("prop-stroke-width").value=Math.round(clamp(oldStroke*ratio,0,30,oldStroke)*10)/10;$("prop-label-font-size").value=Math.round(clamp(oldLabelFont*ratio,4,400,oldLabelFont)*10)/10;$("prop-label-stroke-width").value=Math.round(clamp(oldLabelStroke*ratio,0,30,oldLabelStroke)*10)/10;
  }
  e.x=Math.round(clamp($("prop-x").value,0,p.width-e.width,e.x));e.y=Math.round(clamp($("prop-y").value,0,p.height-e.height,e.y));e.color=$("prop-color").value;e.background=$("prop-background-transparent").checked?"transparent":$("prop-background").value;$("prop-background").disabled=$("prop-background-transparent").checked;
  e.fontSize=Math.round(clamp($("prop-font-size").value,6,300,e.fontSize));e.textStrokeColor=$("prop-stroke-color").value;e.textStrokeWidth=Math.round(clamp($("prop-stroke-width").value,0,30,e.textStrokeWidth||0)*10)/10;e.labelColor=$("prop-label-color").value;e.labelFontSize=Math.round(clamp($("prop-label-font-size").value,4,400,resolvedLabelStyle(e).fontSize)*10)/10;e.labelStrokeColor=$("prop-label-stroke-color").value;e.labelStrokeWidth=Math.round(clamp($("prop-label-stroke-width").value,0,30,resolvedLabelStyle(e).strokeWidth)*10)/10;e.radius=Math.round(clamp($("prop-radius").value,0,200,e.radius));e.opacity=clamp($("prop-opacity").value/100,.05,1,1);e.fit=$("prop-fit").value;e.mediaScale=clamp($("prop-media-scale").value/100,.5,4,1);e.maxItems=Math.round(clamp($("prop-max-items").value,1,20,4));
  const refreshContent=["prop-title","prop-text","prop-source","prop-max-items"].includes(event?.target?.id);updateElementNode(e,refreshContent);$("prop-opacity-value").textContent=Math.round(e.opacity*100)+"%";$("prop-media-scale-value").textContent=Math.round(e.mediaScale*100)+"%";queueSave();
}
function setHardwareContentOption(property, checked) {
  const element=selected();if(!element||!["cpu","gpu"].includes(element.type))return;
  const before=Number(element.showUsage!==false)+Number(element.showTemperature!==false);
  element[property]=checked;
  const after=Number(element.showUsage!==false)+Number(element.showTemperature!==false);
  const rowHeight=Math.max(12,Math.round(element.fontSize*.95)),profile=activeDisplay().profile;
  element.height=Math.round(clamp(element.height+(after-before)*rowHeight,32,profile.height-element.y,element.height));
  $("prop-height").value=element.height;updateElementNode(element,true);renderInspector();queueSave();
}
async function chooseDisplay(id){if(!settings.displays.some((item)=>item.id===id))return;settings.activeDisplayId=id;clearSelection();await saveRefresh(tr("saved"));}
function bind(){
  document.addEventListener('visibilitychange',syncEditorMedia);
  document.addEventListener('click',(event)=>{if(event.target.closest('.nav'))syncEditorMedia();});
  document.querySelectorAll(".nav").forEach((button)=>button.onclick=()=>{document.querySelectorAll(".nav").forEach((item)=>item.classList.toggle("active",item===button));document.querySelectorAll(".panel").forEach((panel)=>panel.classList.toggle("active",panel.id===button.dataset.panel));if(button.dataset.panel==="canvas")requestAnimationFrame(scaleCanvas);});
  $("language").onchange=async(e)=>{settings.language=e.target.value;await saveRefresh(tr("saved"));};$("scan-devices").onclick=scan;$("scan-display").onclick=scan;$("preview-main").onclick=$("preview-canvas").onclick=()=>window.jungle.openPreview();
  $("canvas-display-select").onchange=$("config-display-select").onchange=(e)=>chooseDisplay(e.target.value);$("canvas-zoom").onchange=scaleCanvas;window.addEventListener("resize",()=>requestAnimationFrame(scaleCanvas));
  $("device-grid").onclick=async(e)=>{const select=e.target.closest("[data-select-display]");if(select)return chooseDisplay(select.dataset.selectDisplay);const connect=e.target.closest("[data-connect-display]");if(!connect)return;const id=connect.dataset.connectDisplay;if(deviceState?.status==="streaming"&&deviceState.displayId===id)deviceState=await window.jungle.disconnectDevice();else{settings.activeDisplayId=id;settings=await window.jungle.saveSettings(settings);const display=activeDisplay(),device=matchDevice(display);deviceState=await window.jungle.connectDevice({displayId:id,path:device?.path||display.portPath});}renderAll();};
  document.querySelectorAll("[data-add]").forEach((button)=>button.onclick=()=>{const e=newElement(button.dataset.add);activeDisplay().canvas.elements.push(e);selectedElementId=e.id;selectedElementIds=new Set([e.id]);renderCanvas();queueSave();});
  $("layout-canvas").onpointerdown=(event)=>{
    const node=event.target.closest(".canvas-element");
    if(!node){clearSelection();refreshCanvasSelection();return;}
    const id=node.dataset.elementId;
    if(event.shiftKey&&selectedElementIds.has(id)){
      selectedElementIds.delete(id);if(selectedElementId===id)selectedElementId=selectedElementIds.values().next().value||null;refreshCanvasSelection();event.preventDefault();return;
    }
    if(event.shiftKey)selectedElementIds.add(id);else if(!selectedElementIds.has(id))selectedElementIds=new Set([id]);
    selectedElementId=id;const e=selected();refreshCanvasSelection();
    const items=selectedElements(),bounds={left:Math.min(...items.map((item)=>item.x)),top:Math.min(...items.map((item)=>item.y)),right:Math.max(...items.map((item)=>item.x+item.width)),bottom:Math.max(...items.map((item)=>item.y+item.height))};
    dragState={id:e.id,mode:event.target.classList.contains("resize-handle")?"resize":"move",startX:event.clientX,startY:event.clientY,bounds,items:items.map((item)=>({id:item.id,x:item.x,y:item.y})),original:{x:e.x,y:e.y,width:e.width,height:e.height,fontSize:e.fontSize,labelFontSize:resolvedLabelStyle(e).fontSize,radius:e.radius,textStrokeWidth:e.textStrokeWidth||0,labelStrokeWidth:resolvedLabelStyle(e).strokeWidth}};event.preventDefault();
  };
  document.addEventListener("pointermove",(event)=>{
    if(!dragState)return;const e=selected();if(!e||e.id!==dragState.id)return;const p=activeDisplay().profile,rawDx=(event.clientX-dragState.startX)/canvasScale,rawDy=(event.clientY-dragState.startY)/canvasScale;
    if(dragState.mode==="move"){
      const dx=Math.round(clamp(rawDx,-dragState.bounds.left,p.width-dragState.bounds.right,0)),dy=Math.round(clamp(rawDy,-dragState.bounds.top,p.height-dragState.bounds.bottom,0));
      dragState.items.forEach((original)=>{const item=activeDisplay().canvas.elements.find((candidate)=>candidate.id===original.id);if(item){item.x=original.x+dx;item.y=original.y+dy;const node=$("layout-canvas").querySelector('[data-element-id="'+CSS.escape(item.id)+'"]');if(node)styleElement(node,item,false);}});
    }else{
      e.width=Math.round(clamp(dragState.original.width+rawDx,40,p.width-e.x,40));e.height=Math.round(clamp(dragState.original.height+rawDy,32,p.height-e.y,32));
      if(!["codex","claude"].includes(e.type)){
        const ratio=Math.sqrt((e.width*e.height)/(dragState.original.width*dragState.original.height));e.fontSize=Math.round(clamp(dragState.original.fontSize*ratio,6,300,dragState.original.fontSize));e.labelFontSize=Math.round(clamp(dragState.original.labelFontSize*ratio,4,400,dragState.original.labelFontSize)*10)/10;e.radius=Math.round(clamp(dragState.original.radius*ratio,0,200,dragState.original.radius));e.textStrokeWidth=Math.round(clamp(dragState.original.textStrokeWidth*ratio,0,30,dragState.original.textStrokeWidth)*10)/10;e.labelStrokeWidth=Math.round(clamp(dragState.original.labelStrokeWidth*ratio,0,30,dragState.original.labelStrokeWidth)*10)/10;$("prop-font-size").value=e.fontSize;$("prop-label-font-size").value=e.labelFontSize;$("prop-radius").value=e.radius;$("prop-stroke-width").value=e.textStrokeWidth;$("prop-label-stroke-width").value=e.labelStrokeWidth;
      }
      const node=$("layout-canvas").querySelector('[data-element-id="'+CSS.escape(e.id)+'"]');if(node)styleElement(node,e,false);
    }
    ["x","y","width","height"].forEach((key)=>$("prop-"+key).value=e[key]);
  });
  document.addEventListener("pointerup",()=>{if(dragState){dragState=null;queueSave();}});
  ["prop-title","prop-text","prop-x","prop-y","prop-width","prop-height","prop-color","prop-background","prop-background-transparent","prop-font-size","prop-stroke-color","prop-stroke-width","prop-label-color","prop-label-font-size","prop-label-stroke-color","prop-label-stroke-width","prop-radius","prop-opacity","prop-fit","prop-media-scale","prop-max-items"].forEach((id)=>$(id).oninput=inspectorChange);
  $("prop-source").onchange=inspectorChange;
  $("prop-show-usage").onchange=(event)=>setHardwareContentOption("showUsage",event.target.checked);
  $("prop-show-temperature").onchange=(event)=>setHardwareContentOption("showTemperature",event.target.checked);
  $("copy-content-style").onclick=()=>copyTypographyStyle("content");$("paste-content-style").onclick=()=>pasteTypographyStyle("content");
  $("copy-label-style").onclick=()=>copyTypographyStyle("label");$("paste-label-style").onclick=()=>pasteTypographyStyle("label");
  document.querySelectorAll("[data-arrange]").forEach((button)=>button.onclick=()=>arrangeSelection(button.dataset.arrange));
  $("media-fill-canvas").onclick=()=>{const e=selected();if(!e||!["video","youtube","image"].includes(e.type))return;const p=activeDisplay().profile;e.x=0;e.y=0;e.width=p.width;e.height=p.height;e.fit="cover";e.mediaScale=1;e.radius=0;updateElementNode(e,false);renderInspector();queueSave();};
  $("pick-source").onclick=async()=>{const e=selected();if(!e)return;const source=await window.jungle.pickMedia(e.type==="image"?"image":"video");if(source){e.source=source;renderCanvas();queueSave();}};
  $("canvas-background").oninput=(e)=>{activeDisplay().canvas.background=e.target.value;$("layout-canvas").style.backgroundColor=e.target.value;queueSave();};
  $("canvas-background-image").onchange=(e)=>{activeDisplay().canvas.backgroundImage=e.target.value;renderCanvas();queueSave();};
  $("pick-background").onclick=async()=>{const source=await window.jungle.pickMedia("image");if(source){activeDisplay().canvas.backgroundImage=source;renderCanvas();queueSave();}};
  $("clear-background").onclick=()=>{activeDisplay().canvas.backgroundImage="";renderCanvas();queueSave();};
  $("reset-layout").onclick=async()=>{delete activeDisplay().canvas;settings=await window.jungle.saveSettings(settings);clearSelection();renderAll();toast(tr("reset"));};
  $("delete-element").onclick=()=>{activeDisplay().canvas.elements=activeDisplay().canvas.elements.filter((e)=>!selectedElementIds.has(e.id));clearSelection();renderCanvas();queueSave();};
  $("duplicate-element").onclick=()=>{const e=selected();if(!e)return;const copy={...e,id:e.type+"-"+Date.now().toString(36),x:e.x+12,y:e.y+12,z:Math.max(...activeDisplay().canvas.elements.map((i)=>i.z))+1};activeDisplay().canvas.elements.push(copy);selectedElementId=copy.id;selectedElementIds=new Set([copy.id]);renderCanvas();queueSave();};
  $("bring-front").onclick=()=>{const e=selected();if(e){e.z=Math.max(...activeDisplay().canvas.elements.map((i)=>i.z))+1;renderCanvas();queueSave();}};
  $("send-back").onclick=()=>{const e=selected();if(e){e.z=Math.min(...activeDisplay().canvas.elements.map((i)=>i.z))-1;renderCanvas();queueSave();}};
  $("display-preset").onchange=(e)=>{if(e.target.value!=="custom"){const size=e.target.value.split("x");$("display-width").value=size[0];$("display-height").value=size[1];}};
  $("brightness").oninput=(e)=>$("brightness-value").textContent=e.target.value+"%";
  $("save-display").onclick=async()=>{const d=activeDisplay();d.name=$("display-name").value||"Jungle Display";d.portPath=$("port-select").value;d.profile={preset:$("display-preset").value,name:d.name,width:Number($("display-width").value),height:Number($("display-height").value),rotation:Number($("rotation").value)};d.brightness=Number($("brightness").value);d.maxFrameBytes=Number($("frame-limit").value)*1000;await saveRefresh(tr("saved"));};
  $("reset-profile").onclick=async()=>{const d=activeDisplay();d.profile={...d.detectedProfile};d.name=d.detectedProfile.name||d.name;await saveRefresh(tr("reset"));};
  $("task-form").onsubmit=async(e)=>{e.preventDefault();const input=$("task-input"),title=input.value.trim();if(!title)return;settings.todos.push({id:"task-"+Date.now().toString(36),title,done:false});input.value="";await saveRefresh(tr("saved"));};
  $("task-list").onchange=async(e)=>{const task=settings.todos.find((item)=>item.id===e.target.dataset.taskToggle);if(task){task.done=e.target.checked;await saveRefresh(tr("saved"));}};
  $("task-list").onclick=async(e)=>{if(e.target.dataset.taskDelete){settings.todos=settings.todos.filter((task)=>task.id!==e.target.dataset.taskDelete);await saveRefresh(tr("saved"));}};
  $("event-repeat").onchange=syncEventDateFields;$("event-yearly-month").onchange=syncAnnualDayLimit;$("event-yearly-day").oninput=syncAnnualDayLimit;$("cancel-event-edit").onclick=resetEventForm;
  $("calendar-form").onsubmit=async(e)=>{e.preventDefault();const title=$("event-title").value.trim(),repeat=$("event-repeat").value,annual=repeat==="yearly",monthDay=annual?$("event-yearly-month").value+"-"+String($("event-yearly-day").value).padStart(2,"0"):"",date=annual?"":$("event-date").value;if(!title||(!annual&&!date)||annual&&!window.JUNGLE_CALENDAR.validMonthDay(monthDay))return;const event={id:editingEventId||"event-"+Date.now().toString(36),title,date,monthDay,time:$("event-time").value,repeat,repeatUntil:$("event-repeat-until").value},index=settings.events.findIndex((item)=>item.id===editingEventId);if(index>=0)settings.events[index]=event;else settings.events.push(event);resetEventForm();await saveRefresh(tr("saved"));};
  const calendarListClick=async(e)=>{const editId=e.target.dataset.eventEdit,deleteId=e.target.dataset.eventDelete;if(editId)return startEventEdit(editId);if(!deleteId)return;settings.events=settings.events.filter((event)=>event.id!==deleteId);if(editingEventId===deleteId)resetEventForm();await saveRefresh(tr("saved"));};
  ["calendar-today-list","calendar-upcoming-list","calendar-all-list"].forEach((id)=>$(id).onclick=calendarListClick);
  $("launch-at-login").onchange=()=>{$("start-hidden").disabled=!$("launch-at-login").checked;};
  $("refresh-agents").onclick=async()=>{try{agentSnapshot=await window.jungle.refreshAgents();renderCanvas();renderAgentSettings();}catch{toast(tr("agentRefreshFailed"));}};
  $("configure-claude").onclick=async()=>{const result=await window.jungle.configureClaudeBridge();if(result?.ok)toast(tr("claudeBridgeEnabled"));else if(result?.reason==="existing-status-line")toast(tr("existingStatusLine"));else toast(tr("agentRefreshFailed"));};
  $("save-settings").onclick=async()=>{settings.startup={launchAtLogin:$("launch-at-login").checked,startHidden:$("start-hidden").checked,autoConnect:$("auto-connect").checked,autoReconnect:$("auto-reconnect").checked,reconnectDelay:Number($("reconnect-delay").value),openPreview:$("open-preview").checked};await saveRefresh(tr("saved"));};
  resetEventForm();
}
async function start(){
  [settings,stats,deviceState,agentSnapshot]=await Promise.all([window.jungle.getSettings(),window.jungle.getSystem(),window.jungle.getDeviceState(),window.jungle.getAgents()]);bind();renderAll();await scan().catch(()=>renderAll());
  setInterval(async()=>{stats=await window.jungle.getSystem();updateDynamic();},1000);
  setInterval(advanceWidgetLists,200);
  window.jungle.onDevice((next)=>{deviceState=next;renderDevices();updateDynamic();});
  window.jungle.onSettings((next)=>{settings=next;if(!dragState)renderAll();});
  window.jungle.onAgents((next)=>{agentSnapshot=next;renderCanvas();renderAgentSettings();});
}
start();
