// 导出回退链：本地 node server.js 有 POST save-json / save-png 端点；GitHub Pages 等纯静态站没有。
//
// 顺序：(a) POST 页面相对端点（2xx → 服务器返回 exports/ 路径）
//       (b) navigator.share({ files })   iPad Safari 15+：AirDrop 到 Mac，或存到「文件」App
//       (c) <a download> + Blob URL       iPad Safari 13+ 进「文件」App 的「下载」；桌面浏览器进「下载」文件夹
//       (d) 剪贴板；再不行返回 mode:'text'，由调用方在页面显示可全选的文本
//
// 端点判定——probeServer 与 exportBlob 共用同一套（serverSays）：
//   2xx                                   → 有服务器，成功
//   400 / 413 且响应体是 server.js 的原话     → 有服务器，但拒绝了这次请求（参数 / 超限）：如实报告，不回退
//   探测确认过有服务器（known===true）后再遇非 2xx → 服务器侧问题（500 等）：如实报告，不回退
//   其余非 2xx                              → 视作没有这个端点，继续回退。包括静态托管的常规回应
//                                            （GitHub Pages 405、python http.server 501、旧版 server.js 404）
//                                            和 CDN / 反代对 POST 的 403、400、502… 页面——状态码写进状态文案。
//   只认 server.js 原话的 400/413（而不是任何 400/413），是因为部分托管对 POST 也回 400/413 的 HTML 页，
//   那种情况用户要的是拿到文件（回退），不是一行红字。
//
// 关键约束：navigator.share 必须在用户手势的紧邻（同步）链路里调用——Safari 对"先 fetch 再 share"会拒绝。
// 所以页面加载时先 probeServer() 探测一次端点并缓存；点击时若已知无服务器就直接 share，不先 fetch。
// 探测方式：POST 空体到 save-json。server.js 校验 JSON 失败回 400（不落盘）；静态站回 404/405/501（或 403 等）。
// 只探 save-json、不探 save-png（server.js 会把空体写成一个空 PNG）；两个端点同出 server.js，结论共用。
//
// share 只在触屏设备（iPad）上参与流程（shareable）：桌面 Safari / Chrome 在 https 或 localhost 上同样暴露
// navigator.share，但桌面用户要的是直接下载，弹 macOS 共享面板反而添乱；而且桌面若参与探测，遇到旧版
// server.js（无 save-json → 404）会被判成"无服务器"，点击就直接弹面板、绕过 POST。桌面一律：先 POST，
// 失败即下载，不发探测请求——也省掉一条 4xx 的控制台噪声。
//
// probe.html 是独立页面（非模块），内联了一份等价实现——改这里时同步改它。

const probes = new Map();   // probeUrl → { promise, known: true | false | null }

// 端点同目录下的 save-json（'save-png' / 'save-json?name=x' / 绝对 URL 都映射到同一个探测地址）
function probeUrlFor(endpoint = 'save-json') {
  return new URL('save-json', new URL(endpoint, document.baseURI)).href;
}
const entryFor = (endpoint) => {
  const url = probeUrlFor(endpoint);
  let e = probes.get(url);
  if (!e) { e = { url, promise: null, known: null }; probes.set(url, e); }
  return e;
};

// server.js 拒绝 save-json / save-png 时的原话开头（server.js send(res, 400|413, …)）。
// 据此把"我们的服务器在拒绝"与"静态托管 / CDN / 反代对 POST 的 400、413 页面"区分开。
const SERVER_REJECT = /^(Bad name\b|Body is not valid JSON\b|Payload Too Large\b|Bad URL\b|Bad percent-encoding\b|Null byte in path\b|Bad path\b)/;
// 静态托管对 POST 的常规回应；其余"无端点"状态码（403/400/500/502…）算意外，状态文案里点出来
const ABSENT_USUAL = new Set([404, 405, 501]);

// 一次 POST 的回应说明了什么：'ok' 成功 | 'reject' 我们的服务器在拒绝 | 'absent' 没有这个端点
export function serverSays(status, text = '') {
  if (status >= 200 && status < 300) return 'ok';
  if ((status === 400 || status === 413) && SERVER_REJECT.test(String(text).trimStart())) return 'reject';
  return 'absent';
}

// 触屏设备（iPad 上 maxTouchPoints 恒 >0，即便 UA 是"桌面网站"的 Macintosh；Mac 上恒 0）
export const isTouchDevice = () =>
  (navigator.maxTouchPoints > 0) ||
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

// 系统共享是否参与流程：要有 Web Share（安全上下文才暴露），且是触屏设备——桌面一律走下载
export const shareable = () => !!(navigator.share && navigator.canShare) && isTouchDevice();

// 探测端点是否存在（缓存）。返回 Promise<boolean|null>；share 不参与流程时不发请求，直接 null（未知）。
// force=true：即便 share 不参与也探测，并重新探测（覆盖缓存）。
export function probeServer(endpoint = 'save-json', { force = false } = {}) {
  const e = entryFor(endpoint);
  if (e.promise && !force) return e.promise;
  if (!force && !shareable()) { e.promise = Promise.resolve(null); return e.promise; }
  e.promise = fetch(e.url, { method: 'POST', cache: 'no-store' })
    .then(async r => serverSays(r.status, await r.text().catch(() => '')) !== 'absent', () => false)
    .then(v => (e.known = v));
  return e.promise;
}
// 同步读缓存：true（有服务器）/ false（无）/ null（未探测或尚未返回）
export const serverKnown = (endpoint = 'save-json') => entryFor(endpoint).known;
export function resetProbe() { probes.clear(); }

// 回退结果的"为什么没走服务器"一句话：调用方拼进最终状态文案
//   r.serverStatus: 404/405/501 → 无导出服务器；其他状态码 → 端点返回 HTTP n；0 → 连不上；undefined（跳过 POST）→ 无导出服务器
export function noServerReason(r) {
  const s = r && r.serverStatus;
  if (s === 0) return '连不上导出服务器';
  if (typeof s === 'number' && !ABSENT_USUAL.has(s)) return `端点返回 HTTP ${s}`;
  return '无导出服务器';
}

export function dataURLToBlob(dataURL) {
  const [head, data] = String(dataURL).split(',');
  const type = (/^data:([^;,]+)/.exec(head) || [])[1] || 'application/octet-stream';
  if (/;base64$/i.test(head)) {
    const bin = atob(data); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type });
  }
  return new Blob([decodeURIComponent(data)], { type });
}

const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';

// 导出一个 Blob。opts:
//   blob, name            必填：文件内容与文件名（share/download 用；服务器侧文件名由 server.js 决定）
//   endpoint              服务器端点（页面相对，如 'save-json?name=pen-samples'；或 import.meta.url 解析出的绝对 URL）
//   serverBody, serverHeaders   POST 用的请求体/头（默认 body=blob；save-png 需传 dataURL 文本）
//   title                 share 标题
//   clipboardText         (d) 步可写入剪贴板的文本（JSON 等）；PNG 等二进制不传
//   allowShare / allowDownload / allowClipboard   关掉某一步（控制台调用无手势时 share 必失败，可跳过）
//   onStatus(text, level) 每一步状态回调，level ∈ 'info' | 'ok' | 'err'
// 返回 { ok, mode: 'server'|'share'|'download'|'clipboard'|'text', status?, text?, bytes, name, serverStatus? }
//   serverStatus 只在回退结果里出现：POST 得到的状态码（0 = 网络错误；跳过 POST 时没有此字段），见 noServerReason
export async function exportBlob(opts) {
  const {
    blob, name, endpoint = 'save-json', serverBody = blob, serverHeaders,
    title = name, clipboardText = null,
    allowShare = true, allowDownload = true, allowClipboard = true,
    onStatus = () => {},
  } = opts;
  const bytes = blob.size;
  const st = (text, level = 'info') => { try { onStatus(text, level); } catch (e) { /* 状态回调不影响导出 */ } };
  const e = entryFor(endpoint);
  const extra = {};   // 回退结果附带的 serverStatus

  // (a) 服务器：share 参与流程且已知无服务器 → 跳过（保住 share 的手势链路）；否则直接试 POST（结果顺带定论）
  if (!(shareable() && e.known === false)) {
    st(`上传 ${name}（${kb(bytes)}）…`);
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: serverHeaders, body: serverBody });
      const text = await r.text();
      const verdict = e.known === true && !r.ok ? 'reject' : serverSays(r.status, text);
      if (verdict === 'ok') { e.known = true; st(`已存 ${text}`, 'ok'); return { ok: true, mode: 'server', status: r.status, text, bytes, name }; }
      if (verdict === 'reject') {
        // 我们的服务器在拒绝（400 参数 / 413 超限 / 已确认有服务器后的 500…）：如实报告，不回退
        e.known = true;
        st(`HTTP ${r.status}: ${text}`, 'err');
        return { ok: false, mode: 'server', status: r.status, text, bytes, name };
      }
      e.known = false;   // 无此端点：404/405/501（静态站、旧版 server.js），或 403/400/502… 等托管/CDN 对 POST 的回应
      extra.serverStatus = r.status;
      st(`${noServerReason(extra)}，改用系统共享 / 下载…`);
    } catch (err) {
      // 网络错误（服务器没起 / 离线）：不改 known，继续回退
      extra.serverStatus = 0;
      st('连不上导出服务器，改用系统共享 / 下载…');
    }
  }

  // (b) 系统共享（仅触屏设备，见 shareable；需要用户手势——navigator.userActivation 可用时先查，避免白弹一次异常）
  const file = new File([blob], name, { type: blob.type });
  const active = navigator.userActivation ? navigator.userActivation.isActive : true;
  if (allowShare && active && shareable() && navigator.canShare({ files: [file] })) {
    st('打开系统共享…');
    try {
      await navigator.share({ files: [file], title });
      st(`已用系统共享发送 ${name}（${kb(bytes)}）`, 'ok');
      return { ok: true, mode: 'share', bytes, name, ...extra };
    } catch (err) {
      if (err && err.name === 'AbortError') { st('已取消共享', 'err'); return { ok: false, mode: 'share', text: 'cancelled', bytes, name, ...extra }; }
      // NotAllowedError（无手势 / fetch 之后）等 → 继续下载
    }
  }

  // (c) 下载
  if (allowDownload) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      st(`已改为下载 ${name}（${kb(bytes)}）${isTouchDevice() ? '——iPad 在「文件」App 的「下载」里' : '——在浏览器的「下载」文件夹'}`, 'ok');
      return { ok: true, mode: 'download', bytes, name, ...extra };
    } catch (err) { /* 继续 */ }
  }

  // (d) 剪贴板
  if (allowClipboard && navigator.clipboard) {
    try {
      if (clipboardText != null && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(clipboardText);
        st(`已复制到剪贴板（${kb(bytes)}）`, 'ok');
        return { ok: true, mode: 'clipboard', bytes, name, text: clipboardText, ...extra };
      }
      if (navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        st(`已复制到剪贴板（${kb(bytes)}）`, 'ok');
        return { ok: true, mode: 'clipboard', bytes, name, ...extra };
      }
    } catch (err) { /* 继续 */ }
  }

  st('无可用导出通道：请在页面中全选复制文本', 'err');
  return { ok: false, mode: 'text', bytes, name, text: clipboardText, ...extra };
}
