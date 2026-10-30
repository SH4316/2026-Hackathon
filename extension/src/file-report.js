const IMAGE_BYTES = 5 * 1024 * 1024;
const TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

// content에서 받은 이미지에도 같은 상한을 적용한다. 파일 이름은 줄이지 않는다.
export function fileReportRequest(msg) {
  const files = (msg.files || []).slice(0, 100).map(f => ({ name: f.name }));
  const names = new Set(files.map(f => f.name));
  const images = [];
  let total = 0;
  for (const image of msg.images || []) {
    if (images.length >= 20 || !names.has(image.name) || !/^image\//.test(image.media_type) ||
        typeof image.data_base64 !== "string" || image.data_base64.length > Math.ceil(IMAGE_BYTES / 3) * 4 ||
        image.data_base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(image.data_base64) || /=[^=]|={3}/.test(image.data_base64)) continue;
    const bytes = image.data_base64.length * 3 / 4 - (image.data_base64.endsWith("==") ? 2 : image.data_base64.endsWith("=") ? 1 : 0);
    if (bytes > IMAGE_BYTES || total + bytes > TOTAL_IMAGE_BYTES) continue;
    total += bytes;
    images.push({ name: image.name, media_type: image.media_type, data_base64: image.data_base64 });
  }
  return { request_id: crypto.randomUUID(), input_version: msg.inputVersion || "file:upload",
    destination: msg.destination, send_action: ["normal", "confirmed", "forced"].includes(msg.sendAction) ? msg.sendAction : "normal",
    files, images };
}
